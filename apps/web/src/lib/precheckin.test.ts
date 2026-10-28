import { describe, expect, it } from 'vitest';
import {
	answersFromForm,
	buildPrecheckinMail,
	canSend,
	checkMealChoices,
	contactDiff,
	demoPrecheckinContext,
	editableUntilOf,
	expiresAtOf,
	hasAnyMeal,
	isBefore,
	isMobileJp,
	maskEmail,
	maskPhone,
	mealChoicesFromForm,
	normTime,
	normalizePrecheckinContext,
	precheckinCookieMaxAge,
	precheckinState,
	slotSelectable,
	type PcContext
} from './precheckin';

describe('マスク（DB の _mask_phone / _mask_email と同じ）', () => {
	it('電話は下4桁だけ', () => {
		expect(maskPhone('090-1234-5678')).toBe('*******5678');
		expect(maskPhone('123')).toBe('****');
		expect(maskPhone('')).toBe('');
		expect(maskPhone(null)).toBe('');
	});
	it('メールは先頭2文字だけ', () => {
		expect(maskEmail('taro@example.com')).toBe('ta***@example.com');
		expect(maskEmail('a@x.jp')).toBe('a***@x.jp');
		expect(maskEmail('no-at')).toBe('');
		expect(maskEmail(undefined)).toBe('');
	});
});

describe('携帯番号の判定', () => {
	it('070/080/090 は携帯', () => {
		expect(isMobileJp('090-1234-5678')).toBe(true);
		expect(isMobileJp('08012345678')).toBe(true);
		expect(isMobileJp('+81 70-1234-5678')).toBe(true);
		expect(isMobileJp('81-90-1234-5678')).toBe(true);
	});
	it('固定電話・050・短い番号・空は携帯でない', () => {
		expect(isMobileJp('0197-82-2222')).toBe(false);
		expect(isMobileJp('050-1234-5678')).toBe(false);
		expect(isMobileJp('090-1234')).toBe(false);
		expect(isMobileJp('')).toBe(false);
		expect(isMobileJp(null)).toBe(false);
	});
});

describe('時刻・期限', () => {
	it('H:MM を HH:MM にそろえ、壊れた値は null', () => {
		expect(normTime('7:30')).toBe('07:30');
		expect(normTime(' 18:00 ')).toBe('18:00');
		expect(normTime('18')).toBeNull();
		expect(normTime('18:75')).toBeNull();
	});
	it('回答の締め切りはチェックイン日 12:00、リンクはチェックアウト日 11:00（JST）', () => {
		expect(editableUntilOf('2026-11-01')).toBe('2026-11-01T03:00:00.000Z');
		expect(expiresAtOf('2026-11-02')).toBe('2026-11-02T02:00:00.000Z');
	});
	it('締め切りの前後', () => {
		const until = editableUntilOf('2026-11-01');
		expect(isBefore(until, new Date('2026-11-01T02:59:59Z'))).toBe(true);
		expect(isBefore(until, new Date('2026-11-01T03:00:00Z'))).toBe(false);
		expect(isBefore('', new Date())).toBe(false);
	});
	it('Cookie は期限 + 1 日、過ぎていても最低 1 時間', () => {
		const now = Date.parse('2026-11-01T00:00:00Z');
		expect(precheckinCookieMaxAge('2026-11-02T00:00:00Z', now)).toBe(86_400 * 2);
		expect(precheckinCookieMaxAge('2026-10-01T00:00:00Z', now)).toBe(3600);
		expect(precheckinCookieMaxAge('x', now)).toBe(3600);
	});
});

describe('管理画面の状態', () => {
	const base = { email: 'a@b.jp', precheckin_id: null, status: null, sent_at: null, first_opened_at: null, answered_at: null };
	it('回答 > 開封 > 失敗 > 送信済 > 連絡先なし > 未送信', () => {
		expect(precheckinState(base)).toBe('unsent');
		expect(precheckinState({ ...base, email: null })).toBe('no_contact');
		expect(precheckinState({ ...base, precheckin_id: 'x', status: 'sent', sent_at: 't' })).toBe('sent');
		expect(precheckinState({ ...base, precheckin_id: 'x', status: 'failed', sent_at: 't' })).toBe('failed');
		expect(precheckinState({ ...base, precheckin_id: 'x', status: 'failed', first_opened_at: 't' })).toBe('opened');
		expect(precheckinState({ ...base, precheckin_id: 'x', status: 'sent', first_opened_at: 't', answered_at: 't' })).toBe('answered');
	});
	it('送れるのはメールがあってチェックアウト日 11:00 より前', () => {
		const now = new Date('2026-11-02T01:59:00Z');
		expect(canSend({ email: 'a@b.jp', check_out_date: '2026-11-02' }, now)).toBe(true);
		expect(canSend({ email: null, check_out_date: '2026-11-02' }, now)).toBe(false);
		expect(canSend({ email: 'a@b.jp', check_out_date: '2026-11-01' }, now)).toBe(false);
	});
});

describe('修正の差分', () => {
	it('入力があって、予約と違う欄だけ出す（電話はハイフン・メールは大文字小文字を無視）', () => {
		const d = contactDiff(
			{ name: '山人 太郎', name_kana: 'ヤマド タロウ', phone: '090-1234-5678', email: 'taro@example.com' },
			{ name: '山人 太郎', phone: '09012345678', email: 'TARO@example.com', name_kana: 'ヤマド タロー' }
		);
		expect(d).toEqual([{ key: 'name_kana', label: 'フリガナ', from: 'ヤマド タロウ', to: 'ヤマド タロー' }]);
		expect(contactDiff({}, null)).toEqual([]);
	});
});

describe('食事の時間枠', () => {
	const room = (stayId: string, dinner: string | null, breakfast: string | null, offered = true) => ({
		index: 1,
		stayId,
		label: '',
		nights: [
			{
				nightDate: '2026-11-01',
				stayId,
				dinner: { date: '2026-11-01', offered, time: dinner },
				breakfast: { date: '2026-11-02', offered: true, time: breakfast }
			}
		]
	});
	const A = '00000000-0000-4000-8000-00000000000a';
	const B = '00000000-0000-4000-8000-00000000000b';
	const ctx = (rooms: PcContext['rooms'], remaining18: number | null): Pick<PcContext, 'rooms' | 'slots'> => ({
		rooms,
		slots: {
			dinner: { '2026-11-01': [{ time: '17:30', max: null, remaining: null }, { time: '18:00', max: 3, remaining: remaining18 }] },
			breakfast: { '2026-11-02': [{ time: '08:00', max: null, remaining: null }] }
		}
	});

	it('満席の枠は選べないが、今の時間はそのまま選べる', () => {
		expect(slotSelectable({ time: '18:00', max: 3, remaining: 0 }, null)).toBe(false);
		expect(slotSelectable({ time: '18:00', max: 3, remaining: 0 }, '18:00')).toBe(true);
		expect(slotSelectable({ time: '18:00', max: 3, remaining: 1 }, null)).toBe(true);
		expect(slotSelectable({ time: '18:00', max: null, remaining: null }, null)).toBe(true);
	});
	it('残り 1 の枠に 2 室は入れない（複数室）', () => {
		const r = checkMealChoices(ctx([room(A, null, null), room(B, null, null)], 1), [
			{ stay_id: A, type: 'dinner', date: '2026-11-01', time: '18:00' },
			{ stay_id: B, type: 'dinner', date: '2026-11-01', time: '18:00' }
		]);
		expect(r).toEqual({ ok: false, error: 'slot_full', type: 'dinner', date: '2026-11-01', time: '18:00' });
	});
	it('変えない自分の部屋はその枠のぶんを使っている', () => {
		// A はすでに 18:00（残りは自分を除いて 1）→ B も 18:00 にすると A と合わせて 2 室で 1 を超える
		const r = checkMealChoices(ctx([room(A, '18:00', null), room(B, null, null)], 1), [
			{ stay_id: A, type: 'dinner', date: '2026-11-01', time: '18:00' },
			{ stay_id: B, type: 'dinner', date: '2026-11-01', time: '18:00' }
		]);
		expect(r.ok).toBe(false);
	});
	it('今と同じ時間は変更に数えない・空欄は変えない', () => {
		const r = checkMealChoices(ctx([room(A, '18:00', null)], 0), [
			{ stay_id: A, type: 'dinner', date: '2026-11-01', time: '18:00' },
			{ stay_id: A, type: 'breakfast', date: '2026-11-02', time: '' }
		]);
		expect(r).toEqual({ ok: true, changed: [] });
	});
	it('付いていない食事・その日に無い時間は invalid_meal', () => {
		expect(checkMealChoices(ctx([room(A, null, null, false)], null), [{ stay_id: A, type: 'dinner', date: '2026-11-01', time: '17:30' }]).ok).toBe(false);
		expect(checkMealChoices(ctx([room(A, null, null)], null), [{ stay_id: A, type: 'dinner', date: '2026-11-01', time: '20:00' }])).toMatchObject({ ok: false, error: 'invalid_meal' });
		expect(checkMealChoices(ctx([room(A, null, null)], null), [{ stay_id: B, type: 'dinner', date: '2026-11-01', time: '17:30' }]).ok).toBe(false);
	});
	it('変えた時間だけ changed に入る', () => {
		const r = checkMealChoices(ctx([room(A, '17:30', null)], 2), [
			{ stay_id: A, type: 'dinner', date: '2026-11-01', time: '18:00' },
			{ stay_id: A, type: 'breakfast', date: '2026-11-02', time: '8:00' }
		]);
		expect(r).toEqual({
			ok: true,
			changed: [
				{ stay_id: A, type: 'dinner', date: '2026-11-01', time: '18:00' },
				{ stay_id: A, type: 'breakfast', date: '2026-11-02', time: '08:00' }
			]
		});
	});
	it('食事が 1 つも無い予約', () => {
		const none = room(A, null, null, false);
		none.nights[0].breakfast.offered = false;
		expect(hasAnyMeal([none])).toBe(false);
		expect(hasAnyMeal([room(A, null, null)])).toBe(true);
	});
});

describe('フォームの値', () => {
	it('基本情報: 空欄は落とす', () => {
		const f = new FormData();
		f.set('contact_name', ' ');
		f.set('contact_phone', '090-0000-1111');
		f.set('arrival_time', '15:30');
		f.set('companions', '');
		f.set('requests', ' 誕生日です ');
		expect(answersFromForm(f, 'ja')).toEqual({
			contact: { phone: '090-0000-1111' },
			arrival_time: '15:30',
			companions: null,
			allergies: null,
			requests: '誕生日です',
			locale: 'ja'
		});
	});
	it('食事: name から部屋・種別・日付を読む', () => {
		const f = new FormData();
		f.set('meal|00000000-0000-4000-8000-00000000000a|dinner|2026-11-01', '18:00');
		f.set('meal|bad|dinner|2026-11-01', '18:00');
		f.set('other', 'x');
		expect(mealChoicesFromForm(f)).toEqual([{ stay_id: '00000000-0000-4000-8000-00000000000a', type: 'dinner', date: '2026-11-01', time: '18:00' }]);
	});
});

describe('RPC の戻り', () => {
	it('ok=false は理由だけ', () => {
		expect(normalizePrecheckinContext({ ok: false, error: 'expired' })).toEqual({ error: 'expired' });
		expect(normalizePrecheckinContext({ ok: false, error: 'xxx' })).toEqual({ error: 'invalid_token' });
		expect(normalizePrecheckinContext(null)).toEqual({ error: 'invalid_token' });
	});
	it('部屋・泊・時間枠を画面の形にする', () => {
		const c = normalizePrecheckinContext({
			ok: true,
			facility: { id: 'f', slug: 'yamado', name: '山人', timezone: 'Asia/Tokyo' },
			booking_code: 'AB1',
			check_in: '2026-11-01',
			check_out: '2026-11-02',
			nights: 1,
			room_count: 1,
			adults: 2,
			children: 0,
			guest: { name: '太郎', name_kana: 'タロウ', phone_masked: '****5678', email_masked: 'ta***@x.jp' },
			editable_until: '2026-11-01T03:00:00+00:00',
			editable: true,
			expires_at: '2026-11-02T02:00:00+00:00',
			answers: {},
			answered_at: null,
			rooms: [{ index: 1, stay_id: 's1', label: '和室', nights: [{ night_date: '2026-11-01', stay_id: 's1', dinner: { date: '2026-11-01', offered: true, time: '7:30' }, breakfast: { date: '2026-11-02', offered: false, time: null } }] }],
			slots: { dinner: { '2026-11-01': [{ time: '18:00', max: 3, remaining: 1 }, { time: 'x' }] }, breakfast: {} }
		}) as PcContext;
		expect(c.rooms[0].nights[0].dinner).toEqual({ date: '2026-11-01', offered: true, time: '07:30' });
		expect(c.rooms[0].nights[0].breakfast.offered).toBe(false);
		expect(c.slots.dinner['2026-11-01']).toEqual([{ time: '18:00', max: 3, remaining: 1 }]);
		expect(c.guest.phoneMasked).toBe('****5678');
	});
	it('見本は今日チェックイン・個人情報はマスク済み', () => {
		const d = demoPrecheckinContext({}, new Date('2026-11-01T00:00:00Z'));
		expect(d.checkIn).toBe('2026-11-01');
		expect(d.editable).toBe(true);
		expect(d.guest.emailMasked).toBe('ta***@example.com');
	});
});

describe('ご案内メール', () => {
	const mail = buildPrecheckinMail({
		facilityName: '山人-yamado-',
		guestName: '山人 <太郎>',
		checkIn: '2026-11-01',
		checkOut: '2026-11-03',
		nights: 2,
		bookingCode: 'AB12',
		url: 'https://book.example/ci/TOKEN',
		editableUntil: '2026-11-01T03:00:00Z'
	});
	it('件名・本文に施設名・予約番号・日程・締め切り・リンク（日本語と英語）', () => {
		expect(mail.subject).toBe('【山人-yamado-】事前チェックインのご案内 / Online pre-check-in');
		expect(mail.text).toContain('山人 <太郎> 様');
		expect(mail.text).toContain('ご予約番号: AB12');
		expect(mail.text).toContain('2026年11月1日（日） から 2泊（チェックアウト 2026年11月3日（火））');
		expect(mail.text).toContain('入力の締め切り: 11月1日 12:00');
		expect(mail.text).toContain('https://book.example/ci/TOKEN');
		expect(mail.text).toContain('Stay: Sun, Nov 1, 2026, 2 nights');
		expect(mail.text).toContain('Please complete by: Nov 1, 12:00 (JST)');
	});
	it('HTML は名前をエスケープし、リンクのボタンを出す', () => {
		expect(mail.html).toContain('山人 &lt;太郎&gt; 様');
		expect(mail.html).not.toContain('<太郎>');
		expect(mail.html).toContain('href="https://book.example/ci/TOKEN"');
	});
});
