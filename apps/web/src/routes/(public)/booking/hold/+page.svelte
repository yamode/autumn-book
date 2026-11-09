<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import BookingSteps from '$lib/components/booking/BookingSteps.svelte';
	import HoldTimer from '$lib/components/HoldTimer.svelte';
	import PriceBreakdown from '$lib/components/PriceBreakdown.svelte';
	import CancelPolicyNote from '$lib/components/CancelPolicyNote.svelte';
	import StripePayment from '$lib/components/payment/StripePayment.svelte';
	import Turnstile from '$lib/components/Turnstile.svelte';
	import type { PaymentConfirmed, PaymentLocale, PaymentPrepareResult, PaymentTexts } from '$lib/components/payment/types';
	import { directChargeOf, payTextFor, type PayOption, type PayTextGroup } from '$lib/direct-payment';
	import { percentText } from '$lib/early-prepay';
	import { addDays, formatDateLong, formatPrice } from '$lib/format';
	import { gaEvent } from '$lib/analytics';
	import { getLocale } from '$lib/paraglide/runtime';
	import { guestsLabel } from '$lib/components/guests';
	import * as m from '$lib/paraglide/messages';
	import { viaCrumb } from '$lib/booking-nav';
	import { isQuestionShown, type BookingQuestion } from '$lib/booking-questions';
	import { DEFAULT_FIELD_ORDER, TRANSPORT_OTHER } from '$lib/booking-standard-fields';
	import { BOOKING_COLUMNS_CLASS, BOOKING_INPUT_CLASS, BOOKING_LABEL_CLASS, BOOKING_PAGE_CLASS } from '$lib/booking-layout';

	let { data, form } = $props();
	// プラン詳細の手前に通ってきたページ（パンくず用）
	let viaStep = $derived(data.expired ? null : viaCrumb(data.via, data.facility));

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
	let multi = $derived(rooms.length > 1);
	// 特別会員の専用ページ経由の束（docs/vip-member-page.md §13.4.3-4）。公式の束は null
	let memberPage = $derived(data.expired ? null : data.memberPage);
	function memberCancelModeLabel(mode: string): string {
		return mode === 'page' ? m.member_cancel_mode_page() : mode === 'rank' ? m.member_cancel_mode_rank() : m.member_cancel_mode_favorable();
	}
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
	// 「オンライン決済（ご予約時）」と「現地決済（チェックアウト時）」の2グループに分けて見せる。
	// 現地決済を選んだら、その中で「チェックアウト時のお支払い予定方法」を 現金 / クレジットカード / PayPay の順で選ぶ（2026-11-01・既定は現金。
	// PayPay は目立たせすぎない）。ふるさと納税 宿泊補助券を併用する人はチェックボックスで知らせる（furusatoVoucher=on）。
	// サーバへは payment=card / paypay / onsite_paypay / onsite_card / onsite_cash で送る。現地払いは予約のまま備考で宿へ申し送る
	type OnsiteMethod = 'paypay' | 'card' | 'cash';
	type PayChoice = PayOption | `onsite_${OnsiteMethod}`;
	// 施設でオンの内訳だけ（管理画面の支払方法でオン/オフ）。並びは 現金・カード・PayPay
	let ONSITE_METHODS = $derived<OnsiteMethod[]>(
		(data.expired ? null : data.onsiteMethods)?.filter((v): v is OnsiteMethod => v === 'cash' || v === 'card' || v === 'paypay') ?? ['cash', 'card', 'paypay']
	);
	// 支払方法の名前・説明文（施設が管理画面で書き換えていればそれ、無ければ既定の文言）
	const payText = (group: PayTextGroup, field: 'label' | 'note', fallback: string) =>
		(data.expired ? null : payTextFor(data.paymentTexts, group, field, getLocale())) ?? fallback;
	const onsiteMethodLabel = (v: OnsiteMethod) => (v === 'paypay' ? m.pay_method_paypay() : v === 'card' ? m.pay_method_card() : m.pay_method_cash());
	let onlineOptions = $derived(data.expired ? [] : data.payOptions.filter((v): v is 'card' | 'paypay' => v !== 'onsite'));
	let hasOnsite = $derived(!data.expired && data.payOptions.includes('onsite'));
	// 予約時決済の割引（プランの定率と早期決済割の大きい方・泊ごと。オンライン決済を選んだときだけ効く）。
	// サーバが lib/early-prepay.ts（DB と同じ式）で計算した額。金額の正は DB（direct_payment_prepare）
	let prepay = $derived(data.expired ? null : data.prepay);
	let prepayAmount = $derived(prepay?.detail.discount ?? 0);
	// 割引行の名前: 早期決済割が当たっていれば「早期決済割（5%）」、定率なら従来の「予約時決済割引（10%OFF）」
	let discountLabel = $derived(
		prepay?.mixedRates
			? m.pay_discount_rooms()
			: prepay?.early
			? m.pay_early_line({ rate: percentText(prepay.detail.maxPermille / 10) })
			: m.pay_discount_line({ rate: percentText((prepay?.detail.flatPermille ?? 0) / 10) })
	);
	// 今の段（段階表のハイライト用・千分率）
	let currentTierPermille = $derived(prepay?.detail.tierPermille ?? 0);
	// 早期決済ポイント（施設の還元方法が points）: 段階表の率は割引にせず、宿泊後にポイントを上乗せする。
	// 請求額から引くのはプランの定率割引だけ（prepayAmount）。会員ランクの通常ポイントとは別に付く
	let isPoints = $derived(prepay?.mode === 'points');
	let bonusPoints = $derived(isPoints ? (prepay?.detail.bonusPoints ?? 0) : 0);
	let bonusRate = $derived(percentText((prepay?.detail.pointsPermille ?? 0) / 10));
	// 非会員の会員登録導線（予約中の入力を消さないよう別タブで開く）
	const registerHref = '/auth/register';
	// オンライン決済（チェックアウト日・2026-11-01）: カード決済が使えるプランで、実データ（同じ画面で払う方式）のときだけ。
	// 予約時にカードを登録し、チェックアウト日に請求する（予約時決済の割引・早期決済ポイント・事務手数料は付かない）
	let hasCheckout = $derived(!data.expired && data.inline && data.checkoutOption);
	let selectedGroup = $state<'online' | 'checkout' | 'onsite' | null>(null);
	let group = $derived(selectedGroup ?? (onlineOptions.length > 0 ? 'online' : hasOnsite ? 'onsite' : hasCheckout ? 'checkout' : 'onsite'));
	let checkoutCard = $derived(group === 'checkout' && hasCheckout);
	// 請求日＝チェックアウト日（仮押さえの泊数から）
	let chargeOnText = $derived(data.expired ? '' : formatDateLong(addDays(data.hold.checkin, data.hold.nights)));
	let selectedOnline = $state<'card' | 'paypay' | null>(null);
	let pickedOnsite = $state<OnsiteMethod | null>(null);
	// 選んだ内訳が施設でオフなら、オンの先頭（既定は現金）
	let onsiteMethod = $derived<OnsiteMethod>(pickedOnsite && ONSITE_METHODS.includes(pickedOnsite) ? pickedOnsite : (ONSITE_METHODS[0] ?? 'cash'));
	let furusatoVoucher = $state(false);
	let payValue = $derived<PayChoice>(
		group === 'online' ? (selectedOnline ?? onlineOptions[0] ?? 'card') : group === 'checkout' ? 'card' : `onsite_${onsiteMethod}`
	);
	let isPrepay = $derived(group === 'online');
	// 実データのカード決済はこの画面で払う（同じ画面の決済部品）。デモは従来どおり決済画面へ
	let inlineCard = $derived(!data.expired && data.inline && payValue === 'card' && group === 'online');
	// 同じ画面の決済部品を出すか（予約時のカード決済・チェックアウト日のカード登録）
	let inlinePay = $derived(inlineCard || checkoutCard);
	let discountNow = $derived(isPrepay ? prepayAmount : 0);
	let discountedTotal = $derived(data.expired ? 0 : data.groupQuote.total - discountNow);

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
					data.groupQuote.total - discountNow
				)
	);
	let charge = $derived(
		data.expired ? { lodging: 0, bathTax: 0, discount: 0, charge: 0 } : directChargeOf({ total: data.groupQuote.total, pointsUsed: pointsApplied, bathTax: data.bathTax, prepayDiscount: discountNow })
	);

	// モバイル上部の要約に出す合計（右の明細と同じ額: 入湯税込みで払う場合はその額、それ以外はポイント利用後の宿泊料金）
	let summaryTotal = $derived(
		data.expired ? 0 : inlinePay ? charge.charge : isPrepay ? discountedTotal - pointsApplied : data.groupQuote.total - pointsApplied
	);

	// 仮押さえの期限（支払の準備で DB が延ばしたら更新する）
	// svelte-ignore state_referenced_locally
	let holdExpiresAt = $state(data.expired ? 0 : data.hold.expiresAt);

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
		if (!PHONE_RE.test(v('phone'))) return m.error_phone_invalid();
		if (!EMAIL_RE.test(v('email'))) return m.error_email_invalid();
		// 確認の段では個人情報の同意が要る（Apple Pay / Google Pay のシートを開く前にもここで止める）
		if (step === 'confirm' && !privacyAgreed) return m.hold_consent_required();
		return null;
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
		if (!formEl?.reportValidity()) return;
		const err = validateGuest();
		if (err) {
			clientError = err;
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
		const po = get('payOnline');
		if (po === 'card' || po === 'paypay') selectedOnline = po;
		const pon = get('payOnsite');
		if (pon === 'cash' || pon === 'card' || pon === 'paypay') pickedOnsite = pon;
		furusatoVoucher = !!get('furusatoVoucher');
		if (get('points') != null) pointsInput = Number(get('points')) || 0;
		favPicked = Object.fromEntries(entries.filter(([k]) => k.startsWith('fav_')).map(([k, v]) => [Number(k.slice(4)), v]));
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
		step = 'confirm';
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
			? `${payText('online_now', 'label', m.pay_group_online())} ／ ${payValue === 'paypay' ? m.pay_paypay() : m.pay_card()}`
			: group === 'checkout'
				? payText('online_checkout', 'label', m.pay_group_checkout())
				: `${payText('onsite', 'label', m.pay_group_onsite())} ／ ${onsiteMethodLabel(onsiteMethod)}${furusatoVoucher ? ` ／ ${m.pay_onsite_furusato()}` : ''}`
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
		<!-- パンくず: どこから来たかと、戻り先を見せる（ブラウザの戻るに頼らない） -->
		{#if memberPage}
			<!-- 特別会員の専用ページから: 戻り先は専用ページ（料金カレンダー） -->
			<nav aria-label="breadcrumb" class="mb-1 flex flex-wrap items-center gap-x-1 text-xs text-stone-500">
				<a href={memberPage.backHref} class="max-w-[16rem] truncate hover:underline">{memberPage.pageName}</a>
				<span aria-hidden="true">/</span>
				<span class="text-stone-700" aria-current="page">{m.hold_breadcrumb_current()}</span>
			</nav>
		{:else}
		<nav aria-label="breadcrumb" class="mb-1 flex flex-wrap items-center gap-x-1 text-xs text-stone-500">
			<a href="/search?checkin={data.hold.checkin}&nights={data.hold.nights}&adults={data.hold.adults}" class="hover:underline">{m.common_facility_list()}</a>
			<span aria-hidden="true">/</span>
			<!-- 実際に通ってきたページ（一覧・施設トップ・客室ページ）を出す。経路が分からないときだけ一覧 -->
			{#if viaStep}
				<a href={viaStep.href} class="hover:underline">{viaStep.kind === 'plans' ? m.plan_detail_breadcrumb_plans() : viaStep.kind === 'room' ? m.room_detail_breadcrumb() : data.facility.name}</a>
			{:else}
				<a href="/{data.facility.brandSlug}/{data.facility.slug}/plans?checkin={data.hold.checkin}&nights={data.hold.nights}&adults={data.hold.adults}" class="hover:underline">{m.plan_detail_breadcrumb_plans()}</a>
			{/if}
			<span aria-hidden="true">/</span>
			<a href={data.planHref} class="max-w-[16rem] truncate hover:underline">{data.plan.name}</a>
			<span aria-hidden="true">/</span>
			<span class="text-stone-700" aria-current="page">{m.hold_breadcrumb_current()}</span>
		</nav>
		{/if}
		<!-- 見出しと「1. 入力 → 2. 確認・確定」（取引先ページと共通） -->
		<BookingSteps {step} heading={step === 'input' ? m.hold_heading_input() : m.hold_heading_confirm()} inputLabel={m.hold_step_input()} confirmLabel={m.hold_step_confirm()} />
		{#if data.preview}
			<!-- スタッフの販売ページプレビュー（販売中でないプラン）。在庫は本物を押さえているので「選び直す」で戻してもらう -->
			<p class="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
				プレビュー（スタッフ用）。このプランは販売中ではないため、予約は確定できません。仮押さえした部屋は期限まで在庫から減っています。確認が終わったら「選び直す」で戻してください。
			</p>
		{/if}
		{#if memberPage}
			<!-- 特別会員の専用ページ経由・専用料金（専用特典は部屋ごと・右の予約内容に） -->
			<div class="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm">
				<p class="font-medium text-brand-900">{m.hold_member_page_heading({ page: memberPage.pageName })}</p>
				<p class="mt-0.5 text-xs leading-5 text-stone-600">{m.hold_member_page_note()}</p>
			</div>
		{/if}
		<!-- 選び直し: 仮押さえを解放してからプラン詳細へ（押さえたまま戻ると期限まで部屋が減ったまま） -->
		<form method="POST" action="?/release" class="mt-3 flex flex-wrap items-baseline gap-x-2">
			<input type="hidden" name="holdId" value={data.hold.id} />
			<input type="hidden" name="back" value={data.backHref} />
			<button type="submit" disabled={paying} class="text-sm text-accent-600 hover:underline disabled:opacity-50">{m.hold_change_plan()}</button>
			<span class="text-xs text-stone-400">{m.hold_change_plan_note()}</span>
		</form>

		<div class="mt-4">
			<!-- 支払の処理中は期限の表示で画面を切り替えない（確定の結果はサーバが判断する） -->
			<HoldTimer expiresAt={holdExpiresAt} onexpire={() => { if (!paying) expiredNow = true; }} />
		</div>

		{#if form?.message}
			<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
		{/if}

		<!-- モバイル: 予約内容の要約（明細の aside は長いフォームの下になるため、合計を先に見せる） -->
		<div class="mt-4 rounded-xl border border-stone-200 bg-white p-3 text-sm lg:hidden">
			<p class="font-medium text-brand-900">{data.facility.name}</p>
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

		<form
			bind:this={formEl}
			method="POST"
			action="?/submit"
			oninput={readAnswers}
			onchange={readAnswers}
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
				{#if !data.member}
					<div class="rounded-xl border border-accent-500/40 bg-amber-50/60 p-4 text-sm {step === 'confirm' ? 'hidden' : ''}">
						<p class="font-medium text-brand-900">{m.hold_login_prompt()}</p>
						<div class="mt-2 flex gap-2">
							<a href="/auth/login?next={encodeURIComponent(page.url.pathname + page.url.search)}" class="rounded-md bg-brand-800 px-4 py-1.5 text-white hover:bg-brand-700">{m.hold_login_btn()}</a>
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
							<input name="familyName" autocomplete="family-name" required aria-required="true" aria-invalid={form?.errors?.familyName ? 'true' : undefined} value={form?.values?.familyName ?? data.member?.familyName ?? ''} placeholder="山田" class="{input} {form?.errors?.familyName ? 'border-red-400' : ''}" />
						</label>
						<label class="block">
							<span class={label}>{m.name_given()} <em class="bk-req">{m.hold_required()}</em></span>
							<input name="givenName" autocomplete="given-name" required aria-required="true" aria-invalid={form?.errors?.givenName ? 'true' : undefined} value={form?.values?.givenName ?? data.member?.givenName ?? ''} placeholder="太郎" class="{input} {form?.errors?.givenName ? 'border-red-400' : ''}" />
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

						<!-- お支払い方法: オンライン決済 / チェックアウト日のカード決済 / 現地決済。確認の段では選び直せない（入力に戻る） -->
						<fieldset class="space-y-2 {step === 'confirm' ? 'opacity-80' : ''}" disabled={paying} inert={step === 'confirm'}>
							<legend class={label}>{m.pay_choose()} <em class="bk-req">{m.hold_required()}</em></legend>
							<input type="hidden" name="payment" value={payValue} />

							{#if onlineOptions.length > 0}
								<div class="rounded-xl border transition {group === 'online' ? 'border-[var(--bk-accent)] bg-[var(--bk-accent-soft)]' : 'border-stone-300'}">
									<label class="flex cursor-pointer items-center gap-2.5 px-3 py-3">
										<input type="radio" name="payGroup" value="online" checked={group === 'online'} onchange={() => (selectedGroup = 'online')} class="accent-[var(--bk-accent)]" />
										<span class="flex-1 font-medium">{payText('online_now', 'label', m.pay_group_online())}</span>
										{#if prepayAmount > 0}
											<span class="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">{m.pay_prepay_save({ amount: formatPrice(prepayAmount) })}</span>
										{/if}
										{#if bonusPoints > 0}
											<span class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">{m.pay_points_badge({ points: bonusPoints.toLocaleString() })}</span>
										{/if}
									</label>
									{#if prepay && (prepayAmount > 0 || prepay.showLadder)}
										<!-- 予約時決済の割引の案内（選択に関係なく常に表示）。割引は金額で見せ、現地払いの額は消し線にしない。
										     返金しない旨は割引額と同じ大きさで出す。カウントダウン・在庫の煽りはしない -->
										<div class="space-y-2 border-t border-stone-200/80 px-3 py-2.5 pl-9">
											{#if prepayAmount > 0}
												<p class="font-medium text-brand-900">
													{#if hasOnsite}
														{m.pay_prepay_compare({ onsite: formatPrice(data.groupQuote.total), online: formatPrice(data.groupQuote.total - prepayAmount), save: formatPrice(prepayAmount) })}
													{:else}
														{discountLabel} −{formatPrice(prepayAmount)} ／ {m.pay_discount_total()} {formatPrice(data.groupQuote.total - prepayAmount)}
													{/if}
												</p>
												<p class="font-medium text-brand-900">{m.pay_early_nonrefund({ amount: formatPrice(prepayAmount) })}</p>
											{/if}
											{#if bonusPoints > 0}
												<!-- 早期決済ポイント: 金額は下がらないのでポイントで見せる。会員ランクの通常ポイントとは別に付く -->
												<p class="font-medium text-emerald-800">{m.pay_points_compare({ points: bonusPoints.toLocaleString() })}</p>
												{#if data.member}
													<p class="text-xs text-stone-600">{m.pay_points_grant({ rate: bonusRate, points: bonusPoints.toLocaleString() })}</p>
												{:else}
													<p class="text-xs text-stone-700">
														{m.pay_points_guest({ rate: bonusRate, points: bonusPoints.toLocaleString() })}
														<a href={registerHref} target="_blank" rel="noopener" class="ml-1 font-medium text-accent-600 underline hover:text-accent-500">{m.pay_points_register()}</a>
													</p>
												{/if}
												<p class="text-xs text-stone-500">{m.pay_points_cancel_note()}</p>
											{/if}
											{#if prepay.showLadder}
												<div class="rounded-md border border-stone-200 bg-white/80 p-2.5">
													<p class="text-xs text-stone-600">{isPoints ? m.pay_points_heading() : m.pay_early_heading()}</p>
													<p class="mt-1 font-medium text-brand-900">
														{#if isPoints}
															{currentTierPermille > 0
																? m.pay_points_lead({ days: String(prepay.detail.leadDays), rate: percentText(currentTierPermille / 10) })
																: m.pay_points_lead_none({ days: String(Math.max(0, prepay.detail.leadDays)), min: String(prepay.tiers[0]?.days ?? 0) })}
														{:else}
															{currentTierPermille > 0
																? m.pay_early_lead({ days: String(prepay.detail.leadDays), rate: percentText(currentTierPermille / 10) })
																: m.pay_early_lead_none({ days: String(Math.max(0, prepay.detail.leadDays)), min: String(prepay.tiers[0]?.days ?? 0) })}
														{/if}
													</p>
													<ol class="mt-1.5 flex flex-wrap gap-1.5" aria-label={isPoints ? m.pay_points_name() : m.pay_early_name()}>
														{#each prepay.tiers as t (t.days)}
															{@const current = Math.round(t.percent * 10) === currentTierPermille}
															<li
																class="rounded-full border px-2.5 py-0.5 text-xs tabular-nums {current ? 'border-red-300 bg-red-50 font-bold text-red-700' : 'border-stone-200 text-stone-500'}"
																aria-current={current ? 'true' : undefined}
															>
																{isPoints
																	? m.pay_points_tier({ days: String(t.days), rate: percentText(t.percent) })
																	: `${m.pay_early_tier({ days: String(t.days) })} ${percentText(t.percent)}%`}
															</li>
														{/each}
													</ol>
													{#if prepay.drop}
														<p class="mt-1.5 text-xs text-stone-600">
															{isPoints
																? m.pay_points_drop({ days: String(prepay.drop.inDays), from: percentText(prepay.drop.fromPercent), to: percentText(prepay.drop.toPercent), diff: prepay.drop.diff.toLocaleString() })
																: m.pay_early_drop({ days: String(prepay.drop.inDays), from: percentText(prepay.drop.fromPercent), to: percentText(prepay.drop.toPercent), diff: formatPrice(prepay.drop.diff) })}
														</p>
													{/if}
													{#if prepay.detail.blackoutNights > 0}
														<p class="mt-1.5 text-xs text-stone-600">{isPoints ? m.pay_points_blackout() : m.pay_early_blackout()}</p>
													{/if}
													{#if !isPoints && currentTierPermille > 0 && prepay.detail.flatPermille >= currentTierPermille}
														<p class="mt-1.5 text-xs text-stone-600">{m.pay_early_flat_note({ rate: percentText(prepay.detail.flatPermille / 10) })}</p>
													{/if}
												</div>
											{/if}
										</div>
									{/if}
									{#if group === 'online'}
										<div class="space-y-1.5 border-t border-stone-200/80 px-3 py-2.5 pl-9">
											{#if onlineOptions.length > 1}
												{#each onlineOptions as v (v)}
													<label class="flex cursor-pointer items-center gap-2">
														<input type="radio" name="payOnline" value={v} checked={payValue === v} onchange={() => (selectedOnline = v)} class="accent-[var(--bk-accent)]" />
														{#if v === 'paypay'}<img src="/site-assets/paypay-logo.png" alt="" class="-my-1 h-6 w-auto" width="66" height="24" />{/if}
														<span>{v === 'card' ? m.pay_card() : m.pay_paypay()}</span>
													</label>
												{/each}
											{:else}
												<p class="text-stone-600">{onlineOptions[0] === 'card' ? m.pay_card() : m.pay_paypay()}</p>
											{/if}
											{#if !data.inline}<p class="text-xs text-stone-500">{m.pay_prepay_note()}</p>{/if}
											{#if payText('online_now', 'note', '')}<p class="whitespace-pre-line text-xs text-stone-600">{payText('online_now', 'note', '')}</p>{/if}
											<!-- 予約時決済の事務手数料（取消時に返金しない率・2026-10-07）。消費者契約法の「平均的な損害」に配慮し、率と理由を予約前に明示 -->
											{#if data.adminFeePercent}<p class="text-xs text-amber-900">{m.prepay_admin_fee_notice({ percent: `${data.adminFeePercent}%` })}</p>{/if}
										</div>
									{/if}
								</div>
							{/if}

							{#if hasCheckout}
								<!-- オンライン決済（チェックアウト日）: いまカードを登録し、チェックアウト日に請求（割引なし） -->
								<div class="rounded-xl border transition {group === 'checkout' ? 'border-[var(--bk-accent)] bg-[var(--bk-accent-soft)]' : 'border-stone-300'}">
									<label class="flex cursor-pointer items-center gap-2.5 px-3 py-3">
										<input type="radio" name="payGroup" value="checkout" checked={group === 'checkout'} onchange={() => (selectedGroup = 'checkout')} class="accent-[var(--bk-accent)]" />
										<span class="flex-1 font-medium">{payText('online_checkout', 'label', m.pay_group_checkout())}</span>
									</label>
									{#if group === 'checkout'}
										<div class="whitespace-pre-line border-t border-stone-200/80 px-3 py-2.5 pl-9 text-xs text-stone-600">{payText('online_checkout', 'note', m.pay_checkout_note())}</div>
									{/if}
								</div>
							{/if}

							{#if hasOnsite}
								<div class="rounded-xl border transition {group === 'onsite' ? 'border-[var(--bk-accent)] bg-[var(--bk-accent-soft)]' : 'border-stone-300'}">
									<label class="flex cursor-pointer items-center gap-2.5 px-3 py-3">
										<input type="radio" name="payGroup" value="onsite" checked={group === 'onsite'} onchange={() => (selectedGroup = 'onsite')} class="accent-[var(--bk-accent)]" />
										<span class="flex-1 font-medium">{payText('onsite', 'label', m.pay_group_onsite())}</span>
									</label>
									{#if group === 'onsite'}
										<div class="border-t border-stone-200/80 px-3 py-2.5 pl-9">
											{#if payText('onsite', 'note', '')}<p class="mb-2 whitespace-pre-line text-xs text-stone-600">{payText('onsite', 'note', '')}</p>{/if}
											<p class="mb-1.5 text-xs text-stone-500">{m.pay_onsite_how()}</p>
											<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={m.pay_onsite_how()}>
												{#each ONSITE_METHODS as v (v)}
													<label class="flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 {onsiteMethod === v ? 'border-[var(--bk-accent)] bg-white font-medium' : 'border-stone-300 bg-white/70'}">
														<input type="radio" name="payOnsite" value={v} checked={onsiteMethod === v} onchange={() => (pickedOnsite = v)} class="h-3.5 w-3.5 accent-[var(--bk-accent)]" />
														<!-- PayPay は公式ロゴ（static/site-assets/paypay-logo.png・余白込みの公式素材をそのまま）。文字と同じくらいの大きさで目立たせすぎない -->
														{#if v === 'paypay'}<img src="/site-assets/paypay-logo.png" alt="PayPay" class="-my-1 h-6 w-auto" width="66" height="24" />{:else}{onsiteMethodLabel(v)}{/if}
													</label>
												{/each}
											</div>
											{#if onsiteMethod === 'paypay'}
												<p class="mt-2 text-xs text-stone-500">{m.pay_onsite_paypay_note()}</p>
											{/if}
											<!-- その他の支払方法の併用（チェックアウト時に現地で使うもの） -->
											<p class="mb-1.5 mt-3 text-xs text-stone-500">{m.pay_onsite_other()}</p>
											<label class="inline-flex cursor-pointer items-center gap-2 text-sm">
												<input type="checkbox" name="furusatoVoucher" bind:checked={furusatoVoucher} class="h-4 w-4 rounded accent-[var(--bk-accent)]" />
												{m.pay_onsite_furusato()}
											</label>
										</div>
									{/if}
								</div>
							{/if}

							{#if data.payFallback}
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

						{#if inlinePay && step === 'input'}
							<p class="text-xs text-stone-500">{m.hold_pay_card_next()}</p>
						{/if}
						{#if inlinePay && step === 'confirm'}
							<!-- カードは確認の段でこの場で入力（Apple Pay / Google Pay は入力欄の上）。Link の保存欄は出さない。
							     チェックアウト日決済はカード登録（同意文つき・請求はチェックアウト日）。部品は支払の方式ごとに作り直す -->
							<div class="space-y-3 rounded-lg border border-stone-200 p-3">
								<div class="flex items-baseline justify-between gap-3">
									<h3 class="text-sm font-medium text-brand-900">{checkoutCard ? m.pay_checkout_heading() : m.pay_card_heading()}</h3>
									<p class="text-sm font-medium tabular-nums text-brand-900">{m.pay_total_due()} {formatPrice(charge.charge)}</p>
								</div>
								{#key checkoutCard}
								<StripePayment
									bind:this={payRef}
									publishableKey={data.publishableKey}
									mode={checkoutCard ? 'setup' : 'payment'}
									consentText={checkoutCard ? m.pay_checkout_consent({ date: chargeOnText, amount: formatPrice(charge.charge) }) : null}
									amount={charge.charge}
									locale={stripeLocale()}
									texts={payTexts}
									unavailableText={m.pay_unavailable()}
									validate={validateGuest}
									prepare={preparePayment}
									onconfirmed={onPaid}
									onbusychange={(b) => (paying = b)}
									onerror={() => (payMessage = '')}
									customerSession={loadMemberSession}
								/>
								{/key}
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
						<p class="mt-0.5 text-sm text-stone-500">{m.hold_summary_heading()}</p>
					</div>
				</div>
				<dl class="mt-4 space-y-1.5 text-sm">
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
						<div class="flex justify-between gap-2"><dt class="shrink-0 text-stone-500">{m.hold_summary_room()}</dt><dd class="text-right">{data.room.name}</dd></div>
						<div class="flex justify-between gap-2"><dt class="shrink-0 text-stone-500">{m.hold_summary_plan()}</dt><dd class="max-w-[65%] text-right">{data.plan.name}</dd></div>
						{#if perkTitles(rooms[0]?.memberPerks)}
							<div class="flex justify-between gap-2"><dt class="shrink-0 text-stone-500">{m.member_page_perks()}</dt><dd class="max-w-[65%] text-right text-amber-800">{perkTitles(rooms[0]?.memberPerks)}</dd></div>
						{/if}
					{/if}
					<div class="flex justify-between gap-2"><dt class="shrink-0 text-stone-500">{m.hold_summary_checkin()}</dt><dd class="text-right">{formatDateLong(data.hold.checkin)}</dd></div>
					<div class="flex justify-between gap-2"><dt class="shrink-0 text-stone-500">{m.hold_summary_nights_adults()}</dt><dd class="text-right">{m.hold_nights_adults_val({ nights: String(data.hold.nights), guests: guestsLabel(totalAdults) })}</dd></div>
				</dl>
				<div class="mt-4 border-t border-stone-200 pt-3">
					<PriceBreakdown quote={{ ...data.groupQuote, pointsUsed: pointsApplied, payable: data.groupQuote.total - pointsApplied }} rooms={rooms.map((r) => ({ lines: r.quote.lines, name: r.roomName }))} />
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
					{#if data.member && data.member.earn > 0}
						<!-- 付与予定のポイント（会員ランクの通常ポイント）。ポイント利用欄には今使える残高だけを出し、付与予定はここに分ける -->
						<div class="mt-2 flex justify-between text-sm text-emerald-700">
							<span>{m.hold_points_earn()}</span>
							<span class="tabular-nums">+{data.member.earn.toLocaleString()}{m.common_point_unit()}</span>
						</div>
						<p class="text-right text-xs text-stone-500">{m.hold_points_earn_note()}</p>
					{/if}
				</div>
				{#if memberPage}
					<!-- 特別会員: キャンセル料の計算の方式（下の規定はプランの規定。方式が「お客さまに有利な方」なら安い方で計算） -->
					<p class="mt-3 text-xs text-stone-600">{m.member_page_cancel_mode({ mode: memberCancelModeLabel(memberPage.cancelMode.mode) })}</p>
				{/if}
				<!-- 取消の案内（取引先ページと同じ帯） -->
				{#if multi}
					<!-- キャンセル規定は部屋ごと（部屋ごとにプランが違うため） -->
					{#each rooms as r (r.index)}
						<p class="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
							<span class="font-bold">{m.hold_cancel_policy_room({ n: String(r.index) })}:</span>
							<CancelPolicyNote policy={r.cancellationPolicy} checkin={data.hold.checkin} />
						</p>
					{/each}
				{:else}
					<p class="mt-4 rounded-lg bg-sky-50 px-3 py-3 text-center text-sm font-bold text-sky-700">
						<CancelPolicyNote policy={data.plan.cancellationPolicy} checkin={data.hold.checkin} />
					</p>
				{/if}

				{#if data.needsTurnstile}
					<!-- 非会員だけ、予約確定の前に Turnstile（フォームの中に置き、現地払いの送信にもカードの準備にも同じトークンが乗る）。
					     入力の段から置いておき、確認の段へ進むまでに判定を済ませる -->
					<div class="mt-4"><Turnstile bind:this={turnstile} action="booking-confirm" /></div>
				{/if}
				{#if clientError}<p class="mt-3 text-sm text-red-600" role="alert">{clientError}</p>{/if}
				{#if step === 'input'}
					<!-- submit にして Enter キーでも確認の段へ進めるようにする（use:enhance が送信を止めて toConfirm に回す） -->
					<button type="submit" class="bk-primary mt-4 w-full text-base">{m.hold_to_confirm()}</button>
				{:else}
					<!-- 個人情報の同意（予約確認・事前チェックインなどの SMS / メールの案内を含む）。確定の直前に必須で取る -->
					<div class="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
						<p class="leading-6 text-stone-600">{m.hold_consent_notice()}</p>
						<a href="/legal/privacy" target="_blank" rel="noopener" class="mt-1 inline-block text-accent-600 underline">{m.hold_consent_link()}</a>
						<label class="mt-3 flex min-h-11 cursor-pointer items-center gap-2 font-medium text-brand-900">
							<input type="checkbox" name="privacyConsent" value="1" required bind:checked={privacyAgreed} disabled={paying} class="h-5 w-5" />
							{m.hold_consent_label()} <em class="bk-req">{m.hold_required()}</em>
						</label>
					</div>
					<button
						type="submit"
						disabled={paying || data.preview || !privacyAgreed || (inlinePay && !data.publishableKey)}
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
						<p class="mt-2 text-center text-xs text-stone-500">{m.pay_checkout_submit_note({ date: chargeOnText, amount: formatPrice(charge.charge) })}</p>
					{:else if inlineCard}
						<p class="mt-2 text-center text-xs text-stone-500">{m.pay_submit_inline_note({ amount: formatPrice(charge.charge) })}</p>
					{:else if !isPrepay}
						<p class="mt-2 text-center text-xs text-stone-500">{m.hold_local_payment_note()}</p>
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
