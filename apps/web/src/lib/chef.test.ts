import { describe, expect, it } from 'vitest';
import { addDays, chefCancelFee, chefCancelRate, chefIsStale, chefOpenSlotsOnDayOff, chefPartyLabel, chefPayDeadline, chefPayDeadlinePassed, daysBetween, isValidIsoDate, jstToday } from './chef';
import { classifyShiftDay } from './server/taskul-shift-day';

describe('出張シェフのキャンセル料', () => {
	it('5日前まで0%・4〜2日前25%・前日50%・当日100%', () => {
		expect(chefCancelRate(10)).toBe(0);
		expect(chefCancelRate(5)).toBe(0);
		expect(chefCancelRate(4)).toBe(0.25);
		expect(chefCancelRate(2)).toBe(0.25);
		expect(chefCancelRate(1)).toBe(0.5);
		expect(chefCancelRate(0)).toBe(1);
		expect(chefCancelRate(-2)).toBe(1);
	});
	it('税込総額から円未満切り捨てで計算する', () => {
		expect(chefCancelFee(26400, '2026-12-05', '2026-12-02')).toEqual({ daysBefore: 3, rate: 0.25, fee: 6600 });
		expect(chefCancelFee(22001, '2026-12-05', '2026-12-04').fee).toBe(11000);
	});
});

describe('日付', () => {
	it('日本時間の今日・日数差・加算', () => {
		expect(jstToday(new Date('2026-11-23T15:30:00Z'))).toBe('2026-11-24');
		expect(daysBetween('2026-11-30', '2026-12-02')).toBe(2);
		expect(addDays('2026-12-01', -3)).toBe('2026-11-28');
	});
	it('仮予約のまま3日たったら目立たせる', () => {
		const now = new Date('2026-11-23T00:00:00Z');
		expect(chefIsStale('requested', '2026-11-20T00:00:00Z', now)).toBe(true);
		expect(chefIsStale('requested', '2026-11-21T00:00:00Z', now)).toBe(false);
		expect(chefIsStale('confirmed', '2026-11-01T00:00:00Z', now)).toBe(false);
	});
	it('人数の表示', () => {
		expect(chefPartyLabel({ adults: 2, children: 1, infants: 0 })).toBe('おとな2名・小学生1名（計3名）');
	});
});

describe('シフトの休みの判定', () => {
	const row = (o: Partial<Parameters<typeof classifyShiftDay>[0][number]>) => ({
		pattern_id: null, is_day_off: false, is_desired_off: false, holiday_type: null, half_day_type: null, custom_start_time: null, ...o
	});
	it('割り当てが無い日はシフト未作成', () => {
		expect(classifyShiftDay([]).kind).toBe('none');
		expect(classifyShiftDay([row({})]).kind).toBe('none');
	});
	it('公休・希望休・有休などは休み', () => {
		expect(classifyShiftDay([row({ is_day_off: true })])).toMatchObject({ kind: 'off', label: '公休' });
		expect(classifyShiftDay([row({ is_desired_off: true })])).toMatchObject({ kind: 'off', label: '希望休' });
		expect(classifyShiftDay([row({ holiday_type: 'yukyu' })])).toMatchObject({ kind: 'off', label: '有休' });
		expect(classifyShiftDay([row({ holiday_type: 'tokubetsu' })], { tokubetsu: '特別休暇' })).toMatchObject({ kind: 'off', label: '特別休暇' });
	});
	it('勤務のパターンか時刻がある日は出勤（半休は注意つき）', () => {
		expect(classifyShiftDay([row({ pattern_id: 'p' })]).kind).toBe('work');
		expect(classifyShiftDay([row({ pattern_id: 'p', half_day_type: 'PM' })])).toMatchObject({ kind: 'work', label: '半休' });
	});
});

describe('オンライン決済の期限', () => {
	const online = { date: '2026-12-05', payment_method: 'online' };
	it('期限は利用日の3日前・その日までは確定できる', () => {
		expect(chefPayDeadline('2026-12-05')).toBe('2026-12-02');
		expect(chefPayDeadlinePassed(online, '2026-12-01')).toBe(false);
		expect(chefPayDeadlinePassed(online, '2026-12-02')).toBe(false);
	});
	it('3日前を過ぎたら確定できない（現地払いは関係ない）', () => {
		expect(chefPayDeadlinePassed(online, '2026-12-03')).toBe(true);
		expect(chefPayDeadlinePassed(online, '2026-12-06')).toBe(true);
		expect(chefPayDeadlinePassed({ ...online, payment_method: 'onsite' }, '2026-12-04')).toBe(false);
	});
	it('月をまたぐ', () => {
		expect(chefPayDeadlinePassed({ date: '2026-03-02', payment_method: 'online' }, '2026-02-28')).toBe(true);
		expect(chefPayDeadlinePassed({ date: '2026-03-02', payment_method: 'online' }, '2026-02-27')).toBe(false);
	});
});

describe('受付枠の日付の確かめ', () => {
	it('実在する日付だけ通す', () => {
		expect(isValidIsoDate('2026-12-05')).toBe(true);
		expect(isValidIsoDate('2028-02-29')).toBe(true);
		expect(isValidIsoDate('2026-02-29')).toBe(false);
		expect(isValidIsoDate('2026-02-31')).toBe(false);
		expect(isValidIsoDate('2026-13-01')).toBe(false);
		expect(isValidIsoDate('2026-04-31')).toBe(false);
		expect(isValidIsoDate('2026-4-1')).toBe(false);
		expect(isValidIsoDate('')).toBe(false);
	});
});

describe('開いている枠とシフトの休みの重なり', () => {
	it('今日以降の開いている枠で、休みの日のものだけ', () => {
		const slots = [
			{ chef_staff_id: 'a', date: '2026-12-05', status: 'open' },
			{ chef_staff_id: 'a', date: '2026-12-06', status: 'closed' },
			{ chef_staff_id: 'b', date: '2026-12-05', status: 'open' },
			{ chef_staff_id: 'a', date: '2026-11-20', status: 'open' }
		];
		const shifts = { 'a|2026-12-05': { kind: 'off' }, 'a|2026-12-06': { kind: 'off' }, 'b|2026-12-05': { kind: 'work' }, 'a|2026-11-20': { kind: 'off' } };
		expect(chefOpenSlotsOnDayOff(slots, shifts, '2026-11-23')).toEqual([slots[0]]);
	});
});
