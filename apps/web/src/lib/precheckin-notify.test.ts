import { describe, expect, it } from 'vitest';
import {
	buildPrecheckinNotifyMail,
	changedFields,
	isNotifyEmail,
	mealLines,
	normalizeNotifyBegin,
	normalizeNotifySettings,
	precheckinAdminUrl,
	precheckinNotifySubject
} from './precheckin-notify';
import type { PcAnswers } from './precheckin';

const answers: PcAnswers = {
	contact: { name: '山人 太郎', family_name: '山人', given_name: '太郎', family_name_kana: 'ヤマド', given_name_kana: 'タロウ', phone: '090-1111-2222' },
	guest: { zip: '029-5514', address: '岩手県和賀郡西和賀町湯川', birthdate: '1980-05-10', receipt_name: '' },
	arrival_time: '16:30',
	note: '誕生日です <b>ケーキ</b>',
	questions: [{ id: 'q1', question: '交通手段は？', answer: 'お車' }],
	meals: [
		{ stay_id: 's2', type: 'breakfast', date: '2026-11-21', time: '08:00' },
		{ stay_id: 's1', type: 'dinner', date: '2026-11-20', time: '18:30' },
		{ stay_id: 's2', type: 'dinner', date: '2026-11-20', time: '18:30' },
		{ stay_id: 's1', type: 'breakfast', date: '2026-11-21', time: '' }
	]
};

const base = {
	kind: 'answered' as const,
	facilityName: '山人-yamado-',
	guestName: '山人 太郎',
	bookingCode: 'B-123',
	checkIn: '2026-11-20',
	nights: 2,
	answers,
	adminUrl: 'https://book.yamado.app/admin/precheckin/abc?facility=f1'
};

describe('precheckinNotifySubject', () => {
	it('初回と修正で件名を変える（M/D ご到着）', () => {
		expect(precheckinNotifySubject('answered', '山人 太郎', '2026-11-05')).toBe('【事前チェックイン】山人 太郎 様（11/5ご到着）の回答が届きました');
		expect(precheckinNotifySubject('updated', '山人 太郎', '2026-11-05')).toBe('【事前チェックイン・修正】山人 太郎 様（11/5ご到着）の内容が変更されました');
	});
	it('名前が空ならお客様', () => {
		expect(precheckinNotifySubject('answered', ' ', '2026-11-20')).toContain('お客様 様');
	});
});

describe('changedFields', () => {
	it('姓・名に分けた欄を出し、空の欄は出さない', () => {
		const f = changedFields(answers);
		expect(f.map((x) => x.label)).toEqual(['氏名（姓）', '氏名（名）', 'フリガナ（セイ）', 'フリガナ（メイ）', '電話', '郵便番号', '住所', '生年月日']);
		expect(f.find((x) => x.label === '電話')?.value).toBe('090-1111-2222');
	});
	it('分けた欄が無ければつなげた氏名', () => {
		expect(changedFields({ contact: { name: '山田 花子', name_kana: 'ヤマダ ハナコ' } })).toEqual([
			{ label: '氏名', value: '山田 花子' },
			{ label: 'フリガナ', value: 'ヤマダ ハナコ' }
		]);
	});
	it('何も無ければ空', () => {
		expect(changedFields({})).toEqual([]);
	});
});

describe('mealLines', () => {
	it('日付・夕食→朝食の順で、同じ時間はまとめ、時間の無いものは出さない', () => {
		expect(mealLines(answers)).toEqual(['11/20（金） 夕食 18:30', '11/21（土） 朝食 08:00']);
	});
});

describe('buildPrecheckinNotifyMail', () => {
	it('テキストに各項目と管理画面の URL が入る', () => {
		const m = buildPrecheckinNotifyMail(base);
		expect(m.subject).toBe('【事前チェックイン】山人 太郎 様（11/20ご到着）の回答が届きました');
		expect(m.text).toContain('施設: 山人-yamado-');
		expect(m.text).toContain('予約番号: B-123');
		expect(m.text).toContain('ご宿泊: 2026年11月20日（金） から 2泊');
		expect(m.text).toContain('到着予定時刻: 16:30');
		expect(m.text).toContain('氏名（姓）: 山人');
		expect(m.text).toContain('11/20（金） 夕食 18:30');
		expect(m.text).toContain('Q. 交通手段は？');
		expect(m.text).toContain('A. お車');
		expect(m.text).toContain('誕生日です <b>ケーキ</b>');
		expect(m.text).toContain('PMS の予約詳細で内容を確認し、顧客情報へ反映してください。');
		expect(m.text.trim().endsWith(base.adminUrl)).toBe(true);
	});
	it('HTML の値はエスケープする', () => {
		const m = buildPrecheckinNotifyMail({ ...base, guestName: '<script>x</script>', facilityName: 'A&B' });
		expect(m.html).not.toContain('<script>');
		expect(m.html).not.toContain('<b>ケーキ</b>');
		expect(m.html).toContain('&lt;b&gt;ケーキ&lt;/b&gt;');
		expect(m.html).toContain('A&amp;B');
		expect(m.html).toContain('href="https://book.yamado.app/admin/precheckin/abc?facility=f1"');
	});
	it('修正の件名・予約番号なし・空の回答でも組み立てられる', () => {
		const m = buildPrecheckinNotifyMail({ ...base, kind: 'updated', bookingCode: null, answers: {} });
		expect(m.subject).toContain('【事前チェックイン・修正】');
		expect(m.text).not.toContain('予約番号');
		expect(m.text).toContain('到着予定時刻: （未入力）');
		expect(m.text).toContain('（変更なし）');
		expect(m.text).not.toContain('宿からの質問');
	});
});

describe('normalizeNotifyBegin', () => {
	it('DB の戻りを整える', () => {
		const r = normalizeNotifyBegin({
			ok: true,
			notified: true,
			kind: 'updated',
			mail: true,
			to: 'info@example.com',
			stay_id: 's1',
			facility_id: 'f1',
			facility_name: '山人',
			facility_slug: 'yamado',
			guest_name: '山人 太郎',
			booking_code: null,
			check_in: '2026-11-20',
			check_out: '2026-11-22',
			nights: 2,
			answers: { note: 'x' }
		});
		expect(r).toMatchObject({ ok: true, notified: true, kind: 'updated', mail: true, to: 'info@example.com', bookingCode: null, nights: 2 });
		expect(r.answers.note).toBe('x');
	});
	it('未回答・壊れた戻りは送らない', () => {
		expect(normalizeNotifyBegin({ ok: true, notified: false })).toMatchObject({ notified: false, mail: false });
		expect(normalizeNotifyBegin(null)).toMatchObject({ ok: false, mail: false, to: null });
	});
});

describe('normalizeNotifySettings / isNotifyEmail / precheckinAdminUrl', () => {
	it('設定の既定は「送る」', () => {
		expect(normalizeNotifySettings({ email: null, enabled: true, default_email: 'info@yamado.co.jp' })).toEqual({
			email: null,
			enabled: true,
			defaultEmail: 'info@yamado.co.jp'
		});
		expect(normalizeNotifySettings(null).enabled).toBe(true);
		expect(normalizeNotifySettings({ enabled: false }).enabled).toBe(false);
	});
	it('宛先の形', () => {
		expect(isNotifyEmail('')).toBe(true);
		expect(isNotifyEmail('front@yamado.co.jp')).toBe(true);
		expect(isNotifyEmail('a@b')).toBe(false);
		expect(isNotifyEmail('a@b.jp, c@d.jp')).toBe(false);
	});
	it('管理画面の詳細の URL', () => {
		expect(precheckinAdminUrl('https://book.yamado.app', 's1', 'f1')).toBe('https://book.yamado.app/admin/precheckin/s1?facility=f1');
		expect(precheckinAdminUrl('https://book.yamado.app', 's1', null)).toBe('https://book.yamado.app/admin/precheckin/s1');
	});
});
