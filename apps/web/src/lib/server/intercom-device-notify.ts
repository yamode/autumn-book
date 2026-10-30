// 受電端末の OS・アプリのバージョンが変わったときの開発者向けメール（2026-10-30 指示）。
// pg_cron 'intercom_device_notify'（10 分ごと・autumn-shared 20261030043942）が /api/cron/intercom-device-notify を呼ぶ。
//   1. book.intercom_device_events の未通知（OS・アプリの更新）をまとめて 1 通にして送る
//   2. OS が更新されたあと（24 時間以内）に 15 分以上報告が無い端末を「更新後に止まっている」として 1 回だけ送る
// 送り先は環境変数 INTERCOM_ALERT_EMAIL（カンマ区切り）。未設定なら何も送らず、記録も「通知済み」にしない。
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendHtmlEmail } from '$lib/server/mailer';

/** OS 更新のあと、この時間内に止まったら知らせる */
export const STALE_WATCH_MS = 24 * 60 * 60_000;
/** 報告が途絶えたとみなす時間（ハートビートは 5 分ごと） */
export const STALE_AFTER_MS = 15 * 60_000;

export type DeviceEvent = { id: string; device_id: string; kind: 'os_changed' | 'app_changed'; from_value: string | null; to_value: string | null; created_at: string };
export type DeviceInfo = { id: string; facility_id: string; device_label: string | null; os_version: string | null; app_version: string | null; app_build: string | null; last_seen_at: string | null };

/** "17.5.1" → 17。読めなければ null */
export function osMajor(v: string | null): number | null {
	const m = /^(\d+)/.exec(v ?? '');
	return m ? Number(m[1]) : null;
}

/** OS がメジャーバージョンを跨いだか（17.x → 18.x）。文面を強めるのに使う */
export function isMajorOsChange(from: string | null, to: string | null): boolean {
	const a = osMajor(from);
	const b = osMajor(to);
	return a !== null && b !== null && a !== b;
}

export function parseRecipients(v: string | undefined): string[] {
	return (v ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type NotifyLine = { text: string; urgent: boolean };

/** 端末名の表示（例: 山人-oga-／事務室） */
export function deviceName(d: Pick<DeviceInfo, 'facility_id' | 'device_label'>, facilityNames: Map<string, string>): string {
	return `${facilityNames.get(d.facility_id) ?? '不明な施設'}／${d.device_label ?? '名前なしの端末'}`;
}

export function eventLine(e: DeviceEvent, name: string): NotifyLine {
	if (e.kind === 'os_changed') {
		const major = isMajorOsChange(e.from_value, e.to_value);
		return {
			urgent: major,
			text: `${name} の iOS が ${e.from_value ?? '?'} から ${e.to_value ?? '?'} に更新されました${major ? '（メジャーバージョンの更新です。実機で受電・着信・通話を必ず確認してください）' : '。受電と着信の動作を確認してください。'}`
		};
	}
	return { urgent: false, text: `${name} のアプリが ${e.from_value ?? '?'} から ${e.to_value ?? '?'} に更新されました。` };
}

export function staleLine(d: DeviceInfo, name: string): NotifyLine {
	return { urgent: true, text: `${name} は iOS ${d.os_version ?? '?'} に更新されたあと、稼働の報告が止まっています（最終報告 ${d.last_seen_at ?? '不明'}）。着信が届いていない可能性があります。` };
}

export function buildMail(lines: NotifyLine[]): { subject: string; text: string; html: string } {
	const urgent = lines.some((l) => l.urgent);
	const subject = `${urgent ? '【要確認】' : ''}受電端末の OS・アプリが更新されました（Autumn Call）`;
	const text = [...lines.map((l) => `・${l.text}`), '', '確認先: 受電アプリの実機（待受・テスト発信）。山人 管理画面の「客室案内」で稼働中の台数も見られます。'].join('\n');
	const html = `<ul>${lines.map((l) => `<li${l.urgent ? ' style="color:#b91c1c"' : ''}>${esc(l.text)}</li>`).join('')}</ul><p style="color:#666;font-size:12px">確認先: 受電アプリの実機（待受・テスト発信）。</p>`;
	return { subject, text, html };
}

export type NotifyResult = { events: number; stale: number; sent: boolean; reason?: string };

export async function runIntercomDeviceNotify(db: SupabaseClient, opts: { recipients: string[]; now?: Date }): Promise<NotifyResult> {
	const now = opts.now ?? new Date();
	const book = db.schema('book');
	const [evR, staleR] = await Promise.all([
		book.from('intercom_device_events').select('id, device_id, kind, from_value, to_value, created_at').is('notified_at', null).order('created_at').limit(100),
		book
			.from('intercom_devices')
			.select('id, facility_id, device_label, os_version, app_version, app_build, last_seen_at')
			.is('disabled_at', null)
			.is('stale_alerted_at', null)
			.gte('os_changed_at', new Date(now.getTime() - STALE_WATCH_MS).toISOString())
			.lt('last_seen_at', new Date(now.getTime() - STALE_AFTER_MS).toISOString())
	]);
	if (evR.error) throw new Error(`イベントを読めませんでした: ${evR.error.message}`);
	if (staleR.error) throw new Error(`端末を読めませんでした: ${staleR.error.message}`);
	const events = (evR.data ?? []) as DeviceEvent[];
	const stale = (staleR.data ?? []) as DeviceInfo[];
	if (!events.length && !stale.length) return { events: 0, stale: 0, sent: false };
	if (!opts.recipients.length) return { events: events.length, stale: stale.length, sent: false, reason: 'no-recipients' };

	const ids = [...new Set([...events.map((e) => e.device_id), ...stale.map((d) => d.id)])];
	const { data: devs, error: devErr } = await book.from('intercom_devices').select('id, facility_id, device_label, os_version, app_version, app_build, last_seen_at').in('id', ids);
	if (devErr) throw new Error(`端末を読めませんでした: ${devErr.message}`);
	const byId = new Map(((devs ?? []) as DeviceInfo[]).map((d) => [d.id, d]));
	const { data: facs } = await db.schema('core').from('facilities').select('id, name').in('id', [...new Set([...byId.values()].map((d) => d.facility_id))]);
	const facilityNames = new Map(((facs ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]));

	const lines: NotifyLine[] = [
		...events.map((e) => eventLine(e, byId.get(e.device_id) ? deviceName(byId.get(e.device_id)!, facilityNames) : '不明な端末')),
		...stale.map((d) => staleLine(d, deviceName(d, facilityNames)))
	];
	const mail = buildMail(lines);
	const r = await sendHtmlEmail({ to: opts.recipients, subject: mail.subject, text: mail.text, html: mail.html, fromName: '山人 受電アプリ' });
	if (!r.sent) return { events: events.length, stale: stale.length, sent: false, reason: r.reason ?? 'send-failed' };

	// 送れたものだけ「通知済み」にする（失敗したら次の 10 分で再送）
	const stamp = now.toISOString();
	if (events.length) await book.from('intercom_device_events').update({ notified_at: stamp }).in('id', events.map((e) => e.id));
	if (stale.length) await book.from('intercom_devices').update({ stale_alerted_at: stamp }).in('id', stale.map((d) => d.id));
	return { events: events.length, stale: stale.length, sent: true };
}
