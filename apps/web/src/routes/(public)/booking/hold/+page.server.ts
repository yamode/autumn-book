import { fail, redirect, type Cookies } from '@sveltejs/kit';
import { HOLD_NAV_COOKIE, safeLocalPath } from '$lib/booking-nav';
import {
	getHold,
	planById,
	roomTypeById,
	facilityById,
	confirmBooking,
	memberById,
	pointBalance,
	quoteFor,
	demoCancellationFallback,
	memberRanks,
	releaseHold,
	favoriteRoomsByMember,
	rooms as demoRooms
} from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbMyCoupons } from '$lib/server/my-coupons';
import { couponsForBooking } from '$lib/my-coupons';
import {
	sbGetHoldGroupMapped,
	sbFacilityByUuid,
	sbMyProfile,
	sbPointBalance,
	sbMyProfileContact,
	confirmBookingGroup as sbConfirmBooking,
	bookingSessionId,
	setLastBooking,
	lastBookingRoomsOf,
	lastBookingMemberPageOf,
	releaseHoldGroup as sbReleaseHold
} from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import { parseGuestForm } from '$lib/server/booking-guest-form';
import { bookingCouponFrom, couponErrors, couponErrorText, couponFailed, couponLocked } from '$lib/server/booking-coupon';
import { applyGroupAnswers, groupBookingForms, loadStandardFieldTexts, planBookingForm } from '$lib/server/booking-questions';
import { groupMemberOnsiteHint, groupPayment, loadHoldGroupRooms } from '$lib/server/hold-group';
import { combineQuotes } from '$lib/multi-room';
import type { BookingQuestion } from '$lib/booking-questions';
import { combinePrepayViews, directPaymentsReady, directPublishableKey, holdBathTax, prepayDiscountViewFor, viewerIsMember } from '$lib/server/direct-payments';
import { memberOnsiteHint, planForViewer } from '$lib/member-payment';
import { payOptionsFor, ONSITE_METHOD_NOTE, FURUSATO_VOUCHER_NOTE } from '$lib/direct-payment';
import { loadCancelAdminFeePercent, loadPaymentTexts } from '$lib/server/payment-settings';
import { favoriteRoomChoicesFor, saveFavoriteRoomChoices } from '$lib/server/favorites';
import { savePlatinumTiming } from '$lib/server/platinum-timing';
import { fridgeOptionsFor, saveFridgeOptions } from '$lib/server/fridge-options';
import { isRankCode, type RankCode } from '$lib/plan-access';
import * as m from '$lib/paraglide/messages';
import { checkTurnstile, clientIpOf } from '$lib/server/turnstile';
import type { Actions, PageServerLoad } from './$types';
import { appliedCancellationPolicy, loadCancellationFallback } from '$lib/server/booking-cancellation';
import { canUseFavoriteRooms } from '$lib/member-benefits';
import { viewerOf } from '$lib/server/secret-plans';
import { memberBenefitLines, rankLabelOf, type MemberPerkSnapshot } from '$lib/partner-member-page';

function demoHoldFor(locals: App.Locals, id: string) {
	const hold = getHold(id);
	return !locals.memberPreview || hold?.memberId === locals.user?.id ? hold : undefined;
}

// 選び直し・パンくず用: この仮押さえのプラン詳細（日程・人数つき）
function planHrefOf(
	facility: { brandSlug: string; slug: string },
	plan: { slug: string },
	hold: { checkin: string; nights: number; adults: number }
): string {
	const q = new URLSearchParams({ checkin: hold.checkin, nights: String(hold.nights), adults: String(hold.adults) });
	return `/${facility.brandSlug}/${facility.slug}/plans/${plan.slug}?${q}`;
}

// 遷移経路（プラン詳細の仮押さえ時に Cookie へ記録）。この仮押さえのものだけ使い、無ければプラン詳細へ
// planHref: パンくずのプラン名（プラン詳細）／backHref: 「選び直す」の戻り先（予約ボタンを押したページ。一覧の空室カレンダーから予約したら一覧）
function holdNav(cookies: Cookies, holdId: string, fallback: string): { planHref: string; backHref: string; via: string } {
	try {
		const saved = JSON.parse(cookies.get(HOLD_NAV_COOKIE) ?? 'null') as { id?: string; back?: string; via?: string } | null;
		if (saved && saved.id === holdId) {
			const back = safeLocalPath(saved.back);
			// 戻り先がプラン詳細なら、選んだ客室の位置つきのそれをパンくずにも使う
			const planHref = back && back.split('?')[0] === fallback.split('?')[0] ? back : fallback;
			return { planHref, backHref: back || fallback, via: safeLocalPath(saved.via) };
		}
	} catch { /* 壊れた Cookie は無視 */ }
	return { planHref: fallback, backHref: fallback, via: '' };
}

const PREVIEW_CONFIRM_DENIED = 'プレビュー中のため、予約は確定できません（このプランは販売中ではありません）。';

// 会員ランク別の還元率（book.member_ranks 相当。ポイント獲得見込みの表示に使用）
// 特別会員（platinum）はゴールドと同じ還元率（2026-11-23）
const REWARD_RATE: Record<string, number> = { standard: 0.01, silver: 0.02, gold: 0.03, platinum: 0.03 };

/** 束の部屋ごとの専用特典を 1 つの並びにする（同じ特典は 1 回だけ・id が無ければ題名で見分ける） */
function memberPagePerksOf(list: readonly (MemberPerkSnapshot[] | null)[]): { id: string; title: string; description: string; imageUrl: string }[] {
	const seen = new Set<string>();
	const out: { id: string; title: string; description: string; imageUrl: string }[] = [];
	for (const p of list.flatMap((l) => l ?? [])) {
		const key = p.id ?? `t:${p.title}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ id: key, title: p.title, description: p.description, imageUrl: '' });
	}
	return out;
}

export const load: PageServerLoad = async (event) => {
	const { url, locals, cookies } = event;

	if (DATA_SOURCE === 'supabase') {
		const sid = bookingSessionId(cookies);
		const hold = await sbGetHoldGroupMapped(url.searchParams.get('id') ?? '', sid);
		if (!hold || hold.status !== 'active') return { expired: true as const };

		// 非会員は非会員の支払方法（book.plan_contents.nonmember_payment_method）で出す
		const isMember = viewerIsMember(locals);
		// 部屋ごとのプラン・部屋タイプ（複数室・M1）。1 室目の値を最上位の plan / room にも置く（1 室の画面はそのまま）
		// スタッフは販売中でないプランもプレビューとして読む（予約は確定させない・$lib/server/plan-preview）
		const [roomViews, facility] = await Promise.all([loadHoldGroupRooms(hold, isMember, locals), sbFacilityByUuid(hold.facilityId)]);
		if (!roomViews || !facility) return { expired: true as const };
		const { plan, room } = roomViews[0];
		const multi = roomViews.length > 1;

		// 会員のみポイント残高・獲得見込みを表示（未ログインのゲストは null）。
		let canChoosePlatinumTiming = false;
		let memberRank: RankCode | null = null;
		let member: {
			name: string; kana: string;
			familyName: string; givenName: string; middleName: string; familyNameKana: string; givenNameKana: string;
			phone: string; email: string; zip: string; address: string; address2: string; balance: number; rewardRate: number;
		} | null = null;
		if (MEMBER_SUPABASE && locals.user?.role === 'member') {
			try {
				const client = createSupabaseServerClient(event);
				const [profile, balance, contact] = await Promise.all([sbMyProfile(client), sbPointBalance(client), sbMyProfileContact(client).catch(() => null)]);
				memberRank = isRankCode(profile.rankCode) ? profile.rankCode : 'standard';
				canChoosePlatinumTiming = profile.rankCode === 'platinum' && ['nishiwaga', 'yamado', 'oga'].includes(facility.slug);
				const rate = REWARD_RATE[profile.rankCode] ?? 0.01;
				member = {
					name: profile.name,
					kana: profile.kana,
					familyName: profile.familyName,
					givenName: profile.givenName,
					middleName: profile.middleName,
					familyNameKana: profile.familyNameKana,
					givenNameKana: profile.givenNameKana,
					phone: profile.phone,
					zip: contact?.zip ?? '',
					address: contact?.address ?? '',
					address2: contact?.address2 ?? '',
					email: profile.email,
					balance,
					// 付与見込みは予約全体（全室の宿泊料金の和）で 1 つ
					rewardRate: rate
				};
			} catch {
				member = null;
			}
		}

		// オンライン決済（同じ画面で払う・v0.43.0）。Stripe の鍵・service_role・DB の migration がそろっていなければ
		// カードを使えないときの現地払いへの切り替えも、会員に限る。
		const memberUserId = MEMBER_SUPABASE && locals.user?.role === 'member' ? locals.user.id : null;
		const onlineReady = await directPaymentsReady().catch(() => false);
		// 支払方法は全室のプランで許されているものだけ（Q3。1 室はそのプランの設定そのもの）
		const pay = payOptionsFor(groupPayment(roomViews), { live: true, onlineReady, guestCardOnly: !isMember });
		const [bathTax, prepayViews, bookingForm, groupForms, adminFeePercent, paymentTexts, favoriteChoices, standardFields, cancellationFallback, fridgeOptions, myCoupons] = await Promise.all([
			holdBathTax(hold.id, sid, memberUserId).catch(() => 0),
			// 予約時決済の割引（プランの定率と早期決済割の大きい方・泊ごと・部屋ごと）。金額の正は DB の direct_payment_prepare
			// 特別会員の束（metadata.member_page）は特別会員の早期決済割（率・期間）で。束から決める（DB の _direct_payment_prepare と同じ判定）
			Promise.all(
				roomViews.map((r) => prepayDiscountViewFor(hold.facilityId, r.plan, { checkin: hold.checkin, quote: r.quote }, { memberPage: !!hold.memberPage }))
			),
			// 予約時に聞く項目（プランの設定: テンプレート or プラン独自）。回答は備考の先頭に入る
			multi ? Promise.resolve(null) : planBookingForm(hold.facilityId, { ratePlanId: hold.planId }),
			// 複数室: 予約ごとの項目（全室のプランの和）と部屋ごとの項目・男女を聞くか
			multi ? groupBookingForms(hold.facilityId, roomViews.map((r) => r.plan.id)) : Promise.resolve(null),
			// 予約時決済の事務手数料（取消時に返金しない率・2026-10-07）。オンライン決済を選んだときに予約前に知らせる
			loadCancelAdminFeePercent(hold.facilityId),
			// 支払方法の名前・説明文（施設ごとの上書き・管理画面の支払方法で編集）
			loadPaymentTexts(hold.facilityId),
			// 会員のお気に入りの部屋のうち、この日程に空いている部屋（予約確認画面で部屋指定を選べる・確定のときに空きを確かめ直す）
			favoriteRoomChoicesFor(event, hold.id, sid),
			// 毎回聞く項目（アレルギー・交通手段・お迎え時間・備考）の見出し・説明・選択肢（施設ごと・管理画面「予約時に聞く項目」）
			loadStandardFieldTexts(hold.facilityId),
			loadCancellationFallback(locals),
			// 冷蔵庫のカスタマイズ（会員だけ・予約フォームでチェックできる）
			member ? fridgeOptionsFor(hold.facilityId, getLocale(), memberRank) : Promise.resolve([]),
			// お持ちのクーポン（会員だけ・この施設・この日程で使えそうなもの）。選ぶとコード欄に入れて確かめる（2026-11-24）。
			// 最低金額などの細かい条件は、選んだあとに member_coupon_code_quote が確かめる
			member
				? sbMyCoupons(createSupabaseServerClient(event))
						.then((list) => couponsForBooking(list, hold.facilityId, hold.checkin))
						.catch(() => [])
				: Promise.resolve([])
		]);
		const prepay = combinePrepayViews(prepayViews);

		return {
			expired: false as const,
			couponsEnabled: MEMBER_SUPABASE,
			// 画面に渡すのは選ぶのに要るものだけ（コード・名前・割引・最低金額）
			myCoupons: myCoupons.map((c) => ({ code: c.code as string, name: c.name, discountType: c.discountType, discountValue: c.discountValue, minTotal: c.minTotal })),
			hold,
			plan,
			room,
			// スタッフのプレビュー（販売中でないプランを含む束）: 入力はできるが確定ボタン・カード決済を止める
			preview: roomViews.some((r) => r.preview),
			// 部屋ごとの表示（複数室のときに部屋カード・男女・部屋ごとの質問を出す。1 室は 1 件）
			rooms: roomViews.map((r, i) => ({
				index: r.index,
				roomName: r.room.name,
				photo: r.room.photos[0]?.url ?? '',
				planName: r.plan.name,
				adults: r.adults,
				quote: r.quote,
				cancellationPolicy: appliedCancellationPolicy(r.plan.cancellationPolicy, cancellationFallback, hold.memberPage),
				prepayDiscount: prepayViews[i]?.detail.discount ?? 0,
				askGender: groupForms ? groupForms.rooms[i].askGender : (bookingForm?.askGender ?? true),
				questions: groupForms ? groupForms.rooms[i].questions : [],
				// 特別会員の専用ページ経由の束: この部屋（プラン）の専用特典（無ければ null・docs/vip-member-page.md §14）
				memberPerks: hold.rooms[i]?.memberPerks ?? null
			})),
			// 全室の見積（合計・内消費税。1 室はその部屋の見積と同じ値）
			groupQuote: combineQuotes(roomViews.map((r) => r.quote)),
			facility,
			member,
			fridgeOptions: fridgeOptions.map((o) => ({ id: o.id, name: o.name, description: o.description ?? '' })),
			// 会員ログイン中は Turnstile を出さない（ログインで本人確認済み）。非会員の予約確定だけ確かめる
			needsTurnstile: !viewerIsMember(locals),
			payOptions: pay.options,
			payFallback: pay.fallback,
			// オンライン決済（チェックアウト日）を出すか（プランの組み合わせ ∩ 施設でオン・オンライン決済が使えるとき）
			checkoutOption: pay.checkout,
			// 施設でオンの現地払いの内訳（無ければ全部）
			onsiteMethods: groupPayment(roomViews).onsiteMethods ?? null,
			paymentTexts,
			favoriteChoices,
			canChoosePlatinumTiming,
			// true = カードはこの画面で払う（実データ）。false = デモ決済画面へ（DATA_SOURCE=demo）
			inline: true as const,
			publishableKey: pay.options.includes('card') || pay.checkout ? directPublishableKey() : null,
			bathTax,
			prepay,
			adminFeePercent,
			// 1 室: プランの項目（予約ごと・部屋ごとの両方）／複数室: 予約ごとの項目だけ（部屋ごとの項目は rooms[i].questions）
			questions: bookingForm ? bookingForm.questions : (groupForms?.bookingQuestions ?? []),
			standardFields,
			askGender: bookingForm ? bookingForm.askGender : false,
			// 非会員は予約時決済のみ・会員なら現地払いも選べる →「会員の方は現地払いも…（ログイン）」を控えめに出す
			memberOnsiteHint: MEMBER_SUPABASE && groupMemberOnsiteHint(roomViews, isMember),
			...holdNav(cookies, hold.id, planHrefOf(facility, plan, hold)),
			// 特別会員の専用ページ経由の束（見出し「{pageName} 経由・専用料金」・キャンセル方式・「選び直す」は専用ページへ）。公式の束は null
			memberPage: hold.memberPage
				? {
						pageName: hold.memberPage.pageName,
						via: hold.memberPage.via,
						backHref: holdNav(cookies, hold.id, planHrefOf(facility, plan, hold)).backHref,
						// 2026-11-27〜 専用ページの確認画面（/p/<token>/book）を通さずここへ来るので、確認画面で見せていた中身をここで見せる。
						// 帯の「○○ 様のプライベートブック」（B面のヘッダーと同じくログイン中の会員の名前。取れなければ名前なし）
						memberName: member?.name || null,
						// このご予約に付く専用特典（全室の写しを重ねずに並べる・束に写した値）
						perks: memberPagePerksOf(hold.rooms.map((r) => r.memberPerks ?? null)),
						// 会員特典（還元率・キャンセル方式・ポイント利用可）。B面の MemberBenefitList と同じ行
						benefits:
							member && memberRank
								? {
										rankLabel: rankLabelOf(memberRank, null),
										lines: memberBenefitLines(rankLabelOf(memberRank, null), member.rewardRate, hold.memberPage.cancelPolicyMode)
									}
								: null,
						// 専用ページのキャンセル規定（「会員グレードの規定」の方式では使わないので null）
						cancelRules: hold.memberPage.cancelPolicyMode === 'rank' ? null : hold.memberPage.cancelRules
					}
				: null
		};
	}

	const hold = demoHoldFor(locals, url.searchParams.get('id') ?? '');
	if (!hold || hold.status !== 'active') {
		return { expired: true as const };
	}
	const member = locals.user?.role === 'member' ? memberById(locals.user.id) : undefined;
	const rank = memberRanks.find((r) => r.code === (member?.rank ?? 'standard'))!;
	const isMember = viewerIsMember(locals);
	const basePlan = planById(hold.planId)!;
	const plan = planForViewer(basePlan, isMember);
	const pay = payOptionsFor(plan.payment, { live: false, onlineReady: false, guestCardOnly: !isMember });
	const facility = facilityById(hold.facilityId)!;
	const prepay = { ...(await prepayDiscountViewFor(hold.facilityId, plan, hold)), mixedRates: false };
	const demoRoom = roomTypeById(hold.roomTypeId)!;
	const favoriteChoices: Record<number, import('$lib/server/supabase-data').FavoriteRoomChoice[]> = {};
	if (locals.memberPreview && member && canUseFavoriteRooms(await viewerOf(locals)) && hold.roomTypeId === 'r-oga-twin') {
		const favorites = favoriteRoomsByMember.get(member.id);
		favoriteChoices[1] = demoRooms
			.filter((room) => room.facilityId === 'f-oga' && room.roomType === '山祇 ジュニアスイート' && favorites?.has(room.id))
			.map((room) => ({ roomIndex: 1, roomId: room.id, roomNumber: room.roomNumber, name: room.name }));
	}
	return {
		expired: false as const,
		couponsEnabled: false,
		hold,
		plan,
		preview: false,
		room: demoRoom,
		// デモ（store.ts）は 1 室だけ
		rooms: [
			{
				index: 1,
				roomName: demoRoom.name,
				photo: demoRoom.photos[0]?.url ?? '',
				planName: plan.name,
				adults: hold.adults,
				quote: hold.quote,
				cancellationPolicy: appliedCancellationPolicy(plan.cancellationPolicy, demoCancellationFallback(member?.rank)),
				prepayDiscount: prepay.detail.discount,
				askGender: false,
				questions: [] as BookingQuestion[],
				memberPerks: null as import('$lib/partner-member-page').MemberPerkSnapshot[] | null
			}
		],
		groupQuote: hold.quote,
		facility,
		payOptions: pay.options,
		payFallback: pay.fallback,
		checkoutOption: false,
		onsiteMethods: plan.payment.onsiteMethods ?? null,
		paymentTexts: {} as import('$lib/direct-payment').PaymentTexts,
		favoriteChoices,
		canChoosePlatinumTiming: member?.rank === 'platinum',
		fridgeOptions: [] as { id: string; name: string; description: string }[],
		inline: false as const,
		publishableKey: null,
		bathTax: 0,
		prepay,
		adminFeePercent: await loadCancelAdminFeePercent(hold.facilityId),
		questions: [],
		// デモは施設の設定が無いので既定の文言（アレルギー・交通手段 JR／車／その他・備考）
		standardFields: await loadStandardFieldTexts(hold.facilityId),
		askGender: false,
		memberOnsiteHint: memberOnsiteHint(basePlan.payment, isMember),
		...holdNav(cookies, hold.id, planHrefOf(facility, plan, hold)),
		// デモ（store.ts）には特別会員の専用ページ経由の束は無い
		memberPage: null as {
			pageName: string;
			via: 'self' | 'family';
			backHref: string;
			memberName: string | null;
			perks: { id: string; title: string; description: string; imageUrl: string }[];
			benefits: { rankLabel: string; lines: string[] } | null;
			cancelRules: import('$lib/partner-member-page').MemberCancelRule[] | null;
		} | null,
		needsTurnstile: !viewerIsMember(locals),
		member: member
			? {
					name: member.name,
					kana: member.kana,
					familyName: member.familyName,
					givenName: member.givenName,
					middleName: member.middleName ?? '',
					familyNameKana: member.familyNameKana ?? '',
					givenNameKana: member.givenNameKana ?? '',
					phone: member.phone,
					zip: member.zip ?? '',
					address: member.address ?? '',
					address2: member.address2 ?? '',
					email: member.email,
					balance: pointBalance(member.id),
					rewardRate: rank.rewardRate
				}
			: null
	};
};

export const actions: Actions = {
	// 「プラン・お部屋を選び直す」: 仮押さえを解放してプラン詳細へ戻る（押さえたまま戻ると期限まで部屋が減ったままになる）
	release: async ({ request, cookies, locals }) => {
		const form = await request.formData();
		const holdId = String(form.get('holdId') ?? '');
		const back = String(form.get('back') ?? '');
		try {
			if (DATA_SOURCE === 'supabase') await sbReleaseHold(holdId, bookingSessionId(cookies));
			else if (demoHoldFor(locals, holdId)) releaseHold(holdId);
		} catch (e) {
			// 解放に失敗しても戻る（期限で自動解放される）
			console.error('[booking/hold] release', e);
		}
		// 自サイト内のパスだけ（外部 URL へは飛ばさない）
		redirect(303, back.startsWith('/') && !back.startsWith('//') ? back : '/search');
	},
	// 現地払いの確定（カードは同じ画面の決済部品 → /booking/pay で確定する）
	submit: async (event) => {
		const { request, locals, cookies } = event;
		const form = await request.formData();
		const { holdId, guest, pointsRequested, payment, onsiteMethod, furusatoVoucher, errors } = parseGuestForm(form);
		const coupon = bookingCouponFrom(form);
		if (coupon && (!MEMBER_SUPABASE || locals.user?.role !== 'member')) {
			return fail(403, { message: m.booking_coupon_invalid(), values: guest });
		}
		if (coupon && (await couponLocked(event, locals.user?.id))) {
			return fail(429, { message: couponErrorText('coupon_locked'), values: guest });
		}
		// 非会員の予約確定だけ Turnstile で確かめる（会員はログインで確かめ済み）。未設定の環境は素通り
		if (!viewerIsMember(locals) && !(await checkTurnstile(form, clientIpOf(event))).ok) {
			return fail(400, { message: m.auth_turnstile_failed(), values: guest });
		}

		if (DATA_SOURCE === 'supabase') {
			const sid = bookingSessionId(cookies);
			const hold = await sbGetHoldGroupMapped(holdId, sid);
			if (!hold || hold.status !== 'active') return fail(410, { message: m.error_hold_expired() });
			if (Object.keys(errors).length > 0) return fail(400, { errors, values: guest });

			const useMember = MEMBER_SUPABASE && locals.user?.role === 'member';
			const pointsUsed = useMember ? pointsRequested : 0;

			// 非会員は非会員の支払方法で判定する。book.confirm_booking_group（現地払いの確定）は他アプリと共用で
			// 支払方法を見ないため、非会員に現地払いが無いプランはここで止める（画面で隠すだけにしない）。
			// 複数室は全室のプランで現地払いが許されているときだけ（Q3）
			const isMember = viewerIsMember(locals);
			const roomViews = await loadHoldGroupRooms(hold, isMember, locals);
			if (!roomViews) return fail(410, { message: m.error_hold_expired() });
			// 販売中でないプラン（スタッフのプレビュー）は確定しない。お客様は上で読めず「期限切れ」になる
			if (roomViews.some((r) => r.preview)) return fail(403, { message: PREVIEW_CONFIRM_DENIED, values: guest });
			const pay = payOptionsFor(groupPayment(roomViews), {
				live: true, onlineReady: await directPaymentsReady().catch(() => false), guestCardOnly: !isMember
			});
			if (payment === 'onsite' && !pay.options.includes('onsite')) {
				errors.payment = !isMember ? m.pay_nonmember_onsite_denied() : m.hold_error_payment_select();
				return fail(400, { errors, values: guest });
			}
			// 現地払いの内訳は施設でオンのものだけ（管理画面の支払方法でオフにした内訳は受けない）
			const allowedOnsite = groupPayment(roomViews).onsiteMethods;
			if (payment === 'onsite' && onsiteMethod && allowedOnsite && !allowedOnsite.includes(onsiteMethod)) {
				errors.payment = m.hold_error_payment_select();
				return fail(400, { errors, values: guest });
			}
			if (payment !== 'onsite') {
				// カードはこの画面の入力欄で払う（JavaScript が動かない等でここに来たときは選び直してもらう）
				errors.payment = m.hold_error_payment_select();
				return fail(400, { errors, values: guest });
			}

			// 予約時に聞く項目の回答（「項目名: 回答」を備考の先頭へ）。複数室は部屋ごとの男女・回答を rooms に
			const answered = await applyGroupAnswers(form, hold.facilityId, hold.rooms.map((r) => ({ planId: r.planId, adults: r.adults })), guest);
			if (!answered.ok) {
				errors.questions = answered.message;
				return fail(400, { errors, values: guest });
			}

			// 確定はサーバの service_role 経由（book.confirm_booking_server）。会員は検証済みセッションの id を渡す
			const memberUserId = useMember ? (locals.user?.id ?? null) : null;
			// 更新前の入力画面から現地払いの内訳が届いた場合は、従来どおり宿への申し送りに載せる。
			// 予約の metadata.guest にも onsitePayment として残す
			// ふるさと納税 宿泊補助券の併用予定も同じく申し送りの先頭に足し、metadata.guest に furusatoVoucher として残す
			const guestForBooking = onsiteMethod
				? {
						...answered.guest,
						onsitePayment: onsiteMethod,
						...(furusatoVoucher ? { furusatoVoucher: true } : {}),
						notes: [ONSITE_METHOD_NOTE[onsiteMethod], furusatoVoucher ? FURUSATO_VOUCHER_NOTE : '', answered.guest.notes].filter(Boolean).join(' ')
					}
				: answered.guest;
			// お気に入りの部屋の指定（会員が選んだとき）を仮押さえに残す。確定のときに DB が空きを確かめて部屋指定する
			const favError = await saveFavoriteRoomChoices(event, holdId, sid, form);
			if (favError) {
				errors.favoriteRoom = favError;
				return fail(400, { errors, values: guest });
			}
			const timingError = await savePlatinumTiming(event, holdId, sid, form);
			if (timingError) {
				errors.platinumTiming = timingError;
				return fail(400, { errors, values: guest });
			}
			const fridgeError = await saveFridgeOptions(event, holdId, sid, form);
			if (fridgeError) {
				errors.fridge = fridgeError;
				return fail(400, { errors, values: guest });
			}
			const result = await sbConfirmBooking(holdId, sid, guestForBooking, { memberUserId, pointsUsed, coupon, locale: getLocale(), rooms: answered.rooms });
			if ('error' in result) {
				if (couponErrors.some((code) => code === result.error)) {
					if (result.error === 'coupon_invalid') await couponFailed(event, locals.user?.id);
					return fail(409, { message: couponErrorText(result.error), values: guest });
				}
				// 画面の判定をすり抜けても DB が支払方法を検査する（onsite_not_allowed）
				if (result.error === 'onsite_not_allowed') {
					errors.payment = groupMemberOnsiteHint(roomViews, isMember) ? m.pay_nonmember_onsite_denied() : m.hold_error_payment_select();
					return fail(400, { errors, values: guest });
				}
				// 確定の時点でお部屋が埋まっていた（入力中は在庫を押さえていない）
				if (result.error === 'sold_out') return fail(409, { message: m.booking_sold_out_at_confirm(), values: guest });
				return fail(410, { message: m.error_hold_expired() });
			}
			await setLastBooking(cookies, {
				code: result.booking_code,
				facilityUuid: hold.facilityId,
				roomUuid: hold.roomTypeId,
				planUuid: hold.planId,
				checkin: hold.checkin,
				nights: hold.nights,
				adults: hold.adults,
				total: result.total,
				pointsUsed: result.points_used,
				pointsEarned: result.points_earned,
				payment,
				onsiteMethod,
				discountAmount: 0,
				couponDiscount: result.discount ?? 0,
				guest: { name: guest.name, kana: guest.kana, phone: guest.phone, email: guest.email },
				rooms: lastBookingRoomsOf(hold),
				memberPage: lastBookingMemberPageOf(hold)
			});
			redirect(303, `/booking/complete/${result.booking_code}`);
		}

		const hold = demoHoldFor(locals, holdId);
		if (!hold || hold.status !== 'active') {
			return fail(410, { message: m.error_hold_expired() });
		}
		if (Object.keys(errors).length > 0) return fail(400, { errors, values: guest });

		const memberId = locals.user?.role === 'member' ? locals.user.id : undefined;
		const pointsUsed = memberId ? pointsRequested : 0;

		// 支払い方法（プランの決済設定でバリデーション）
		const basePlan = planById(hold.planId)!;
		const isMember = viewerIsMember(locals);
		const plan = planForViewer(basePlan, isMember);
		const allowed = payOptionsFor(plan.payment, { live: false, onlineReady: false, guestCardOnly: !isMember }).options.includes(payment);
		if (!allowed) {
			errors.payment =
				payment === 'onsite' && !isMember
					? m.pay_nonmember_onsite_denied()
					: m.hold_error_payment_select();
			return fail(400, { errors, values: guest });
		}

		const guestForDemo = locals.memberPreview && memberId
			? (() => {
					const member = memberById(memberId)!;
					return { ...guest, name: member.name, kana: member.kana, phone: member.phone, email: member.email };
				})()
			: guest;

		if (payment !== 'onsite') {
			// ③ デモ決済ステップへ（事前決済=即時決済。入力内容を hold に保持）
			hold.guestDraft = guestForDemo;
			hold.pointsDraft = pointsUsed;
			hold.paymentDraft = payment;
			redirect(303, `/booking/payment?id=${hold.id}`);
		}

		const result = confirmBooking(hold.id, guestForDemo, pointsUsed, memberId, 'onsite');
		if ('error' in result) {
			return fail(410, { message: m.error_hold_expired() });
		}
		redirect(303, `/booking/complete/${result.code}`);
	},

	usePoints: async (event) => {
		// 事前決済前のポイント再計算（画面遷移なしの再見積もり相当）。
		// 実データ（supabase）は anon で hold の見積もりを書き換えられないため無効化（確定時に反映）。
		if (DATA_SOURCE === 'supabase') return fail(400, {});

		const { request, locals } = event;
		const form = await request.formData();
		const hold = demoHoldFor(event.locals, String(form.get('holdId')));
		if (!hold || locals.user?.role !== 'member') return fail(400, {});
		const points = Math.min(Math.max(0, Number(form.get('points') ?? 0)), pointBalance(locals.user.id), hold.quote.total);
		hold.quote = quoteFor(hold.planId, hold.roomTypeId, hold.checkin, hold.nights, hold.adults, hold.children, points);
		return { pointsApplied: points };
	}
};
