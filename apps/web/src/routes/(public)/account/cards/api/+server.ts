// 公式サイト会員のお支払いカードの登録 API（保存カード・2026-10-07・docs/saved-cards.md §6.2・§7.7）。POST JSON { action, ... }
//   prepare … 会員の Customer（無ければ作る）に SetupIntent を作る（毎回新しく・N8）→ { clientSecret, returnUrl }
//   confirm … ブラウザで confirmSetup が済んだ連絡 { intentId } → 取り直して確かめ、期限切れ・二重登録を弾いて保存 → { result: { status } }
// Webhook の setup_intent.succeeded は purpose（book_member_card）が違うので無視される（ここだけで確定する）。
// 保存の同意は PaymentMethod の metadata（consent_at / consent_version）に残す（会員側にアクセスログの表は無い）。
import { json, type RequestHandler } from '@sveltejs/kit';
import { getSupabaseUser } from '$lib/server/auth';
import { StripeError } from '$lib/server/stripe';
import { confirmCardSetup, prepareCardSetup, resolveMemberCustomer, SavedCardError } from '$lib/server/payments/saved-cards';
import { isSetupIntentId } from '$lib/server/payments/verify';
import { memberCardDb, memberCardOwner, memberCardsState, memberUserIdOf } from '$lib/server/member-saved-cards';
import * as m from '$lib/paraglide/messages';

const noStore = { 'cache-control': 'private, no-store' };
const bad = (message: string, status = 400) => json({ ok: false, message }, { status, headers: noStore });

export const POST: RequestHandler = async (event) => {
	const userId = memberUserIdOf(event);
	if (!userId) return bad(m.account_cards_unavailable(), 401);
	const db = memberCardDb();
	if (memberCardsState() !== 'ready' || !db) return bad(m.account_cards_unavailable(), 503);
	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	const action = String(body.action ?? '');
	const owner = memberCardOwner(userId);
	try {
		if (action === 'prepare') {
			// Customer の名前・メールは会員の認証情報から（Stripe の領収メールは送らない設定のまま）
			const auth = await getSupabaseUser(event);
			const meta = (auth?.user.user_metadata ?? {}) as Record<string, unknown>;
			const name = event.locals.user?.name || (typeof meta.name === 'string' ? meta.name : null);
			const customer = await resolveMemberCustomer(db, { userId, name, email: auth?.user.email ?? null }, { create: true });
			const si = await prepareCardSetup({ customer: customer!, owner, description: 'お支払いカードの登録（公式サイトの会員・予約時に選べるカードとして保存）' });
			return json({ ok: true, clientSecret: si.clientSecret, returnUrl: `${event.url.origin}/account/cards` }, { headers: noStore });
		}
		if (action === 'confirm') {
			const intentId = String(body.intentId ?? '');
			if (!isSetupIntentId(intentId)) return bad(m.account_cards_result_unknown());
			const customer = await resolveMemberCustomer(db, { userId, name: null, email: null }, { create: false });
			if (!customer) return json({ ok: true, result: { status: 'unknown' } }, { headers: noStore });
			const result = await confirmCardSetup(intentId, customer, owner);
			return json({ ok: true, result }, { headers: noStore });
		}
		return bad(m.account_cards_error());
	} catch (e) {
		if (e instanceof SavedCardError) return bad(e.status === 503 ? m.account_cards_unavailable() : m.account_cards_error(), e.status);
		if (e instanceof StripeError) return bad(m.account_cards_error(), 502);
		throw e;
	}
};
