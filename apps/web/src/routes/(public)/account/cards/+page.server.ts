import { fail, redirect } from '@sveltejs/kit';
import { stripePublishableKey, StripeError } from '$lib/server/stripe';
import { confirmCardSetup, detachSavedCard, listSavedCards, resolveMemberCustomer, SavedCardError, setDefaultCard } from '$lib/server/payments/saved-cards';
import { isSetupIntentId } from '$lib/server/payments/verify';
import { memberCardDb, memberCardOwner, memberCardsState, memberUserIdOf } from '$lib/server/member-saved-cards';
import { savedCardTitle, savedCardView, type SavedCardView } from '$lib/saved-cards';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

// 公式サイト会員のマイページ → お支払いカード（保存カード・2026-10-07・docs/saved-cards.md §6.2）。
// 会員ごとの Stripe Customer（book.member_payment_profiles）にカードを保存し、予約確認（/booking/hold）のオンライン決済で選べる。
// 登録は cards/api（JSON）、削除・既定は form action。Customer は会員 id から引く（リクエストの値で Customer を指定させない）。
// 公式サイトには後日請求が無いので、削除のガード（未請求の予約）は持たない（N7）。

export const load: PageServerLoad = async (event) => {
	const userId = memberUserIdOf(event);
	if (!userId) redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname)}`);
	const state = memberCardsState();
	let cards: SavedCardView[] = [];
	let loadError = false;
	// 3Dセキュア等でリダイレクトして戻ってきたときの登録の確定（通常はモーダルで済み、ここには来ない）
	let returned: string | null = null;
	const db = memberCardDb();
	if (state === 'ready' && db) {
		try {
			const customer = await resolveMemberCustomer(db, { userId, name: null, email: null }, { create: false });
			const si = event.url.searchParams.get('setup_intent') ?? '';
			if (customer && isSetupIntentId(si)) returned = (await confirmCardSetup(si, customer, memberCardOwner(userId))).status;
			if (customer) cards = (await listSavedCards(customer)).map(savedCardView);
		} catch (e) {
			console.error('[member-cards] 一覧を読めません:', e instanceof Error ? e.message : e);
			loadError = true;
		}
	}
	return {
		state,
		stripeKey: state === 'ready' ? stripePublishableKey() : null,
		cards,
		loadError,
		returned
	};
};

async function scope(event: Parameters<NonNullable<Actions['remove']>>[0]) {
	const userId = memberUserIdOf(event);
	const db = memberCardDb();
	if (!userId || !db || memberCardsState() !== 'ready') return null;
	const fd = await event.request.formData();
	const pm = String(fd.get('pm') ?? '');
	const customer = await resolveMemberCustomer(db, { userId, name: null, email: null }, { create: false });
	return customer ? { customer, pm } : null;
}

function failure(e: unknown) {
	if (e instanceof SavedCardError) return fail(e.status >= 400 && e.status < 500 ? e.status : 400, { message: e.status === 403 || e.status === 404 ? m.account_cards_not_found() : m.account_cards_error() });
	if (e instanceof StripeError) return fail(502, { message: m.account_cards_error() });
	throw e;
}

export const actions: Actions = {
	remove: async (event) => {
		try {
			const s = await scope(event);
			if (!s) return fail(404, { message: m.account_cards_not_found() });
			const card = await detachSavedCard(s.customer, s.pm);
			return { removed: card ? savedCardTitle(card) : '' };
		} catch (e) {
			return failure(e);
		}
	},
	set_default: async (event) => {
		try {
			const s = await scope(event);
			if (!s) return fail(404, { message: m.account_cards_not_found() });
			const card = await setDefaultCard(s.customer, s.pm);
			return { defaulted: card ? savedCardTitle(card) : '' };
		} catch (e) {
			return failure(e);
		}
	}
};
