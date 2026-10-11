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
	memberRanks,
	releaseHold
} from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import {
	sbGetHoldGroupMapped,
	sbFacilityByUuid,
	sbMyProfile,
	sbPointBalance,
	confirmBookingGroup as sbConfirmBooking,
	bookingSessionId,
	setLastBooking,
	lastBookingRoomsOf,
	lastBookingMemberPageOf,
	releaseHoldGroup as sbReleaseHold
} from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import { earnedPoints } from '@autumn-book/core';
import { parseGuestForm } from '$lib/server/booking-guest-form';
import { applyGroupAnswers, groupBookingForms, planBookingForm } from '$lib/server/booking-questions';
import { groupMemberOnsiteHint, groupPayment, loadHoldGroupRooms } from '$lib/server/hold-group';
import { combineQuotes } from '$lib/multi-room';
import type { BookingQuestion } from '$lib/booking-questions';
import { combinePrepayViews, directPaymentsReady, directPublishableKey, holdBathTax, prepayDiscountViewFor, viewerIsMember } from '$lib/server/direct-payments';
import { memberOnsiteHint, planForViewer } from '$lib/member-payment';
import { payOptionsFor, ONSITE_METHOD_NOTE } from '$lib/direct-payment';
import { loadCancelAdminFeePercent } from '$lib/server/payment-settings';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';
import { CANCEL_POLICY_LABELS } from '$lib/partner-member-page';

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

// 会員ランク別の還元率（book.member_ranks 相当。ポイント獲得見込みの表示に使用）
const REWARD_RATE: Record<string, number> = { standard: 0.01, silver: 0.02, gold: 0.03, platinum: 0.05 };

export const load: PageServerLoad = async (event) => {
	const { url, locals, cookies } = event;

	if (DATA_SOURCE === 'supabase') {
		const sid = bookingSessionId(cookies);
		const hold = await sbGetHoldGroupMapped(url.searchParams.get('id') ?? '', sid);
		if (!hold || hold.status !== 'active') return { expired: true as const };

		// 非会員は非会員の支払方法（book.plan_contents.nonmember_payment_method）で出す
		const isMember = viewerIsMember(locals);
		// 部屋ごとのプラン・部屋タイプ（複数室・M1）。1 室目の値を最上位の plan / room にも置く（1 室の画面はそのまま）
		const [roomViews, facility] = await Promise.all([loadHoldGroupRooms(hold, isMember), sbFacilityByUuid(hold.facilityId)]);
		if (!roomViews || !facility) return { expired: true as const };
		const { plan, room } = roomViews[0];
		const multi = roomViews.length > 1;

		// 会員のみポイント残高・獲得見込みを表示（未ログインのゲストは null）。
		let member: {
			name: string; kana: string;
			familyName: string; givenName: string; middleName: string; familyNameKana: string; givenNameKana: string;
			phone: string; email: string; balance: number; earn: number;
		} | null = null;
		if (MEMBER_SUPABASE && locals.user?.role === 'member') {
			try {
				const client = createSupabaseServerClient(event);
				const [profile, balance] = await Promise.all([sbMyProfile(client), sbPointBalance(client)]);
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
					email: profile.email,
					balance,
					// 付与見込みは予約全体（全室の宿泊料金の和）で 1 つ
					earn: earnedPoints(hold.total, rate)
				};
			} catch {
				member = null;
			}
		}

		// オンライン決済（同じ画面で払う・v0.43.0）。Stripe の鍵・service_role・DB の migration がそろっていなければ
		// カードを出さず現地払いだけ（事前決済しか無いプランも現地払いで受ける＝予約を止めない）
		const memberUserId = MEMBER_SUPABASE && locals.user?.role === 'member' ? locals.user.id : null;
		const onlineReady = await directPaymentsReady().catch(() => false);
		// 支払方法は全室のプランで許されているものだけ（Q3。1 室はそのプランの設定そのもの）
		const pay = payOptionsFor(groupPayment(roomViews), { live: true, onlineReady });
		const [bathTax, prepayViews, bookingForm, groupForms, adminFeePercent] = await Promise.all([
			holdBathTax(hold.id, sid, memberUserId).catch(() => 0),
			// 予約時決済の割引（プランの定率と早期決済割の大きい方・泊ごと・部屋ごと）。金額の正は DB の direct_payment_prepare
			Promise.all(roomViews.map((r) => prepayDiscountViewFor(hold.facilityId, r.plan, { checkin: hold.checkin, quote: r.quote }))),
			// 予約時に聞く項目（プランの設定: テンプレート or プラン独自）。回答は備考の先頭に入る
			multi ? Promise.resolve(null) : planBookingForm(hold.facilityId, { ratePlanId: hold.planId }),
			// 複数室: 予約ごとの項目（全室のプランの和）と部屋ごとの項目・男女を聞くか
			multi ? groupBookingForms(hold.facilityId, roomViews.map((r) => r.plan.id)) : Promise.resolve(null),
			// 予約時決済の事務手数料（取消時に返金しない率・2026-10-07）。オンライン決済を選んだときに予約前に知らせる
			loadCancelAdminFeePercent(hold.facilityId)
		]);
		const prepay = combinePrepayViews(prepayViews);

		return {
			expired: false as const,
			hold,
			plan,
			room,
			// 部屋ごとの表示（複数室のときに部屋カード・男女・部屋ごとの質問を出す。1 室は 1 件）
			rooms: roomViews.map((r, i) => ({
				index: r.index,
				roomName: r.room.name,
				photo: r.room.photos[0]?.url ?? '',
				planName: r.plan.name,
				adults: r.adults,
				quote: r.quote,
				cancellationPolicy: r.plan.cancellationPolicy,
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
			payOptions: pay.options,
			payFallback: pay.fallback,
			// true = カードはこの画面で払う（実データ）。false = デモ決済画面へ（DATA_SOURCE=demo）
			inline: true as const,
			publishableKey: pay.options.includes('card') ? directPublishableKey() : null,
			bathTax,
			prepay,
			adminFeePercent,
			// 1 室: プランの項目（予約ごと・部屋ごとの両方）／複数室: 予約ごとの項目だけ（部屋ごとの項目は rooms[i].questions）
			questions: bookingForm ? bookingForm.questions : (groupForms?.bookingQuestions ?? []),
			askGender: bookingForm ? bookingForm.askGender : false,
			// 非会員は予約時決済のみ・会員なら現地払いも選べる →「会員の方は現地払いも…（ログイン）」を控えめに出す
			memberOnsiteHint: MEMBER_SUPABASE && groupMemberOnsiteHint(roomViews, isMember),
			...holdNav(cookies, hold.id, planHrefOf(facility, plan, hold)),
			// 特別会員の専用ページ経由の束（見出し「{pageName} 経由・専用料金」・キャンセル方式・「選び直す」は専用ページへ）。公式の束は null
			memberPage: hold.memberPage
				? {
						pageName: hold.memberPage.pageName,
						via: hold.memberPage.via,
						cancelMode: { mode: hold.memberPage.cancelPolicyMode, label: CANCEL_POLICY_LABELS[hold.memberPage.cancelPolicyMode] },
						backHref: holdNav(cookies, hold.id, planHrefOf(facility, plan, hold)).backHref
					}
				: null
		};
	}

	const hold = getHold(url.searchParams.get('id') ?? '');
	if (!hold || hold.status !== 'active') {
		return { expired: true as const };
	}
	const member = locals.user?.role === 'member' ? memberById(locals.user.id) : undefined;
	const rank = memberRanks.find((r) => r.code === (member?.rank ?? 'standard'))!;
	const isMember = viewerIsMember(locals);
	const basePlan = planById(hold.planId)!;
	const plan = planForViewer(basePlan, isMember);
	const pay = payOptionsFor(plan.payment, { live: false, onlineReady: false });
	const facility = facilityById(hold.facilityId)!;
	const prepay = { ...(await prepayDiscountViewFor(hold.facilityId, plan, hold)), mixedRates: false };
	const demoRoom = roomTypeById(hold.roomTypeId)!;
	return {
		expired: false as const,
		hold,
		plan,
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
				cancellationPolicy: plan.cancellationPolicy,
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
		inline: false as const,
		publishableKey: null,
		bathTax: 0,
		prepay,
		adminFeePercent: await loadCancelAdminFeePercent(hold.facilityId),
		questions: [],
		askGender: false,
		memberOnsiteHint: memberOnsiteHint(basePlan.payment, isMember),
		...holdNav(cookies, hold.id, planHrefOf(facility, plan, hold)),
		// デモ（store.ts）には特別会員の専用ページ経由の束は無い
		memberPage: null as { pageName: string; via: 'self' | 'family'; cancelMode: { mode: string; label: string }; backHref: string } | null,
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
					email: member.email,
					balance: pointBalance(member.id),
					earn: earnedPoints(hold.quote.total, rank.rewardRate)
				}
			: null
	};
};

export const actions: Actions = {
	// 「プラン・お部屋を選び直す」: 仮押さえを解放してプラン詳細へ戻る（押さえたまま戻ると期限まで部屋が減ったままになる）
	release: async ({ request, cookies }) => {
		const form = await request.formData();
		const holdId = String(form.get('holdId') ?? '');
		const back = String(form.get('back') ?? '');
		try {
			if (DATA_SOURCE === 'supabase') await sbReleaseHold(holdId, bookingSessionId(cookies));
			else releaseHold(holdId);
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
		const { holdId, guest, pointsRequested, payment, onsiteMethod, errors } = parseGuestForm(form);

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
			const roomViews = await loadHoldGroupRooms(hold, isMember);
			if (!roomViews) return fail(410, { message: m.error_hold_expired() });
			const pay = payOptionsFor(groupPayment(roomViews), { live: true, onlineReady: await directPaymentsReady().catch(() => false) });
			if (payment === 'onsite' && !pay.options.includes('onsite')) {
				errors.payment = groupMemberOnsiteHint(roomViews, isMember) ? m.pay_nonmember_onsite_denied() : 'お支払い方法を選択してください';
				return fail(400, { errors, values: guest });
			}
			if (payment !== 'onsite') {
				// カードはこの画面の入力欄で払う（JavaScript が動かない等でここに来たときは選び直してもらう）
				errors.payment = 'お支払い方法を選択してください';
				return fail(400, { errors, values: guest });
			}

			// 予約時に聞く項目の回答（「項目名: 回答」を備考の先頭へ）。複数室は部屋ごとの男女・回答を rooms に
			const answered = await applyGroupAnswers(form, hold.facilityId, hold.rooms.map((r) => ({ planId: r.planId, adults: r.adults })), guest);
			if (!answered.ok) {
				errors.questions = answered.message;
				return fail(400, { errors, values: guest });
			}

			const client = useMember ? createSupabaseServerClient(event) : undefined;
			// 現地払いの内訳（現地PayPay・現地カード・現地現金）は宿への申し送り（core.stays.notes → PMS の備考）に載せる。
			// 予約の metadata.guest にも onsitePayment として残す
			const guestForBooking = onsiteMethod
				? { ...answered.guest, onsitePayment: onsiteMethod, notes: [ONSITE_METHOD_NOTE[onsiteMethod], answered.guest.notes].filter(Boolean).join(' ') }
				: answered.guest;
			const result = await sbConfirmBooking(holdId, sid, guestForBooking, { client, pointsUsed, locale: getLocale(), rooms: answered.rooms });
			if ('error' in result) return fail(410, { message: m.error_hold_expired() });
			setLastBooking(cookies, {
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
				discountAmount: result.discount ?? 0,
				guest: { name: guest.name, kana: guest.kana, phone: guest.phone, email: guest.email },
				rooms: lastBookingRoomsOf(hold),
				memberPage: lastBookingMemberPageOf(hold)
			});
			redirect(303, `/booking/complete/${result.booking_code}`);
		}

		const hold = getHold(holdId);
		if (!hold || hold.status !== 'active') {
			return fail(410, { message: m.error_hold_expired() });
		}
		if (Object.keys(errors).length > 0) return fail(400, { errors, values: guest });

		const memberId = locals.user?.role === 'member' ? locals.user.id : undefined;
		const pointsUsed = memberId ? pointsRequested : 0;

		// 支払い方法（プランの決済設定でバリデーション）
		// 非会員は非会員の支払方法で判定する（デモのプランは非会員の設定を持たない＝会員と同じ）
		const basePlan = planById(hold.planId)!;
		const plan = planForViewer(basePlan, viewerIsMember(locals));
		const allowed = payOptionsFor(plan.payment, { live: false, onlineReady: false }).options.includes(payment);
		if (!allowed) {
			errors.payment =
				payment === 'onsite' && memberOnsiteHint(basePlan.payment, viewerIsMember(locals))
					? m.pay_nonmember_onsite_denied()
					: 'お支払い方法を選択してください';
			return fail(400, { errors, values: guest });
		}

		if (payment !== 'onsite') {
			// ③ デモ決済ステップへ（事前決済=即時決済。入力内容を hold に保持）
			hold.guestDraft = guest;
			hold.pointsDraft = pointsUsed;
			hold.paymentDraft = payment;
			redirect(303, `/booking/payment?id=${hold.id}`);
		}

		const result = confirmBooking(hold.id, guest, pointsUsed, memberId, 'onsite');
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
		const hold = getHold(String(form.get('holdId')));
		if (!hold || locals.user?.role !== 'member') return fail(400, {});
		const points = Math.min(Math.max(0, Number(form.get('points') ?? 0)), pointBalance(locals.user.id), hold.quote.total);
		hold.quote = quoteFor(hold.planId, hold.roomTypeId, hold.checkin, hold.nights, hold.adults, hold.children, points);
		return { pointsApplied: points };
	}
};
