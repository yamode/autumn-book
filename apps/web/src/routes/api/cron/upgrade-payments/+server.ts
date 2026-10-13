import { json } from '@sveltejs/kit';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { reconcileUpgradePayments } from '$lib/server/upgrade-payments';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const db = partnerServiceClient();
	if (!db) return json({ error: 'unavailable' }, { status: 503 });
	const gate = await db.schema('book').rpc('upgrade_reconciliation_authorized', { p_secret: request.headers.get('Authorization') ?? '' });
	if (gate.error || gate.data !== true) return json({ error: 'unauthorized' }, { status: 401 });
	return json(await reconcileUpgradePayments());
};
