import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

describe('受電端末の更新通知', () => {
	it('OS のメジャーバージョンの更新を見分ける', async () => {
		const { osMajor, isMajorOsChange } = await import('./intercom-device-notify');
		expect(osMajor('17.5.1')).toBe(17);
		expect(osMajor(null)).toBeNull();
		expect(osMajor('beta')).toBeNull();
		expect(isMajorOsChange('17.5', '18.0')).toBe(true);
		expect(isMajorOsChange('18.0', '18.1')).toBe(false);
		expect(isMajorOsChange(null, '18.0')).toBe(false);
	});

	it('送り先はメールの形のものだけ使う', async () => {
		const { parseRecipients } = await import('./intercom-device-notify');
		expect(parseRecipients('a@example.com, b@example.com ,x')).toEqual(['a@example.com', 'b@example.com']);
		expect(parseRecipients(undefined)).toEqual([]);
	});

	it('メジャー更新と止まった端末は「要確認」、通常の更新は件名に付けない', async () => {
		const { eventLine, staleLine, buildMail } = await import('./intercom-device-notify');
		const ev = (from: string, to: string) => ({ id: '1', device_id: 'd', kind: 'os_changed' as const, from_value: from, to_value: to, created_at: '' });
		const major = eventLine(ev('17.5', '18.0'), '山人-oga-／事務室');
		const minor = eventLine(ev('18.0', '18.1'), '山人-oga-／事務室');
		expect(major.urgent).toBe(true);
		expect(major.text).toContain('メジャーバージョン');
		expect(minor.urgent).toBe(false);
		expect(buildMail([minor]).subject).not.toContain('要確認');
		expect(buildMail([minor, major]).subject).toContain('【要確認】');
		const stale = staleLine({ id: 'd', facility_id: 'f', device_label: '事務室', os_version: '18.1', app_version: null, app_build: null, last_seen_at: '2026-10-30T00:00:00Z' }, '山人-oga-／事務室');
		expect(stale.urgent).toBe(true);
		expect(buildMail([stale]).html).toContain('止まっています');
	});

	it('HTML の特殊文字は無害にする', async () => {
		const { buildMail } = await import('./intercom-device-notify');
		expect(buildMail([{ text: '<b>x</b>', urgent: false }]).html).not.toContain('<b>x</b>');
	});
});
