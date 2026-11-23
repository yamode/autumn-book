import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { MAINTENANCE_BYPASS_TOKEN: 'tok-123' } }));

import { checkMaintenanceBypass, isMaintenanceBypassed, isPartnerPath, isValidPreviewCookie, previewCookieValue } from './maintenance';

function ev(path: string, role: string | undefined, cookie?: string, method = 'GET') {
	const jar = new Map<string, string>(cookie ? [['ab_preview', cookie]] : []);
	const set = vi.fn((k: string, v: string) => void jar.set(k, v));
	const event = {
		url: new URL(`https://book.yamado.app${path}`),
		request: new Request(`https://book.yamado.app${path}`, { method }),
		locals: { user: role ? { id: 'u', role, name: 'n' } : null },
		cookies: { get: (k: string) => jar.get(k), set }
	};
	return { event: event as never, set, jar };
}

describe('メンテナンスのバイパス', () => {
	it('受電端末の更新通知の cron はメンテナンスの対象外（pg_cron が呼ぶため）', () => {
		expect(isPartnerPath('/api/cron/intercom-device-notify')).toBe(true);
		expect(isPartnerPath('/api/cron/other')).toBe(false);
	});
	it('運営が公開サイトを見たらプレビュー cookie を発行する（会員ログインに入れ替わっても通すため）', async () => {
		const { event, set, jar } = ev('/auth/login', 'admin');
		expect(await isMaintenanceBypassed(event)).toBe(true);
		expect(set).toHaveBeenCalledWith('ab_preview', expect.any(String), expect.objectContaining({ httpOnly: true, secure: true }));
		expect(jar.get('ab_preview')).not.toContain('tok-123');
		expect(await isValidPreviewCookie(jar.get('ab_preview'), 'tok-123')).toBe(true);
	});
	it('運営が /admin だけを見ていても cookie を発行する', async () => {
		const { event, set } = ev('/admin/maintenance', 'staff');
		expect(await isMaintenanceBypassed(event)).toBe(true);
		expect(set).toHaveBeenCalled();
	});
	it('有効な署名つき cookie なら会員でも通り、再発行しない', async () => {
		const { event, set } = ev('/account', 'member', await previewCookieValue('tok-123'));
		expect(await isMaintenanceBypassed(event)).toBe(true);
		expect(set).not.toHaveBeenCalled();
	});
	it('cookie も運営の権限もない会員は通らない', async () => {
		const { event } = ev('/account', 'member');
		expect(await isMaintenanceBypassed(event)).toBe(false);
	});
});

describe('プレビューの合言葉（レビュー L-2）', () => {
	it('合言葉を受け取ったら cookie を発行し、?preview= を外した同じ画面へ移す', async () => {
		const { event, jar } = ev('/stay?area=oga&preview=tok-123', undefined);
		expect(await checkMaintenanceBypass(event)).toEqual({ ok: true, redirect: '/stay?area=oga' });
		expect(await isValidPreviewCookie(jar.get('ab_preview'), 'tok-123')).toBe(true);
	});
	it('POST では移さず通すだけ', async () => {
		const { event } = ev('/?preview=tok-123', undefined, undefined, 'POST');
		expect(await checkMaintenanceBypass(event)).toEqual({ ok: true });
	});
	it('違う合言葉は通らない', async () => {
		const { event, set } = ev('/?preview=nope', undefined);
		expect(await checkMaintenanceBypass(event)).toEqual({ ok: false });
		expect(set).not.toHaveBeenCalled();
	});
	it('合言葉そのものを入れた古い cookie は通らない', async () => {
		const { event } = ev('/', undefined, 'tok-123');
		expect(await isMaintenanceBypassed(event)).toBe(false);
	});
	it('cookie は 1 日で切れる', async () => {
		const v = await previewCookieValue('tok-123', Date.now() - 25 * 3600_000);
		expect(await isValidPreviewCookie(v, 'tok-123')).toBe(false);
	});
	it('合言葉を替えると、発行済みの cookie は通らない', async () => {
		const v = await previewCookieValue('tok-123');
		expect(await isValidPreviewCookie(v, 'tok-456')).toBe(false);
	});
	it('書き換えた cookie は通らない', async () => {
		const v = await previewCookieValue('tok-123');
		const forged = v.replace(/v1:(\d+)/, (_m, n) => `v1:${Number(n) + 86400 * 365}`);
		expect(await isValidPreviewCookie(forged, 'tok-123')).toBe(false);
	});
});
