<script lang="ts">
	import { invalidGuide } from '$lib/form-invalid';
	import ContactAddressFields from '$lib/components/ContactAddressFields.svelte';
	import { enhance } from '$lib/enhance';
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import BookingSteps from '$lib/components/booking/BookingSteps.svelte';
	import PartnerPerkList from '$lib/components/PartnerPerkList.svelte';
	import PriceBreakdown from '$lib/components/PriceBreakdown.svelte';
	import BookingCancelTerms from '$lib/components/BookingCancelTerms.svelte';
	import StripePayment from '$lib/components/payment/StripePayment.svelte';
	import Turnstile from '$lib/components/Turnstile.svelte';
	import type { PaymentConfirmed, PaymentLocale, PaymentPrepareResult, PaymentTexts } from '$lib/components/payment/types';
	import { directChargeOf, ONSITE_METHODS, payTextFor, type OnsiteMethod, type PayOption, type PayTextGroup } from '$lib/direct-payment';
	import { earnedPoints } from '@autumn-book/core';
	import { percentText } from '$lib/early-prepay';
	import { addDays, formatDateLong, formatPrice } from '$lib/format';
	import { gaEvent } from '$lib/analytics';
	import { getLocale } from '$lib/paraglide/runtime';
	import { guestsLabel } from '$lib/components/guests';
	import * as m from '$lib/paraglide/messages';
	import { isQuestionShown, type BookingQuestion } from '$lib/booking-questions';
	import { DEFAULT_FIELD_ORDER, TRANSPORT_OTHER } from '$lib/booking-standard-fields';
	import { BOOKING_COLUMNS_CLASS, BOOKING_INPUT_CLASS, BOOKING_LABEL_CLASS, BOOKING_PAGE_CLASS } from '$lib/booking-layout';

	let { data, form } = $props();
	// プラン詳細の手前に通ってきたページ（パンくず用）

	let expiredNow = $state(false);

	// 複数室（docs/official-multi-room.md §8.3・M1）: 部屋ごとのカード・男女・部屋ごとの質問を出す。1 室は従来の画面のまま
	let rooms = $derived(data.expired ? [] : data.rooms);
	// お気に入りの部屋の指定（会員）。部屋ごとの候補（その日程に空いているお気に入りの部屋）と、選んだ部屋 id（'' は指定しない）
	let favRooms = $derived(
		data.expired
			? []
			: rooms
					.map((r) => ({ index: r.index, roomName: r.roomName, choices: data.favoriteChoices[r.index] ?? [] }))
					.filter((r) => r.choices.length > 0)
	);
	let favPicked = $state<Record<number, string>>({});
	let platinumTiming = $state('');
	let multi = $derived(rooms.length > 1);
	// 特別会員の専用ページ経由の束（docs/vip-member-page.md §13.4.3-4）。公式の束は null
	let memberPage = $derived(data.expired ? null : data.memberPage);
	const perkTitles = (list: { title: string }[] | null | undefined) => (list ?? []).map((p) => p.title).filter(Boolean).join('／');
	let totalAdults = $derived(rooms.reduce((s, r) => s + r.adults, 0) || (data.expired ? 0 : data.hold.adults));
	// 部屋ごとの男女の内訳（男性の人数。女性は部屋の大人の人数から引く）。0 始まりの部屋の番号ごと
	let males = $state<string[]>([]);
	const optionKey = (q: { id: string; scope: string }, i: number) => (q.scope === 'room' ? `${q.id}@${i}` : q.id);

	// 毎回聞く項目（アレルギー・交通手段・お迎え時間・備考・2026-11-02）。見出し・説明は施設の設定（日本語）なので、
	// 日本語の画面だけ施設の文言を使い、英語・繁体字は既定の訳を出す
	const isJa = getLocale() === 'ja';
	let sf = $derived(data.expired ? null : data.standardFields);
	let fieldOrder = $derived(sf?.order ?? DEFAULT_FIELD_ORDER);
	let transport = $state('');
	const choiceText = (c: string) => (isJa ? c : c === '車' ? m.hold_transport_car() : c === TRANSPORT_OTHER ? m.hold_transport_other() : c);
	let showPickup = $derived(!!sf && !!transport && transport === sf.pickup.when && sf.pickup.choices.length > 0);
	// 条件分岐（「JR のときだけ聞く」など）: 入力中の回答（opt_*）と交通手段で出す項目を決める。隠れた項目は送らない（サーバーも同じ規則で検証）
	let liveAnswers = $state<Record<string, string>>({});
	function readAnswers() {
		if (!formEl) return;
		const next: Record<string, string> = {};
		for (const [k, v] of new FormData(formEl).entries()) if (k.startsWith('opt_')) next[k.slice(4)] = String(v);
		liveAnswers = next;
	}
	const shownQ = (q: BookingQuestion, list: BookingQuestion[], roomIndex = 0) => isQuestionShown(q, list, { transport, answers: liveAnswers }, roomIndex);

	// GA4 予約ファネル: 仮押さえ→ゲスト情報入力の開始（設計書 §9）
	$effect(() => {
		if (data.expired) return;
		gaEvent('begin_checkout', { currency: 'JPY' });
	});

	// 支払い方法（サーバがプランの決済設定とオンライン決済の可否から決めたもの）。
	// 現地払いでは施設で使える方法を案内する。予約時の送信値は 'onsite'。
	let onsiteMethods = $derived(data.expired ? [] : (data.onsiteMethods ?? ONSITE_METHODS));
	// 支払方法の名前・説明文（施設が管理画面で書き換えていればそれ、無ければ既定の文言）
	const payText = (group: PayTextGroup, field: 'label' | 'note', fallback: string) =>
		(data.expired ? null : payTextFor(data.paymentTexts, group, field, getLocale())) ?? fallback;
	const onsiteMethodLabel = (v: OnsiteMethod) => (v === 'paypay' ? m.pay_method_paypay() : v === 'card' ? m.pay_method_card() : m.pay_method_cash());
	// プランが予約時のカード決済を受け付けるか（実際に出すかは下の hasPrepay）
	let cardPrepay = $derived(!data.expired && data.payOptions.includes('card'));
	let hasOnsite = $derived(!data.expired && data.payOptions.includes('onsite'));
	// 予約時決済の割引（プランの定率と早期決済割の大きい方・泊ごと。オンライン決済を選んだときだけ効く）。
	// サーバが lib/early-prepay.ts（DB と同じ式）で計算した額。金額の正は DB（direct_payment_prepare）
	let prepay = $derived(data.expired ? null : data.prepay);
	// 非会員は割引なし（会員になったときの率は memberRate で別に出す）
	let prepayAmount = $derived(!data.expired && !data.member ? 0 : (prepay?.detail.discount ?? 0));
	// 割引行の名前: 早期決済割が当たっていれば「早期決済割（5%）」、定率なら従来の「予約時決済割引（10%OFF）」
	// 特別会員（プライベートブック）の束は「特別会員の早期決済割（5%）」（率・期間は特別会員の設定・サーバが束から決める）
	let discountLabel = $derived(
		prepay?.mixedRates
			? m.pay_discount_rooms()
			: prepay?.early
			? prepay.memberPage
				? m.pay_member_page_early_line({ rate: percentText(prepay.detail.maxPermille / 10) })
				: m.pay_early_line({ rate: percentText(prepay.detail.maxPermille / 10) })
			: m.pay_discount_line({ rate: percentText((prepay?.detail.flatPermille ?? 0) / 10) })
	);
	// 特別会員の束: 特別会員の早期決済割の段階表（率と「何日前まで」）を予約時決済の説明に出す。段階表を出さない（定率の方が大きい等）ときは出さない
	let memberPageTiersText = $derived(
		prepay?.memberPage && prepay.showLadder && prepay.tiers.length
			? m.pay_member_page_early_tiers({
					tiers: prepay.tiers
						.map((t) =>
							prepay?.mode === 'points'
								? m.pay_member_page_tier_item_points({ days: String(t.days), percent: percentText(t.percent) })
								: m.pay_member_page_tier_item({ days: String(t.days), percent: percentText(t.percent) })
						)
						.join(' / ')
				})
			: ''
	);
	// 今の段（段階表のハイライト用・千分率）
	let currentTierPermille = $derived(prepay?.detail.tierPermille ?? 0);
	// 早期決済ポイント（施設の還元方法が points）: 段階表の率は割引にせず、宿泊後にポイントを上乗せする。
	// 請求額から引くのはプランの定率割引だけ（prepayAmount）。会員ランクの通常ポイントとは別に付く
	let isPoints = $derived(prepay?.mode === 'points');
	let rawBonusPoints = $derived(isPoints ? (prepay?.detail.bonusPoints ?? 0) : 0);
	// 非会員は早期決済ポイントなし（会員になったときのポイントは memberPoints で別に出す）
	let bonusPoints = $derived(!data.expired && !data.member ? 0 : rawBonusPoints);
	let bonusRate = $derived(percentText((prepay?.detail.pointsPermille ?? 0) / 10));
	// オンライン決済（チェックアウト日・2026-11-01）: カード決済が使えるプランで、実データ（同じ画面で払う方式）のときだけ。
	// 予約時にカードを登録し、チェックアウト日に請求する（予約時決済の割引・早期決済ポイント・事務手数料は付かない）
	let hasCheckout = $derived(!data.expired && data.inline && data.checkoutOption);
	// 予約時決済は、早期決済割引（または早期決済ポイント）が付くときだけ出す。付かないならチェックアウト日決済だけでよい（2026-11-22 指示）。
	// チェックアウト日決済が選べないプラン（予約時決済しかない）では、割引が無くても予約時決済を出す
	// 非会員は予約時決済の割引・早期決済ポイントを使えない（2026-11-22・DB の _direct_payment_prepare も 0 にする）。
	// カードはチェックアウト日決済だけにし、「会員登録で最大〇%お得」で会員登録へ誘う。予約時決済しか無いプランは割引なしで出す
	let isGuest = $derived(!data.expired && !data.member);
	let hasPrepay = $derived(cardPrepay && (!hasCheckout || (!isGuest && (prepayAmount > 0 || bonusPoints > 0))));
	// 会員になったら付く予約時決済の割引の率（この日程・この部屋で）。0 なら会員登録の案内は出さない
	let memberRate = $derived(isGuest && prepay ? Math.round(prepay.detail.maxPermille) / 10 : 0);
	let memberPoints = $derived(isGuest ? rawBonusPoints : 0);
	// 会員登録・ログインのあとは、この予約入力画面に戻る（同じかごのまま続ける）
	let backHere = $derived(data.expired ? '' : `/booking/hold?id=${encodeURIComponent(data.hold.id)}`);
	let justRegistered = $derived(page.url.searchParams.get('registered') === '1');
	let hasOnline = $derived(hasPrepay || hasCheckout);
	let canChooseTiming = $derived(hasPrepay && hasCheckout);
	let canPay = $derived(hasOnline || hasOnsite);
	let selectedGroup = $state<'online' | 'checkout' | 'onsite' | null>(null);
	let group = $derived(
		(selectedGroup === 'online' && hasPrepay) ||
		(selectedGroup === 'checkout' && hasCheckout) ||
		(selectedGroup === 'onsite' && hasOnsite)
			? selectedGroup
			: hasPrepay ? 'online' : hasOnsite ? 'onsite' : hasCheckout ? 'checkout' : 'onsite'
	);
	let checkoutCard = $derived(group === 'checkout' && hasCheckout);
	// 請求日＝チェックアウト日（仮押さえの泊数から）
	let chargeOnText = $derived(data.expired ? '' : formatDateLong(addDays(data.hold.checkin, data.hold.nights)));
	let payValue = $derived<PayOption>(group === 'onsite' ? 'onsite' : 'card');
	let isPrepay = $derived(group === 'online');
	// 実データのカード決済はこの画面で払う（同じ画面の決済部品）。デモは従来どおり決済画面へ
	let inlineCard = $derived(!data.expired && data.inline && payValue === 'card' && group === 'online');
	// 同じ画面の決済部品を出すか（予約時のカード決済・チェックアウト日のカード登録）
	let inlinePay = $derived(inlineCard || checkoutCard);
	let discountNow = $derived(isPrepay ? prepayAmount : 0);
	let couponInput = $state('');
	let coupon = $state<{ code: string; name: string; amount: number } | null>(null);
	let couponBusy = $state(false);
	let couponError = $state('');
	const couponAmount = $derived(coupon?.amount ?? 0);
	let discountedTotal = $derived(data.expired ? 0 : data.groupQuote.total - discountNow - couponAmount);

	async function applyCoupon() {
		if (data.expired || couponBusy || !couponInput.trim()) return;
		couponError = '';
		couponBusy = true;
		try {
			const response = await fetch('/booking/coupon', {
				method: 'POST', body: new URLSearchParams({ holdId: data.hold.id, code: couponInput })
			});
			if (!response.ok) {
				// サーバの文言を出す（失敗が続いて止めているとき〈429〉は「しばらくお待ちください」・M-8）
				const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
				couponError = typeof body?.message === 'string' && body.message ? body.message : m.booking_coupon_invalid();
				return;
			}
			coupon = await response.json();
		} catch {
			couponError = m.booking_coupon_invalid();
		} finally {
			couponBusy = false;
		}
	}

	// ポイント（会員のみ）。請求額の計算は DB（direct_payment_prepare）と同じ式（lib/direct-payment.ts）
	// svelte-ignore state_referenced_locally
	let pointsInput = $state(data.expired ? 0 : data.hold.quote.pointsUsed);
	// 男女の内訳（男性の人数。女性は大人の人数から引く）
	let male0 = $state("");
	let pointsApplied = $derived(
		data.expired || !data.member
			? 0
			: Math.min(
					Math.max(0, Math.floor(Number(pointsInput) || 0)),
					data.member.balance,
					// 予約時決済の割引があるときは割引後の宿泊料金まで（DB と同じ）
					Math.max(0, discountedTotal)
				)
	);
	// 付与の基準は割引（クーポン・早期決済割）とポイント利用分を引いた支払額（入湯税を除く・税抜）。DB の _confirm_booking_group と同じ（2026-11-22）
	const pointsToEarn = $derived(data.expired || !data.member ? 0 : earnedPoints(Math.max(0, discountedTotal - pointsApplied), data.member.rewardRate));
	let charge = $derived(
		data.expired ? { lodging: 0, bathTax: 0, discount: 0, charge: 0 } : directChargeOf({ total: data.groupQuote.total - couponAmount, pointsUsed: pointsApplied, bathTax: data.bathTax, prepayDiscount: discountNow })
	);

	// モバイル上部の要約に出す合計（右の明細と同じ額: 入湯税込みで払う場合はその額、それ以外はポイント利用後の宿泊料金）
	let summaryTotal = $derived(
		data.expired ? 0 : inlinePay ? charge.charge : Math.max(0, discountedTotal - pointsApplied)
	);

	// 仮押さえの期限（支払の準備で DB が延ばしたら更新する）
	// svelte-ignore state_referenced_locally
	let holdExpiresAt = $state(data.expired ? 0 : data.hold.expiresAt);
	// 残り時間は画面に出さない（在庫は確定時に押さえるので急がせない・期限は 3 時間・2026-11-21 指示）。
	// 期限を過ぎたときだけ「入力時間が過ぎました」に切り替える。支払の処理中は切り替えない（確定の結果はサーバが判断する）
	$effect(() => {
		if (data.expired || !holdExpiresAt) return;
		const timer = setTimeout(() => {
			if (!paying) expiredNow = true;
		}, Math.max(0, holdExpiresAt - Date.now()));
		return () => clearTimeout(timer);
	});

	// ---- 同じ画面で払う決済部品 ----
	let formEl: HTMLFormElement | undefined = $state();
	// 非会員だけ、予約確定の前に Turnstile（フォームの中に置き、現地払いの送信にもカードの準備にも同じトークンが乗る）
	let turnstile = $state<ReturnType<typeof Turnstile> | null>(null);
	let payRef: StripePayment | undefined = $state();
	let paying = $state(false);
	let payMessage = $state('');
	const PHONE_RE = /^[0-9\-+ ]{10,}$/;
	const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

	const payTexts: PaymentTexts = {
		failed: m.pay_el_failed(),
		tryOtherCard: m.pay_el_try_other(),
		notReady: m.pay_el_not_ready(),
		checkCard: m.pay_el_check_card(),
		setupFailed: m.pay_el_failed(),
		loadFailed: m.pay_el_load_failed(),
		divider: m.pay_el_divider(),
		secure: m.pay_el_secure()
	};
	const stripeLocale = (): PaymentLocale => {
		const l = getLocale();
		return l === 'en' || l === 'zh-TW' ? l : 'ja';
	};

	// 必須項目を先に確かめる（Apple Pay / Google Pay のシートを開く前にも呼ばれる）
	function validateGuest(): string | null {
		if (!formEl) return m.pay_el_not_ready();
		const fd = new FormData(formEl);
		const v = (k: string) => String(fd.get(k) ?? '').trim();
		if (!v('familyName') || !v('givenName')) return m.error_name_required();
		if (!v('address')) return m.contact_address_required();
		if (!PHONE_RE.test(v('phone'))) return m.error_phone_invalid();
		if (!EMAIL_RE.test(v('email'))) return m.error_email_invalid();
		// 確認の段では個人情報の同意が要る（Apple Pay / Google Pay のシートを開く前にもここで止める）
		if (step === 'confirm' && !privacyAgreed) return m.hold_consent_required();
		return null;
	}
	// カード部品からの確定前チェック。入力の段（確認前）に Apple Pay / Google Pay を押されたら、先に確認の段へ進んでもらう
	// カード欄の状態（入力の段から確認の段へ進む前に確かめる）。まだ何も届いていなければ unknown。
	// 会員は保存済みのカードが最初から選ばれていて通知が来ないことがあるので、はっきり「途中」のときだけ止める
	let cardState = $state<'unknown' | 'complete' | 'incomplete'>('unknown');
	function validatePayment(): string | null {
		if (step === 'input') return m.hold_pay_confirm_first();
		return validateGuest();
	}
	// 個人情報（SMS・メールでの案内を含む）の同意。確認の段の最後で取る（2026-11-09）
	let privacyAgreed = $state(false);

	// 保存カード（2026-10-07・docs/saved-cards.md §6.4）: 会員ならマイページで保存したカードを「保存済み」に出す。
	// 部品のマウントのたびに取り直す（30 分で失効）。非会員・失敗は null（従来どおり新しいカードの入力だけ）
	async function loadMemberSession(): Promise<string | null> {
		if (!data.member) return null;
		const fd = new FormData();
		fd.set('action', 'customer_session');
		const res = await fetch('/booking/pay', { method: 'POST', body: fd }).catch(() => null);
		if (!res?.ok) return null;
		const j = (await res.json().catch(() => null)) as { clientSecret?: string | null } | null;
		return j?.clientSecret ?? null;
	}

	async function preparePayment(): Promise<PaymentPrepareResult> {
		if (!formEl) throw new Error(m.pay_el_not_ready());
		const fd = new FormData(formEl);
		// カード会社のページへ移る認証（3Dセキュア）で失敗して戻ったとき、入力をやり直さずに済むよう控えておく
		saveResume(fd);
		fd.set('action', 'prepare');
		fd.set('payment', 'card');
		// チェックアウト日決済はカード登録（SetupIntent）。額は割引なしの請求予定額
		if (checkoutCard) fd.set('timing', 'checkout');
		// 画面の請求額。サーバは DB が決めた額（早期決済割を含む）と違えば Intent を作らずに止める
		fd.set('expectedAmount', String(charge.charge));
		const res = await fetch('/booking/pay', { method: 'POST', body: fd });
		// Turnstile のトークンは 1 回限り。カードの失敗などでもう一度払うときに備えて取り直す
		turnstile?.reset();
		const j = (await res.json().catch(() => ({ ok: false, message: m.pay_el_failed() }))) as {
			ok: boolean;
			message?: string;
			clientSecret?: string;
			returnUrl?: string;
			amount?: number;
			expiresAt?: number;
		};
		if (!j.ok || !j.clientSecret || !j.returnUrl) throw new Error(j.message ?? m.pay_el_failed());
		if (typeof j.expiresAt === 'number' && Number.isFinite(j.expiresAt)) holdExpiresAt = j.expiresAt;
		// 画面の金額（Apple Pay のシートに出す額）とサーバが決めた請求額が違えば払わせない
		if (j.amount !== charge.charge) throw new Error(m.pay_notice_amount_changed());
		return { clientSecret: j.clientSecret, returnUrl: j.returnUrl };
	}

	async function onPaid(r: PaymentConfirmed) {
		if (data.expired) return;
		const fd = new FormData();
		fd.set('action', 'confirm');
		fd.set('intentId', r.intentId);
		fd.set('holdId', data.hold.id);
		const res = await fetch('/booking/pay', { method: 'POST', body: fd });
		const j = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; redirect?: string; message?: string };
		if (j.ok && j.redirect) {
			await goto(j.redirect);
			return;
		}
		// 支払は通っているので Webhook でも確定される。ここでは案内だけ出す
		payMessage = j.message ?? m.pay_notice_failed();
	}

	// 3Dセキュア等のリダイレクトの戻りで確定できなかったときの案内（/booking/pay/return）
	const returnNotice = $derived.by(() => {
		const p = page.url.searchParams.get('pay');
		if (p === 'sold_out') return m.booking_sold_out_at_confirm();
		if (p === 'late') return m.pay_notice_late();
		if (p === 'late_unrefunded') return m.pay_notice_late_unrefunded();
		if (p === 'card_expiry') return m.pay_notice_card_expiry();
		if (p === 'expired') return m.error_hold_expired();
		if (p === 'failed' || p === 'error') return m.pay_notice_failed();
		return '';
	});

	// ---- 入力 → 確認・確定（取引先ページと同じ 2 段・2026-11-02）----
	// 入力の段で必須項目を確かめてから確認の段へ。確認の段で内容を見直し、確定（現地払い）・カード決済をする。
	// 入力欄は確認の段でも DOM に残す（隠すだけ）ので、送信・決済の準備はフォームの値をそのまま使う
	let step = $state<'input' | 'confirm'>('input');
	let clientError = $state('');
	let values = $state<Record<string, string>>({});
	function snapshot() {
		if (!formEl) return;
		const out: Record<string, string> = {};
		for (const [k, v] of new FormData(formEl).entries()) out[k] = String(v);
		values = out;
	}
	function toConfirm() {
		clientError = '';
		if (!canPay) {
			clientError = m.pay_unavailable();
			return;
		}
		if (couponBusy) return;
		if (couponInput.trim() && !coupon) {
			clientError = m.booking_coupon_apply_first();
			return;
		}
		if (discountedTotal < 0) {
			clientError = m.booking_coupon_not_compatible();
			return;
		}
		if (!formEl?.reportValidity()) return;
		const err = validateGuest();
		if (err) {
			clientError = err;
			return;
		}
		// カードは入力の段で入れてもらう（確認の段では入れ直さない）
		if (inlinePay && data.publishableKey && (cardState === 'incomplete' || (cardState === 'unknown' && !data.member))) {
			clientError = m.hold_pay_card_required();
			document.getElementById('hold-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
			return;
		}
		snapshot();
		step = 'confirm';
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}
	function backToInput() {
		step = 'input';
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	// ---- 3Dセキュア等でカード会社のページへ移り、失敗して戻ってきたとき（/booking/pay/return → ?pay=…）----
	// ページを丸ごと移るので入力が消える。決済の準備のときにこのタブの sessionStorage へ入力を控え、戻ってきたら
	// 欄を埋め直して確認の段から始める（別のカードですぐやり直せる）。控えは読んだら消す（タブを閉じても消える）
	const resumeKey = () => (data.expired ? '' : `ab_hold_resume_${data.hold.id}`);
	function saveResume(fd: FormData) {
		try {
			const entries = [...fd.entries()].filter(([k]) => k !== 'cf-turnstile-response').map(([k, v]) => [k, String(v)]);
			sessionStorage.setItem(resumeKey(), JSON.stringify(entries));
		} catch {
			/* 保存できない環境は従来どおり入力からやり直し */
		}
	}
	async function restoreResume(entries: [string, string][]) {
		const get = (k: string) => entries.find(([n]) => n === k)?.[1];
		// 画面の状態で持っている選択（交通手段・男女・支払方法・お気に入りの部屋・ポイント）を先に戻す
		transport = get('transport') ?? '';
		male0 = get('male_0') ?? '';
		males = rooms.map((_, i) => get(`male_${i}`) ?? '');
		const g = get('payGroup');
		if (g === 'online' || g === 'checkout' || g === 'onsite') selectedGroup = g;
		if (get('points') != null) pointsInput = Number(get('points')) || 0;
		couponInput = get('couponCode') ?? '';
		favPicked = Object.fromEntries(entries.filter(([k]) => k.startsWith('fav_')).map(([k, v]) => [Number(k.slice(4)), v]));
		platinumTiming = entries.find(([key]) => key === 'platinumTiming')?.[1] ?? '';
		await tick();
		// 残りの欄（氏名・連絡先・アレルギー・追加で聞く項目・備考など）。条件で出る欄は上の選択で出てから入れる。
		// 確認の段に切り替えた直後に画面の描き直しで欄が初期値に戻ることがあるので、切り替えた後にもう一度入れる
		const fill = () => {
			for (const [k, v] of entries) {
				for (const el of formEl?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${CSS.escape(k)}"]`) ?? []) {
					if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
						if (el.type === 'radio' ? el.value === v : true) el.checked = true;
					} else if (!(el instanceof HTMLInputElement && el.type === 'hidden')) {
						el.value = v;
					}
				}
			}
			readAnswers();
		};
		fill();
		await tick();
		fill();
		step = couponInput || !inlinePay || g !== group ? 'input' : 'confirm';
		await tick();
		fill();
		snapshot();
	}
	onMount(() => {
		const p = page.url.searchParams.get('pay');
		if (!p || p === 'expired' || data.expired) return;
		let raw: string | null = null;
		try {
			raw = sessionStorage.getItem(resumeKey());
			sessionStorage.removeItem(resumeKey());
		} catch {
			return;
		}
		if (!raw) return;
		try {
			const entries = JSON.parse(raw) as [string, string][];
			// 画面の最初の描き込みが済んでから戻す
			if (Array.isArray(entries)) setTimeout(() => void restoreResume(entries), 0);
		} catch {
			/* 壊れた控えは捨てる */
		}
	});
	// 入力欄・見出しの形は取引先ページと共通（lib/booking-layout.ts）
	const input = BOOKING_INPUT_CLASS;
	const label = BOOKING_LABEL_CLASS;
	// 確認の段に出す支払方法の名前
	let payLabel = $derived(
		group === 'online'
			? payText('online_now', 'label', m.pay_card())
			: group === 'checkout'
				? payText('online_checkout', 'label', m.pay_group_checkout())
				: payText('onsite', 'label', m.pay_group_onsite())
	);
	// 確認の段に出す追加で聞く項目（1 室は予約ごと・部屋ごとの両方、複数室は予約ごとの項目と部屋ごとの項目）
	let confirmAnswers = $derived.by(() => {
		if (data.expired) return [] as { key: string; label: string; value: string }[];
		const rows: { key: string; label: string; value: string }[] = [];
		const add = (q: BookingQuestion, key: string, labelText: string) => {
			const v = values[`opt_${key}`];
			if (v) rows.push({ key, label: labelText, value: q.type === 'check' ? m.hold_confirm_yes() : v });
		};
		for (const q of data.questions) add(q, optionKey(q, 0), q.label);
		if (multi) for (const [i, r] of rooms.entries()) for (const q of r.questions) add(q, optionKey(q, i), `${m.hold_room_n({ n: String(r.index) })} ${q.label}`);
		return rows;
	});
	const favNameOf = (index: number, roomId: string) => {
		const c = favRooms.find((f) => f.index === index)?.choices.find((x) => x.roomId === roomId);
		return c ? m.hold_fav_room({ name: c.name, number: c.roomNumber }) : '';
	};
</script>

{#snippet guestHint(withLabel: boolean)}
	<!-- 非会員: 予約時決済の割引・早期決済ポイントは会員だけ。登録・ログインのあと同じかごのままこの画面に戻る -->
	<div class="border-t border-stone-200 px-3 py-2.5 pl-9 text-sm">
		<p class="flex flex-wrap items-center gap-2 text-stone-500">
			{#if withLabel}<span>{payText('online_now', 'label', m.pay_group_online())}</span>{/if}
			<span class="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">{memberRate > 0 ? m.pay_member_save_rate({ rate: percentText(memberRate) }) : m.pay_member_save_points({ points: memberPoints.toLocaleString() })}</span>
		</p>
		<p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
			<a href={`/auth/register?next=${encodeURIComponent(backHere)}`} class="font-medium text-accent-600 underline hover:text-accent-500">{m.pay_member_register()}</a>
			<a href={`/auth/login?next=${encodeURIComponent(backHere)}`} class="text-stone-600 underline hover:text-brand-800">{m.pay_member_login()}</a>
			<span class="text-stone-400">{m.pay_member_back_note()}</span>
		</p>
	</div>
{/snippet}

{#snippet prepayBadges()}
	{#if prepayAmount > 0}
		<span class="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">{m.pay_prepay_save({ amount: formatPrice(prepayAmount) })}</span>
	{/if}
	{#if bonusPoints > 0}
		<span class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">{m.pay_points_badge({ points: bonusPoints.toLocaleString() })}</span>
	{/if}
{/snippet}


{#snippet specialRateBadge()}
	<span class="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">{m.hold_member_page_heading()}</span>
{/snippet}

<svelte:head><title>{m.hold_title()}</title></svelte:head>

<!-- 幅・列・枠・入力欄は取引先ページの予約入力と共通（lib/booking-layout.ts・app.css の .bk-*）。差し色は公式のアクセント色 -->
<div
	class="{BOOKING_PAGE_CLASS} py-8"
	style="--bk-accent: var(--color-accent-600); --bk-accent-soft: color-mix(in srgb, var(--color-accent-500) 25%, transparent); --bk-primary: var(--color-accent-600); --bk-primary-hover: var(--color-accent-500)"
>
	{#if returnNotice}
		<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{returnNotice}</p>
	{/if}
	{#if data.expired || expiredNow}
		<div class="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center">
			<p class="text-3xl">⌛</p>
			<h1 class="font-display mt-2 text-xl text-brand-900">{m.hold_expired_heading()}</h1>
			<p class="mt-2 text-sm text-stone-600">{m.hold_expired_msg()}</p>
			<a href="/search" class="mt-4 inline-block rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">{m.hold_expired_search()}</a>
		</div>
	{:else}
		<!-- 戻る: 仮押さえを解放してから選び直しへ戻る（ただのリンクで戻ると期限まで部屋が在庫から減ったままになる）。
		     見た目は他の子ページの「‹ 〇〇に戻る」（BackLink）にそろえる（2026-11-21: 上に戻るリンクと選び直しが重なっていた） -->
		<form method="POST" action="?/release" class="-ml-2 mb-3 flex flex-wrap items-center gap-x-2">
			<input type="hidden" name="holdId" value={data.hold.id} />
			<input type="hidden" name="back" value={data.backHref} />
			<button type="submit" disabled={paying} class="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-brand-800 hover:bg-stone-100 disabled:opacity-50">
				<svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
				{m.hold_change_plan()}
			</button>
			<span class="text-xs text-stone-400">{m.hold_change_plan_note()}</span>
		</form>
		<!-- 見出しと「1. 入力 → 2. 確認・確定」（取引先ページと共通） -->
		<BookingSteps {step} heading={step === 'input' ? m.hold_heading_input() : m.hold_heading_confirm()} inputLabel={m.hold_step_input()} confirmLabel={m.hold_step_confirm()} />
		{#if data.preview}
			<!-- スタッフの販売ページプレビュー（販売中でないプラン）。在庫は本物を押さえているので「選び直す」で戻してもらう -->
			<p class="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
				プレビュー（スタッフ用）。このプランは販売中ではないため、予約は確定できません。仮押さえした部屋は期限まで在庫から減っています。確認が終わったら「選び直す」で戻してください。
			</p>
		{/if}
		{#if form?.message}
			<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
		{/if}

		<!-- モバイル: 予約内容の要約（明細の aside は長いフォームの下になるため、合計を先に見せる） -->
		<div class="mt-4 rounded-xl border border-stone-200 bg-white p-3 text-sm lg:hidden">
			<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
				<p class="font-medium text-brand-900">{data.facility.name}</p>
				{#if memberPage}{@render specialRateBadge()}{/if}
			</div>
			{#if multi}
				{#each rooms as r (r.index)}
					<p class="text-xs text-stone-500">{m.hold_room_n({ n: String(r.index) })} {r.roomName} ／ {r.planName} ／ {m.hold_room_adults({ adults: String(r.adults) })}</p>
				{/each}
			{:else}
				<p class="text-xs text-stone-500">{data.room.name} ／ {data.plan.name}</p>
			{/if}
			<p class="mt-0.5 text-xs text-stone-600">
				{formatDateLong(data.hold.checkin)}・{m.hold_nights_adults_val({ nights: String(data.hold.nights), guests: guestsLabel(totalAdults) })}
			</p>
			<div class="mt-2 flex items-baseline justify-between border-t border-stone-100 pt-2">
				<span class="text-stone-600">{inlinePay && data.bathTax > 0 ? m.pay_total_due() : m.price_breakdown_total()}</span>
				<span class="text-lg font-bold tabular-nums text-brand-900">{formatPrice(summaryTotal)}</span>
			</div>
			<a href="#hold-summary" class="mt-1 block text-right text-xs text-accent-600 hover:underline">{m.hold_mobile_see_detail()} ↓</a>
		</div>

		{#if memberPage?.perks.length}
			<section aria-labelledby="hold-special-perks" class="mt-4 space-y-2" style="--pt-accent: var(--color-accent-600)">
				<h2 id="hold-special-perks" class="text-sm font-semibold text-brand-900">{m.member_page_perks()}</h2>
				<PartnerPerkList perks={memberPage.perks} variant="compact" showImages={false} />
			</section>
		{/if}

		<form
			bind:this={formEl}
			method="POST"
			action="?/submit"
			oninput={readAnswers}
			onchange={readAnswers}
			use:invalidGuide
			use:enhance={({ cancel }) => {
				// 入力の段で Enter キーを押したときは確定せず、確認の段へ進める
				if (step === 'input') {
					cancel();
					toConfirm();
					return;
				}
				// カードは同じ画面の決済部品で払う・登録する（Enter キーでの送信もここで止めて決済部品へ回す）
				if (inlinePay) {
					cancel();
					void payRef?.submit();
					return;
				}
				return async ({ result, update }) => {
					await update({ reset: false });
					// 確定できなかったとき（入力の誤り・満室など）は、直せるよう入力の段に戻す
					if (result.type === 'failure' || result.type === 'error') backToInput();
				};
			}}
			class="mt-5 {BOOKING_COLUMNS_CLASS}"
		>
			<input type="hidden" name="holdId" value={data.hold.id} />

			<div class="grid min-w-0 gap-5">
				{#if coupon}
					<input type="hidden" name="couponCode" value={coupon.code} />
					<input type="hidden" name="couponAmount" value={coupon.amount} />
				{/if}
				{#if !data.member}
					<div class="rounded-xl border border-accent-500/40 bg-amber-50/60 p-4 text-sm {step === 'confirm' ? 'hidden' : ''}">
						<p class="font-medium text-brand-900">{m.hold_login_prompt()}</p>
						<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
							<a href="/auth/login?next={encodeURIComponent(page.url.pathname + page.url.search)}" class="rounded-md bg-brand-800 px-4 py-1.5 whitespace-nowrap text-white hover:bg-brand-700">{m.common_login()}</a>
							<span class="self-center text-stone-500">{m.hold_guest_continue()}</span>
						</div>
					</div>
				{/if}

				<!-- ご宿泊者（代表者）。氏名はグローバル正規化（姓 / 名 / ミドルネーム + カナ） -->
				<section class="bk-card {step === 'confirm' ? 'hidden' : ''}">
					<h2 class="bk-card-title">{m.hold_card_guest()}</h2>
					<div class="grid gap-4 sm:grid-cols-2">
						<label class="block">
							<span class={label}>{m.name_family()} <em class="bk-req">{m.hold_required()}</em></span>
							<input name="familyName" autocomplete="family-name" required aria-required="true" aria-invalid={form?.errors?.familyName ? 'true' : undefined} value={form?.values?.familyName ?? data.member?.familyName ?? ''} placeholder={m.hold_placeholder_family_name()} class="{input} {form?.errors?.familyName ? 'border-red-400' : ''}" />
						</label>
						<label class="block">
							<span class={label}>{m.name_given()} <em class="bk-req">{m.hold_required()}</em></span>
							<input name="givenName" autocomplete="given-name" required aria-required="true" aria-invalid={form?.errors?.givenName ? 'true' : undefined} value={form?.values?.givenName ?? data.member?.givenName ?? ''} placeholder={m.hold_placeholder_given_name()} class="{input} {form?.errors?.givenName ? 'border-red-400' : ''}" />
						</label>
						<label class="block">
							<span class={label}>{m.name_family_kana()}</span>
							<input name="familyNameKana" value={form?.values?.familyNameKana ?? data.member?.familyNameKana ?? ''} placeholder="ヤマダ" class={input} />
						</label>
						<label class="block">
							<span class={label}>{m.name_given_kana()}</span>
							<input name="givenNameKana" value={form?.values?.givenNameKana ?? data.member?.givenNameKana ?? ''} placeholder="タロウ" class={input} />
						</label>
						<label class="block sm:col-span-2">
							<span class={label}>{m.name_middle()} <span class="text-xs font-normal text-stone-400">{m.name_optional()}</span></span>
							<input name="middleName" autocomplete="additional-name" value={form?.values?.middleName ?? data.member?.middleName ?? ''} class={input} />
						</label>
						{#each [
							{ key: 'phone', label: m.hold_field_phone(), ph: '090-0000-0000', def: data.member?.phone, ac: 'tel' as const, type: 'tel', im: 'tel' as const },
							{ key: 'email', label: m.hold_field_email(), ph: 'mail@example.com', def: data.member?.email, ac: 'email' as const, type: 'email', im: 'email' as const }
						] as field}
							<label class="block">
								<span class={label}>{field.label} <em class="bk-req">{m.hold_required()}</em></span>
								<input
									name={field.key}
									type={field.type}
									inputmode={field.im}
									autocomplete={field.ac}
									required
									aria-required="true"
									aria-invalid={form?.errors?.[field.key] ? 'true' : undefined}
									aria-describedby={form?.errors?.[field.key] ? `err-${field.key}` : undefined}
									value={form?.values?.[field.key as 'phone'] ?? field.def ?? ''}
									placeholder={field.ph}
									class="{input} {form?.errors?.[field.key] ? 'border-red-400' : ''}"
								/>
								{#if form?.errors?.[field.key]}
									<span id="err-{field.key}" class="text-xs text-red-600">{form.errors[field.key]}</span>
								{/if}
							</label>
						{/each}
					</div>

					<div class="mt-4">
						<ContactAddressFields values={form?.values ?? data.member} required error={form?.errors?.address} inputClass={input} />
					</div>

					<!-- 部屋ごとの男女の内訳（プランの設定・既定で聞く。必須・合計＝大人の人数。PMS の部屋別の男女に入る） -->
					{#if multi}
						<!-- 複数室: 部屋ごとの枠（部屋・プラン・人数）に、その部屋の男女の内訳と部屋ごとの質問。回答はその部屋の滞在の備考（PMS）へ -->
						<div class="mt-4 grid gap-3">
							{#each rooms as r, i (r.index)}
								<div class="rounded-lg border border-stone-200 p-3">
									<p class="text-sm font-medium">{m.hold_room_questions({ n: String(r.index) })}</p>
									<p class="mb-2 text-xs text-stone-500">{r.roomName} ／ {r.planName} ／ {m.hold_room_adults({ adults: String(r.adults) })}</p>
									<div class="grid gap-3 sm:grid-cols-2">
										{#if r.askGender}
											<label class="block">
												<span class={label}>{m.hold_gender_label()} <em class="bk-req">{m.hold_required()}</em></span>
												<select name="male_{i}" bind:value={males[i]} required class={input}>
													<option value="">{m.hold_select_placeholder()}</option>
													{#each Array.from({ length: r.adults + 1 }, (_, k) => k) as k (k)}<option value={String(k)}>{m.hold_gender_option({ male: String(k), female: String(r.adults - k) })}</option>{/each}
												</select>
												<input type="hidden" name="female_{i}" value={(males[i] ?? '') === '' ? '' : String(r.adults - Number(males[i]))} />
											</label>
										{/if}
										{#each r.questions as q (q.id)}
											{@render questionField(q, optionKey(q, i), r.questions, i)}
										{/each}
									</div>
								</div>
							{/each}
						</div>
					{:else if data.askGender}
						{@const n = data.hold.adults}
						<label class="mt-4 block sm:max-w-sm">
							<span class={label}>{m.hold_gender_label()} <em class="bk-req">{m.hold_required()}</em></span>
							<select name="male_0" bind:value={male0} required class={input}>
								<option value="">{m.hold_select_placeholder()}</option>
								{#each Array.from({ length: n + 1 }, (_, k) => k) as k (k)}<option value={String(k)}>{m.hold_gender_option({ male: String(k), female: String(n - k) })}</option>{/each}
							</select>
							<input type="hidden" name="female_0" value={male0 === '' ? '' : String(n - Number(male0))} />
						</label>
					{/if}
				</section>

				<!-- ご到着・お食事・ご要望（毎回聞く項目と追加で聞く項目。並び順は管理画面「予約時に聞く項目」で施設ごと・取引先ページと共通） -->
				<section class="bk-card {step === 'confirm' ? 'hidden' : ''}">
					<h2 class="bk-card-title">{m.hold_card_arrival()}</h2>
					<div class="grid gap-4">
						{#each fieldOrder as k (k)}
							{#if k === 'arrival'}
								<div class="grid gap-4 sm:grid-cols-2">
									<label class="block">
										<span class={label}>{isJa && sf ? sf.arrival.label : m.hold_field_arrival()}</span>
										{#if isJa && sf?.arrival.help}<span class="mb-1.5 block whitespace-pre-line text-sm leading-6 text-stone-500">{sf.arrival.help}</span>{/if}
										<!-- 選択肢は施設ごとの毎回聞く項目（取引先ページと共通）。先頭は「未定」 -->
										<select name="arrival" class={input}>
											<option value="">{m.hold_arrival_undecided()}</option>
											{#each sf?.arrival.choices ?? [] as t (t)}<option value={t}>{t}</option>{/each}
										</select>
									</label>
									{#if data.facility.access.shuttle.available}
										<label class="flex items-end gap-2.5 pb-2 text-sm">
											<input type="checkbox" name="shuttle" class="h-5 w-5 accent-[var(--bk-accent)]" />
											<span>{m.hold_field_shuttle()}<span class="block text-xs text-stone-400">{data.facility.access.shuttle.note}</span></span>
										</label>
									{/if}
								</div>
							{:else if k === 'transport' && sf}
								<!-- 宿までの交通手段（「その他」は内容を書く欄・お迎え時間は決めた交通手段のときだけ）。追加で聞く項目の条件にも使う -->
								<fieldset>
									<legend class={label}>{isJa ? sf.transport.label : m.hold_field_transport()}{#if sf.transport.required} <em class="bk-req">{m.hold_required()}</em>{/if}</legend>
									{#if isJa && sf.transport.help}<span class="mb-1.5 block whitespace-pre-line text-sm leading-6 text-stone-500">{sf.transport.help}</span>{/if}
									<div class="flex flex-wrap gap-2">
										{#if !sf.transport.required}
											<label class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition {transport === '' ? 'border-[var(--bk-accent)] bg-[var(--bk-accent-soft)]' : 'border-stone-300'}">
												<input type="radio" name="transport" value="" bind:group={transport} class="accent-[var(--bk-accent)]" />{m.hold_arrival_undecided()}
											</label>
										{/if}
										{#each sf.transport.choices as c (c)}
											<label class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition {transport === c ? 'border-[var(--bk-accent)] bg-[var(--bk-accent-soft)]' : 'border-stone-300'}">
												<input type="radio" name="transport" value={c} bind:group={transport} required={sf.transport.required} class="accent-[var(--bk-accent)]" />{choiceText(c)}
											</label>
										{/each}
									</div>
									{#if showPickup}
										<label class="mt-3 block sm:max-w-sm">
											<span class={label}>{isJa ? sf.pickup.label : m.hold_field_pickup()} <em class="bk-req">{m.hold_required()}</em></span>
											{#if isJa && sf.pickup.help}<span class="mb-1.5 block whitespace-pre-line text-sm leading-6 text-stone-500">{sf.pickup.help}</span>{/if}
											<select name="pickup_time" required class={input}>
												<option value="">{m.hold_select_placeholder()}</option>
												{#each sf.pickup.choices as c (c)}<option value={c}>{c}</option>{/each}
											</select>
										</label>
									{/if}
									{#if transport === TRANSPORT_OTHER}
										<input name="transport_other" required maxlength="60" aria-label={m.hold_field_transport_other()} placeholder={m.hold_field_transport_other()} class="{input} mt-2 sm:max-w-sm" />
									{/if}
								</fieldset>
							{:else if k === 'allergies' && sf}
								<!-- 食物アレルギー（顧客マスタと PMS の事前質問「アレルギー」へ） -->
								<label class="block">
									<span class={label}>{isJa ? sf.allergies.label : m.hold_field_allergies()}</span>
									{#if isJa && sf.allergies.help}<span class="mb-1.5 block whitespace-pre-line text-sm leading-6 text-stone-500">{sf.allergies.help}</span>{/if}
									<textarea name="allergies" rows="2" maxlength="500" class={input} placeholder={isJa ? sf.allergies.placeholder : m.hold_field_allergies_ph()}></textarea>
								</label>
							{:else if k === 'questions'}
								<!-- 予約時に聞く項目（プランの設定: テンプレート or プラン独自）。回答は宿への申し送り（備考）の先頭と PMS の事前質問に入る。
								     1 室は「部屋ごと」の項目もここで 1 回だけ聞く -->
								{#each data.questions as q (q.id)}
									{@render questionField(q, optionKey(q, 0), data.questions, 0)}
								{/each}
								{#if form?.errors?.questions}
									<p class="text-sm text-red-600">{form.errors.questions}</p>
								{/if}
							{:else if k === 'notes'}
								<label class="block">
									<span class={label}>{isJa && sf ? sf.notes.label : m.hold_field_notes()}</span>
									{#if isJa && sf?.notes.help}<span class="mb-1.5 block whitespace-pre-line text-sm leading-6 text-stone-500">{sf.notes.help}</span>{/if}
									<textarea name="notes" rows="3" maxlength="1000" class={input} placeholder={isJa && sf?.notes.placeholder ? sf.notes.placeholder : m.hold_field_notes_ph()}></textarea>
								</label>
							{/if}
						{/each}
					</div>
				</section>

				{#if data.fridgeOptions.length > 0}
					<!-- 冷蔵庫のカスタマイズ（会員＝ブロンズ以上・2026-11-23）。内容は管理画面のオプション（区分「冷蔵庫のカスタマイズ」）。
					     チェックしなければ冷蔵庫にはアルコールも入る（すべて無料・追加分は有料）＝その説明はツールチップ -->
					<fieldset class="bk-card mt-5 p-4 sm:p-6">
						<legend class="flex items-center gap-1.5 px-1 text-sm font-semibold text-stone-800">
							{m.hold_fridge_title()}
							<span class="fridge-tip">
								<button type="button" class="fridge-tip-btn" aria-label={m.hold_fridge_tip_label()} aria-describedby="fridge-tip" onclick={(e) => e.currentTarget.focus()}>?</button>
								<span id="fridge-tip" role="tooltip" class="fridge-tip-body">{m.hold_fridge_tooltip()}</span>
							</span>
						</legend>
						<input type="hidden" name="fridgeShown" value="1" />
						<div class="grid gap-2">
							{#each data.fridgeOptions as o (o.id)}
								<label class="flex min-h-11 items-start gap-2.5 rounded-lg border border-stone-300 px-3 py-2.5 text-sm">
									<input type="checkbox" name="fridgeOption" value={o.id} class="mt-0.5 h-4 w-4 accent-[var(--bk-accent)]" />
									<span>
										<span class="font-medium text-stone-800">{o.name}</span>
										{#if o.description}<span class="mt-0.5 block text-xs text-stone-500">{o.description}</span>{/if}
									</span>
								</label>
							{/each}
						</div>
						{#if form?.errors && 'fridge' in form.errors}
							<p role="alert" class="mt-2 text-xs text-red-600">{form.errors.fridge}</p>
						{/if}
					</fieldset>
				{/if}
				{#if data.canChoosePlatinumTiming}
					<fieldset class="bk-card mt-5 p-4 sm:p-6">
						<legend class="px-1 text-sm font-semibold text-stone-800">{m.hold_platinum_timing_title()}</legend>
						<p class="mb-3 text-sm text-stone-600">{m.hold_platinum_timing_note()}</p>
						<div class="grid gap-2">
							{#each [['', m.hold_platinum_timing_none()], ['early', m.hold_platinum_early()], ['late', m.hold_platinum_late()]] as [value, label] (value)}
								<label class="flex min-h-11 items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm">
									<input type="radio" name="platinumTiming" {value} bind:group={platinumTiming} class="accent-[var(--bk-accent)]" />
									<span>{label}</span>
								</label>
							{/each}
						</div>
						{#if form?.errors && 'platinumTiming' in form.errors}
							<p role="alert" class="mt-2 text-xs text-red-600">{form.errors.platinumTiming}</p>
						{/if}
					</fieldset>
				{/if}
				{#if favRooms.length > 0}
					<!-- お気に入りの部屋の指定（会員・その日程に空いているお気に入りの部屋があるときだけ）。料金はかからない。
					     確定のときに DB がもう一度空きを確かめ、空いていれば部屋指定する（埋まっていたら指定せずに確定・完了画面で伝える） -->
					<section class="bk-card {step === 'confirm' ? 'hidden' : ''}">
						<h2 class="bk-card-title">{m.hold_fav_heading()}</h2>
						<div class="grid gap-3 text-sm">
							{#each favRooms as fr (fr.index)}
								<div>
									{#if multi}<p class="mb-1 text-xs text-stone-500">{m.hold_fav_room_n({ n: String(fr.index), room: fr.roomName })}</p>{/if}
									<div class="flex flex-wrap gap-2" role="radiogroup">
										<label class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition {(favPicked[fr.index] ?? '') === '' ? 'border-[var(--bk-accent)] bg-[var(--bk-accent-soft)]' : 'border-stone-300'}">
											<input type="radio" name="fav_{fr.index}" value="" checked={(favPicked[fr.index] ?? '') === ''} onchange={() => (favPicked[fr.index] = '')} class="accent-[var(--bk-accent)]" />
											{m.hold_fav_none()}
										</label>
										{#each fr.choices as c (c.roomId)}
											{@const takenElsewhere = Object.entries(favPicked).some(([i, id]) => Number(i) !== fr.index && id === c.roomId)}
											<label class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition {favPicked[fr.index] === c.roomId ? 'border-red-300 bg-red-50 font-medium text-red-700' : 'border-stone-300'} {takenElsewhere ? 'opacity-40' : ''}">
												<input type="radio" name="fav_{fr.index}" value={c.roomId} checked={favPicked[fr.index] === c.roomId} disabled={takenElsewhere} onchange={() => (favPicked[fr.index] = c.roomId)} class="accent-red-600" />
												♥ {m.hold_fav_room({ name: c.name, number: c.roomNumber })}
											</label>
										{/each}
									</div>
								</div>
							{/each}
							<p class="text-xs text-stone-500">{m.hold_fav_note()}</p>
							{#if form?.errors && 'favoriteRoom' in form.errors && form.errors.favoriteRoom}
								<p role="alert" class="text-xs text-red-600">{form.errors.favoriteRoom}</p>
							{/if}
						</div>
					</section>
				{/if}

				<!-- 確認の段: 入力した内容の一覧（取引先ページと同じ形） -->
				{#if step === 'confirm'}
					<section class="bk-card">
						<h2 class="bk-card-title">{m.hold_card_confirm()}</h2>
						<dl class="bk-confirm text-[15px]">
							<dt>{m.hold_confirm_stay()}</dt><dd>{m.hold_confirm_stay_val({ date: formatDateLong(data.hold.checkin), nights: String(data.hold.nights) })}</dd>
							{#if multi}
								<dt>{m.hold_summary_room()}</dt>
								<dd>{#each rooms as r, i (r.index)}{#if i > 0}<br />{/if}{m.hold_room_n({ n: String(r.index) })} {r.roomName} ／ {r.planName} ／ {m.hold_room_adults({ adults: String(r.adults) })}{/each}</dd>
							{:else}
								<dt>{m.hold_summary_room()}</dt><dd>{data.room.name}</dd>
								<dt>{m.hold_summary_plan()}</dt><dd>{data.plan.name}</dd>
								<dt>{m.hold_summary_nights_adults()}</dt><dd>{m.hold_nights_adults_val({ nights: String(data.hold.nights), guests: guestsLabel(totalAdults) })}</dd>
							{/if}
							<dt>{m.hold_confirm_guest()}</dt>
							<dd>
								{values.familyName} {values.middleName ?? ''} {values.givenName}{values.familyNameKana || values.givenNameKana ? `（${values.familyNameKana ?? ''} ${values.givenNameKana ?? ''}）` : ''}
							</dd>
							<dt>{m.hold_field_phone()}</dt><dd>{values.phone}</dd>
							<dt>{m.hold_field_email()}</dt><dd class="break-all">{values.email}</dd>
							<dt>{m.contact_address()}</dt><dd>{[values.zip, values.address, values.address2].filter(Boolean).join(' ')}</dd>
							{#if multi}
								{#each rooms as r, i (r.index)}
									{@const mv = values[`male_${i}`]}
									{#if r.askGender && mv !== undefined && mv !== ''}<dt>{m.hold_room_n({ n: String(r.index) })} {m.hold_gender_label()}</dt><dd>{m.hold_gender_option({ male: mv, female: String(r.adults - Number(mv)) })}</dd>{/if}
								{/each}
							{:else if data.askGender && values.male_0}
								<dt>{m.hold_gender_label()}</dt><dd>{m.hold_gender_option({ male: values.male_0, female: String(data.hold.adults - Number(values.male_0)) })}</dd>
							{/if}
							<dt>{isJa && sf ? sf.arrival.label : m.hold_field_arrival()}</dt><dd>{values.arrival || m.hold_arrival_undecided()}{values.shuttle ? ` ／ ${m.hold_field_shuttle()}` : ''}</dd>
							{#if values.transport && sf}
								<dt>{isJa ? sf.transport.label : m.hold_field_transport()}</dt>
								<dd>{values.transport === TRANSPORT_OTHER ? `${choiceText(values.transport)}（${values.transport_other ?? ''}）` : choiceText(values.transport)}{values.pickup_time ? ` ／ ${isJa ? sf.pickup.label : m.hold_field_pickup()} ${values.pickup_time}` : ''}</dd>
							{/if}
							{#if values.allergies}<dt>{isJa && sf ? sf.allergies.label : m.hold_field_allergies()}</dt><dd class="whitespace-pre-wrap">{values.allergies}</dd>{/if}
							{#each confirmAnswers as a (a.key)}<dt>{a.label}</dt><dd class="whitespace-pre-wrap">{a.value}</dd>{/each}
							{#if values.notes}<dt>{isJa && sf ? sf.notes.label : m.hold_field_notes()}</dt><dd class="whitespace-pre-wrap">{values.notes}</dd>{/if}
							{#each favRooms as fr (fr.index)}
								{@const id = values[`fav_${fr.index}`]}
								{#if id}<dt>{m.hold_fav_heading()}</dt><dd>{multi ? `${m.hold_room_n({ n: String(fr.index) })} ` : ''}{favNameOf(fr.index, id)}</dd>{/if}
							{/each}
							{#if pointsApplied > 0}<dt>{m.hold_confirm_points()}</dt><dd>{pointsApplied.toLocaleString()}{m.common_point_unit()}</dd>{/if}
							<dt>{m.hold_confirm_pay()}</dt><dd>{payLabel}</dd>
						</dl>
					</section>
				{/if}

				<!-- お支払い（入力・確認のどちらにも出す。カードの入力欄は確認の段で出す） -->
				<section class="bk-card">
					<h2 class="bk-card-title">{m.hold_card_payment()}</h2>
					<div class="grid gap-4 text-sm">
						{#if data.member}
							<div class="rounded-lg bg-emerald-50 p-3">
								<p class="font-medium text-emerald-800">{m.hold_points_label({ balance: data.member.balance.toLocaleString() })}</p>
								<div class="mt-2 flex items-center gap-2">
									<input type="number" name="points" min="0" max={data.member.balance} bind:value={pointsInput} readonly={paying || step === 'confirm'} class="{input} w-32" />
									<span class="text-stone-500">{m.hold_points_use()}</span>
								</div>
							</div>
						{/if}
						{#if data.member && data.couponsEnabled}
							<div class="rounded-lg border border-stone-200 p-3">
								{#if coupon}
									<div class="flex flex-wrap items-center justify-between gap-2">
										<span>{coupon.name} · −{formatPrice(coupon.amount)}</span>
										{#if step === 'input'}
											<button class="min-h-10 px-2 text-brand-800 underline" type="button" disabled={paying}
												onclick={() => { coupon = null; couponInput = ''; }}>{m.booking_coupon_remove()}</button>
										{/if}
									</div>
								{:else if step === 'input'}
									{#if data.myCoupons?.length}
										<!-- お持ちのクーポン（2026-11-24）。押すとコード欄に入れて、そのまま確かめる -->
										<p class={label}>{m.booking_my_coupons()}</p>
										<ul class="mb-3 space-y-2">
											{#each data.myCoupons as mc (mc.code)}
												<li class="flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2">
													<span class="min-w-0 flex-1">
														<span class="block truncate font-medium text-stone-800">{mc.name}</span>
														<span class="block text-sm text-stone-500">
															{mc.discountType === 'percent' ? m.coupon_discount_percent({ value: String(mc.discountValue) }) : m.coupon_discount_fixed({ value: mc.discountValue.toLocaleString(getLocale()) })}{#if mc.minTotal > 0} · {m.coupon_min_total({ amount: mc.minTotal.toLocaleString(getLocale()) })}{/if}
														</span>
													</span>
													<button class="min-h-10 shrink-0 rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium" type="button"
														disabled={couponBusy || paying}
														onclick={() => { couponInput = mc.code; void applyCoupon(); }}>{m.booking_coupon_use()}</button>
												</li>
											{/each}
										</ul>
									{/if}
									<label for="booking-coupon-code" class={label}>{m.booking_coupon_code()}</label>
									<div class="flex gap-2">
										<input id="booking-coupon-code" bind:value={couponInput} maxlength="32" autocapitalize="characters" spellcheck={false}
											disabled={couponBusy || paying} class="{input} min-w-0 flex-1"
											onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void applyCoupon(); } }} />
										<button class="min-h-11 shrink-0 rounded-lg border border-stone-300 px-3 font-medium"
											type="button" disabled={couponBusy || paying || !couponInput.trim()} onclick={applyCoupon}>{m.booking_coupon_apply()}</button>
									</div>
									{#if couponError}<p role="alert" class="mt-2 text-sm text-red-800">{couponError}</p>{/if}
								{/if}
							</div>
						{/if}

						<!-- 確認の段では「入力に戻る」から支払方法を選び直す。 -->
						<fieldset class="space-y-2 {step === 'confirm' ? 'opacity-80' : ''}" disabled={paying} inert={step === 'confirm'}>
							<legend class={label}>{m.pay_choose()} <em class="bk-req">{m.hold_required()}</em></legend>
							{#if justRegistered && !isGuest}
								<p class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{m.pay_member_registered()}</p>
							{/if}
							<input type="hidden" name="payment" value={canPay ? payValue : ''} />
							<input type="hidden" name="payGroup" value={group} />

							<!-- 現地決済を先、クレジットカードを後に並べ、カード情報がクレジットカードの枠のすぐ下に来るようにする（2026-11-22 指示） -->
							{#if hasOnsite}
								<div class="rounded-xl border bg-white {group === 'onsite' ? 'border-slate-700' : 'border-stone-300'}">
									<label class="flex min-h-12 cursor-pointer items-center gap-2.5 px-3 py-3">
										<input type="radio" name="paymentChannel" value="onsite" checked={group === 'onsite'} onchange={() => (selectedGroup = 'onsite')} class="size-4 shrink-0 accent-slate-800" aria-describedby="accepted-onsite-payments" />
										<span class="flex-1 font-medium">{payText('onsite', 'label', m.pay_group_onsite())}</span>
									</label>
									<div id="accepted-onsite-payments" class="space-y-1 px-3 pb-3 pl-9 text-sm text-stone-600">
										{#if onsiteMethods.length}
											<p>{m.pay_onsite_accepted({ methods: new Intl.ListFormat(getLocale()).format(onsiteMethods.map(onsiteMethodLabel)) })}</p>
										{/if}
										{#if payText('onsite', 'note', '')}<p class="whitespace-pre-line text-xs">{payText('onsite', 'note', '')}</p>{/if}
									</div>
								</div>
							{/if}

							{#if hasOnline}
								<div class="rounded-xl border bg-white {group !== 'onsite' ? 'border-slate-700' : 'border-stone-300'}">
									<label class="flex min-h-12 cursor-pointer flex-wrap items-center gap-2.5 px-3 py-3">
										<input type="radio" name="paymentChannel" value="online" checked={group !== 'onsite'}
											onchange={() => (selectedGroup = hasPrepay ? 'online' : 'checkout')} class="size-4 shrink-0 accent-slate-800" />
										<span class="font-medium">{m.pay_group_card()}</span>
									</label>
									{#if isGuest && !hasPrepay && hasCheckout}
										<!-- 非会員（2026-11-22）: チェックアウト日決済を上に、選んだ状態で固定して出す。予約時決済はその下に選べない状態で出し、
										     会員登録（またはログイン）すると選べることが分かるようにする -->
										<div class="flex min-h-11 items-center gap-2 border-t border-stone-200 px-3 pl-9 text-sm">
											<!-- 選んだ状態で固定（disabled の radio は灰色で選択が分かりにくいので、選択済みの丸を描く） -->
											<span class="grid size-4 shrink-0 place-items-center rounded-full border-2 border-slate-800" aria-hidden="true"><span class="size-2 rounded-full bg-slate-800"></span></span>
											<span class="font-medium text-stone-900">{payText('online_checkout', 'label', m.pay_group_checkout())}</span>
										</div>
										<p class="whitespace-pre-line px-3 pb-3 pl-[3.75rem] text-xs text-stone-600">{payText('online_checkout', 'note', m.pay_checkout_note())}</p>
										{#if memberRate > 0 || memberPoints > 0}
											<div class="border-t border-stone-200 bg-stone-50/60 px-3 py-2.5 pl-9 text-sm">
												<div class="flex flex-wrap items-center gap-2">
													<input type="radio" disabled class="size-4 shrink-0" aria-label={payText('online_now', 'label', m.pay_group_online())} />
													<span class="text-stone-400">{payText('online_now', 'label', m.pay_group_online())}</span>
													<span class="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">{memberRate > 0 ? m.pay_member_save_rate({ rate: percentText(memberRate) }) : m.pay_member_save_points({ points: memberPoints.toLocaleString() })}</span>
												</div>
												<p class="mt-1 pl-6 text-xs text-stone-600">{m.pay_member_only_note()}</p>
												<p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs">
													<a href={`/auth/register?next=${encodeURIComponent(backHere)}`} class="font-medium text-accent-600 underline hover:text-accent-500">{m.pay_member_register()}</a>
													<a href={`/auth/login?next=${encodeURIComponent(backHere)}`} class="text-stone-600 underline hover:text-brand-800">{m.pay_member_login()}</a>
												</p>
												<p class="mt-0.5 pl-6 text-xs text-stone-400">{m.pay_member_back_note()}</p>
											</div>
										{/if}
									{:else}
									{#if hasPrepay}
										<!-- お得になるのは予約時決済なので、割引・ポイントの印はこの段に付ける（2026-11-22 指示） -->
										{#if canChooseTiming && group !== 'onsite'}
											<label class="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 border-t border-stone-200 px-3 pl-9 text-sm">
												<input type="radio" name="cardTiming" value="online" checked={group === 'online'} onchange={() => (selectedGroup = 'online')} class="size-4 shrink-0 accent-slate-800" />
												<span>{payText('online_now', 'label', m.pay_group_online())}</span>
												{@render prepayBadges()}
											</label>
										{:else}
											<p class="flex flex-wrap items-center gap-2 px-3 pb-2 pl-9 text-sm text-stone-600">
												<span>{payText('online_now', 'label', m.pay_group_online())}</span>
												{@render prepayBadges()}
											</p>
										{/if}
										{#if isGuest && (memberRate > 0 || memberPoints > 0)}{@render guestHint(false)}{/if}
									{/if}
									{#if group === 'online' && hasPrepay}
										<!-- 予約時決済の説明は、予約時決済を選んだときだけ開く（2026-11-22 指示） -->
										<div class="space-y-1.5 border-t border-stone-200/80 px-3 py-2.5 pl-9">
											{#if prepayAmount > 0}
												<!-- 割引額と割引後の額は右の明細に出るので、ここは「早期決済割（15%）適用」だけ -->
												<p class="font-medium text-brand-900">{m.pay_discount_applied({ label: discountLabel })}</p>
											{/if}
											{#if memberPageTiersText}
												<p class="text-xs text-stone-600">{memberPageTiersText}</p>
											{/if}
											{#if bonusPoints > 0}
												<!-- 早期決済ポイント: 金額は下がらないのでポイントで見せる。会員ランクの通常ポイントとは別に付く -->
												<p class="font-medium text-emerald-800">{m.pay_points_compare({ points: bonusPoints.toLocaleString() })}</p>
												<p class="text-xs text-stone-600">{m.pay_points_grant({ rate: bonusRate, points: bonusPoints.toLocaleString() })}</p>
												<p class="text-xs text-stone-500">{m.pay_points_cancel_note()}</p>
											{/if}
											<!-- 返金の決まり（キャンセル料のかからない期間は事務手数料、かかる期間はキャンセル料・2026-11-22）。率の無い予約はキャンセル料だけなので書かない -->
											{#if data.adminFeePercent}
												<p class="text-sm text-stone-700">
													{m.pay_prepay_nonrefund_simple({ percent: `${data.adminFeePercent}%` })}
													<a href="/legal/yakkan" target="_blank" rel="noopener noreferrer" class="underline">{m.footer_yakkan()}</a>
												</p>
											{/if}
											{#if !data.inline}<p class="text-xs text-stone-500">{m.pay_prepay_note()}</p>{/if}
											{#if payText('online_now', 'note', '')}<p class="whitespace-pre-line text-xs text-stone-600">{payText('online_now', 'note', '')}</p>{/if}
										</div>
									{/if}
									{#if hasCheckout && (group !== 'onsite' || !canChooseTiming)}
										{#if canChooseTiming}
											<label class="flex min-h-11 cursor-pointer items-center gap-2 border-t border-stone-200 px-3 pl-9 text-sm">
												<input type="radio" name="cardTiming" value="checkout" checked={group === 'checkout'} onchange={() => (selectedGroup = 'checkout')} class="size-4 shrink-0 accent-slate-800" />
												<span>{payText('online_checkout', 'label', m.pay_group_checkout())}</span>
											</label>
										{:else}
											<p class="border-t border-stone-200 px-3 py-2.5 pl-9 text-sm text-stone-600">{payText('online_checkout', 'label', m.pay_group_checkout())}</p>
										{/if}
										{#if group === 'checkout'}
											<p class="whitespace-pre-line px-3 pb-3 pl-9 text-xs text-stone-600">{payText('online_checkout', 'note', m.pay_checkout_note())}</p>
										{/if}
									{/if}
									{/if}
								</div>
							{/if}

							{#if !canPay}
								<p role="status" class="text-sm text-stone-700">{m.pay_unavailable()}</p>
							{:else if data.payFallback}
								<p class="text-xs text-stone-500">{m.pay_fallback_note()}</p>
							{:else if data.memberOnsiteHint}
								<!-- 非会員は予約時決済のみのプラン。会員なら現地払いも選べる（控えめに案内） -->
								<p class="text-xs text-stone-500">
									{m.pay_member_onsite_hint()}
									<a href="/auth/login?next={encodeURIComponent(page.url.pathname + page.url.search)}" class="ml-1 underline hover:text-brand-800">{m.pay_member_onsite_login()}</a>
								</p>
							{/if}
							{#if form?.errors && 'payment' in form.errors && form.errors.payment}
								<p role="alert" class="text-xs text-red-600">{form.errors.payment}</p>
							{/if}
						</fieldset>

						{#if inlinePay}
							<!-- カードは入力の段で入れてもらい、確認の段までそのまま持ち越す（取引先ページと同じ・2026-11-22 指示）。
							     部品は段を切り替えても作り直さないので、入れた番号は確認の段でも残る。確定（請求・登録）は確認の段のボタンで行う。
							     Apple Pay / Google Pay は入力欄の上。入力の段で押されたときは確認の段へ進むよう案内する（validate）。Link の保存欄は出さない。
							     チェックアウト日決済はカード登録（同意文つき・請求はチェックアウト日）。部品は作り直さず、方式（請求・登録）だけ差し替える（入れたカードは残る） -->
							<div id="hold-card" class="scroll-mt-24 space-y-3 rounded-lg border border-stone-200 p-3">
								<div class="flex items-baseline justify-between gap-3">
									<h3 class="text-sm font-medium text-brand-900">{checkoutCard ? m.pay_checkout_heading() : m.pay_card_heading()}</h3>
									<p class="text-sm font-medium tabular-nums text-brand-900">{m.pay_total_due()} {formatPrice(charge.charge)}</p>
								</div>
								<StripePayment
									bind:this={payRef}
									publishableKey={data.publishableKey}
									mode={checkoutCard ? 'setup' : 'payment'}
									consentText={checkoutCard ? m.pay_checkout_consent({ date: chargeOnText, amount: formatPrice(charge.charge) }) : null}
									amount={charge.charge}
									locale={stripeLocale()}
									texts={payTexts}
									unavailableText={m.pay_unavailable()}
									validate={validatePayment}
									oncompletechange={(c) => (cardState = c ? 'complete' : 'incomplete')}
									prepare={preparePayment}
									onconfirmed={onPaid}
									onbusychange={(b) => (paying = b)}
									onerror={() => (payMessage = '')}
									customerSession={loadMemberSession}
								/>
								{#if !checkoutCard}<p class="text-xs text-stone-500">{m.pay_inline_note()}</p>{/if}
							</div>
						{/if}

						{#if payMessage}
							<p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{payMessage}</p>
						{/if}
					</div>
				</section>
			</div>

			<!-- 予約内容（右欄・取引先ページと同じ並び: 写真・施設 → 日程・人数・お部屋・プラン → 料金 → 取消の案内 → ボタン） -->
			<aside id="hold-summary" class="bk-card h-fit scroll-mt-20 lg:sticky lg:top-20">
				<div class="flex items-start gap-3">
					{#if data.room.photos[0]?.url}<img src={data.room.photos[0].url} alt="" class="h-[72px] w-[72px] shrink-0 rounded-lg object-cover" />{/if}
					<div class="min-w-0">
						<p class="text-lg font-bold leading-snug">{data.facility.name}</p>
						<div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
							<p class="text-sm text-stone-500">{m.hold_summary_heading()}</p>
							{#if memberPage}{@render specialRateBadge()}{/if}
						</div>
					</div>
				</div>
				<dl class="mt-4 space-y-2.5 text-sm">
					{#if multi}
						<!-- 複数室: 部屋ごとの枠（部屋名／プラン名／大人 N 名／宿泊料金） -->
						<div>
							<dt class="text-stone-500">{m.hold_rooms_label({ n: String(rooms.length) })}</dt>
							<dd class="mt-1 space-y-1.5">
								{#each rooms as r (r.index)}
									<div class="rounded-lg border border-stone-200 px-2.5 py-1.5">
										<p class="text-xs text-stone-500">{m.hold_room_n({ n: String(r.index) })}</p>
										<p class="font-medium text-brand-900">{r.roomName}</p>
										<p class="text-xs text-stone-600">{r.planName}</p>
										<p class="flex justify-between text-xs text-stone-600"><span>{m.hold_room_adults({ adults: String(r.adults) })}</span><span class="tabular-nums">{formatPrice(r.quote.total)}</span></p>
										{#if perkTitles(r.memberPerks)}<p class="mt-0.5 text-xs text-amber-800">{m.member_page_perks()}: {perkTitles(r.memberPerks)}</p>{/if}
									</div>
								{/each}
							</dd>
						</div>
					{:else}
						<!-- 項目名の下に内容を出す（長いプラン名が右寄せで3段にならないように・2026-11-22 指示） -->
						<div><dt class="text-xs text-stone-500">{m.hold_summary_room()}</dt><dd class="mt-0.5">{data.room.name}</dd></div>
						<div><dt class="text-xs text-stone-500">{m.hold_summary_plan()}</dt><dd class="mt-0.5">{data.plan.name}</dd></div>
						{#if perkTitles(rooms[0]?.memberPerks)}
							<div><dt class="text-xs text-stone-500">{m.member_page_perks()}</dt><dd class="mt-0.5 text-amber-800">{perkTitles(rooms[0]?.memberPerks)}</dd></div>
						{/if}
					{/if}
					<div><dt class="text-xs text-stone-500">{m.hold_summary_checkin()}</dt><dd class="mt-0.5">{formatDateLong(data.hold.checkin)}</dd></div>
					<div><dt class="text-xs text-stone-500">{m.hold_summary_nights_adults()}</dt><dd class="mt-0.5">{m.hold_nights_adults_val({ nights: String(data.hold.nights), guests: guestsLabel(totalAdults) })}</dd></div>
				</dl>
				<div class="mt-4 border-t border-stone-200 pt-3">
					<PriceBreakdown couponDiscount={couponAmount} quote={{ ...data.groupQuote, pointsUsed: pointsApplied, payable: data.groupQuote.total - couponAmount - pointsApplied }} rooms={rooms.map((r) => ({ lines: r.quote.lines, name: r.roomName }))} />
					{#if inlineCard && charge.discount > 0}
						<div class="mt-1.5 flex justify-between text-sm text-red-600">
							<span>{discountLabel}</span>
							<span class="tabular-nums">-{formatPrice(charge.discount)}</span>
						</div>
					{/if}
					{#if inlinePay && data.bathTax > 0}
						<div class="mt-1.5 flex justify-between text-sm text-stone-600">
							<span>{m.pay_bath_tax_detail({ people: String(totalAdults), nights: String(data.hold.nights) })}</span>
							<span class="tabular-nums">{formatPrice(charge.bathTax)}</span>
						</div>
					{/if}
					{#if inlinePay && (data.bathTax > 0 || charge.discount > 0)}
						<div class="mt-3 flex items-end justify-between gap-3 border-t border-stone-200 pt-3">
							<span class="font-bold">{m.pay_total_due()}</span>
							<span class="text-2xl font-bold tabular-nums leading-none text-brand-900">{formatPrice(charge.charge)}</span>
						</div>
					{:else if data.bathTax > 0 && !inlinePay}
						<p class="mt-2 text-xs text-stone-500">{m.pay_bath_tax_onsite({ amount: formatPrice(data.bathTax) })}</p>
					{/if}
					{#if pointsToEarn > 0}
						<!-- 付与予定のポイント（会員ランクの通常ポイント）。ポイント利用欄には今使える残高だけを出し、付与予定はここに分ける -->
						<div class="mt-2 flex justify-between text-sm text-emerald-700">
							<span>{m.hold_points_earn()}</span>
							<span class="tabular-nums">+{pointsToEarn.toLocaleString()}{m.common_point_unit()}</span>
						</div>
						<p class="text-right text-xs text-stone-500">{m.hold_points_earn_note()}</p>
					{/if}
				</div>
				<section aria-labelledby="hold-cancel-terms" class="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-stone-700">
					<h2 id="hold-cancel-terms" class="mb-2 font-bold">{m.plan_detail_cancel_policy()}</h2>
					{#each rooms as room (room.index)}
						<div class:mt-3={room.index > 1}>
							{#if multi}<h3 class="mb-1 font-medium">{m.hold_cancel_policy_room({ n: String(room.index) })}</h3>{/if}
							<BookingCancelTerms policy={room.cancellationPolicy} checkin={data.hold.checkin} />
							{#if room.cancellationPolicy.note}<p class="mt-2">{room.cancellationPolicy.note}</p>{/if}
						</div>
					{/each}
				</section>

				{#if data.needsTurnstile}
					<!-- 非会員だけ、予約確定の前に Turnstile（フォームの中に置き、現地払いの送信にもカードの準備にも同じトークンが乗る）。
					     入力の段から置いておき、確認の段へ進むまでに判定を済ませる -->
					<div class="mt-4"><Turnstile bind:this={turnstile} action="booking-confirm" waitOnSubmit={false} /></div>
				{/if}
				{#if clientError}<p class="mt-3 text-sm text-red-600" role="alert">{clientError}</p>{/if}
				{#if step === 'input'}
					<!-- submit にして Enter キーでも確認の段へ進めるようにする（use:enhance が送信を止めて toConfirm に回す） -->
					<button type="submit" disabled={!canPay} class="bk-primary mt-4 w-full text-base">{m.hold_to_confirm()}</button>
				{:else}
					<!-- 個人情報の同意（予約確認・事前チェックインなどの SMS / メールの案内を含む）。確定の直前に必須で取る -->
					<div class="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
						<p class="leading-6 text-stone-600">{m.hold_consent_notice()}</p>
						<a href="/legal/privacy" target="_blank" rel="noopener" class="mt-1 inline-block text-accent-600 underline">{m.hold_consent_link()}</a>
						<label class="mt-3 flex min-h-11 cursor-pointer items-center gap-2 font-medium text-brand-900">
							<input type="checkbox" name="privacyConsent" value="1" required bind:checked={privacyAgreed} disabled={paying} class="h-5 w-5 shrink-0" />
							<!-- 狭い右欄でも「必須」が縦に割れないよう、文と一緒に流す -->
							<span class="min-w-0">{m.hold_consent_label()}<em class="bk-req ml-1 whitespace-nowrap">{m.hold_required()}</em></span>
						</label>
					</div>
					<button
						type="submit"
						disabled={!canPay || paying || data.preview || !privacyAgreed || (inlinePay && !data.publishableKey)}
						class="bk-primary mt-4 w-full text-base"
					>
						{#if checkoutCard}
							{paying ? m.pay_checkout_processing() : m.pay_submit_inline()}
						{:else if inlineCard}
							{paying ? m.pay_processing_inline() : m.pay_submit_inline()}
						{:else}
							{isPrepay ? m.hold_submit_card() : m.hold_submit_local()}
						{/if}
					</button>
					{#if data.preview}
						<p class="mt-2 text-center text-xs text-amber-800">プレビュー中のため、予約は確定できません。</p>
					{:else if checkoutCard}
						<p class="mt-2 text-center text-xs text-stone-500">{m.pay_checkout_submit_note({ date: chargeOnText })}</p>
					{:else if inlineCard}
						<p class="mt-2 text-center text-xs text-stone-500">{m.pay_submit_inline_note({ amount: formatPrice(charge.charge) })}</p>
					{:else if !isPrepay}
						<p class="mt-2 text-center text-xs text-stone-500">{m.hold_local_payment_note()}</p>
					{/if}
					{#if !data.preview}
						<!-- 在庫は予約確定の時点で押さえる（入力中は押さえていない・2026-11-19）。さりげなく添える -->
						<p class="mt-1 text-center text-xs text-stone-400">{m.hold_room_not_reserved_note()}</p>
					{/if}
					<button type="button" onclick={backToInput} disabled={paying} class="mt-2 w-full rounded-lg border border-stone-300 px-4 py-2.5 text-sm hover:bg-stone-50 disabled:opacity-50">{m.hold_back_to_input()}</button>
				{/if}
			</aside>
		</form>
	{/if}
</div>

{#snippet questionField(q: BookingQuestion, key: string, list: BookingQuestion[], roomIndex: number)}
	{#if !shownQ(q, list, roomIndex)}
		<!-- 条件に合わないので聞かない -->
	{:else if q.type === 'check'}
		<label class="flex items-center gap-2.5 text-sm">
			<input type="checkbox" name={`opt_${key}`} required={q.required} class="h-5 w-5 accent-[var(--bk-accent)]" />
			<span>{q.label}{#if q.required} <em class="bk-req">{m.hold_required()}</em>{/if}</span>
		</label>
	{:else if q.type === 'select'}
		<label class="block sm:max-w-sm">
			<span class={label}>{q.label}{#if q.required} <em class="bk-req">{m.hold_required()}</em>{/if}</span>
			<select name={`opt_${key}`} required={q.required} class={input}>
				<option value="">{m.hold_select_placeholder()}</option>
				{#each q.choices as c}<option value={c}>{c}</option>{/each}
			</select>
		</label>
	{:else}
		<label class="block">
			<span class={label}>{q.label}{#if q.required} <em class="bk-req">{m.hold_required()}</em>{/if}</span>
			<input name={`opt_${key}`} required={q.required} maxlength="500" class={input} />
		</label>
	{/if}
{/snippet}

<style>
	/* 冷蔵庫のカスタマイズの説明（ツールチップ）。ホバー・フォーカス（スマホはタップ）で出す */
	.fridge-tip { position: relative; display: inline-flex; }
	.fridge-tip-btn {
		display: inline-grid; place-items: center; width: 1.25rem; height: 1.25rem;
		border: 1px solid #a8a29e; border-radius: 9999px; color: #57534e;
		font-size: 0.7rem; font-weight: 700; line-height: 1; cursor: help;
	}
	.fridge-tip-btn:focus-visible { outline: 2px solid #78603b; outline-offset: 2px; }
	.fridge-tip-body {
		position: absolute; left: -7rem; bottom: calc(100% + 0.5rem); z-index: 20;
		width: max-content; max-width: min(18rem, calc(100vw - 3rem));
		padding: 0.6rem 0.75rem; border-radius: 0.5rem; background: #292524; color: #fafaf9;
		font-size: 0.75rem; font-weight: 400; line-height: 1.6;
		opacity: 0; visibility: hidden; transition: opacity 0.15s;
		pointer-events: none;
	}
	.fridge-tip:hover .fridge-tip-body,
	.fridge-tip-btn:focus + .fridge-tip-body { opacity: 1; visibility: visible; }
</style>
