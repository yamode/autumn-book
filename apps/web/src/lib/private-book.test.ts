import { describe, expect, it } from 'vitest';
import {
	choosePrivateBookPage,
	memberPageUrlToAccount,
	memberPortalForward,
	privateBookEntryHref,
	mergePbOffers,
	parsePbCookie,
	pbCartStorageKey,
	pbFacilitySpecial,
	pbSafeBack,
	pbStayCalendarDays,
	pbStayQuotes,
	privateBookVerdict,
	vipFacilitiesToAdd,
	type PbPage,
	type PbRateDay
} from './private-book';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const pages: PbPage[] = [
	{ partnerId: B, name: '父様 専用ページ', via: 'family' },
	{ partnerId: A, name: '本人様 専用ページ', via: 'self' }
];
const partner = { kind: 'member', is_active: true, valid_from: null, valid_until: null };
const TODAY = '2026-11-27';

describe('choosePrivateBookPage（本人のページを優先）', () => {
	it('?page= が無ければ本人のページを選ぶ（並びが家族→本人でも）', () => {
		expect(choosePrivateBookPage(pages)?.partnerId).toBe(A);
	});
	it('本人のページが無ければ家族のページ', () => {
		expect(choosePrivateBookPage([pages[0]])?.partnerId).toBe(B);
	});
	it('?page= は使えるページの中にあるときだけ（無いページ・壊れた値は null）', () => {
		expect(choosePrivateBookPage(pages, B)?.partnerId).toBe(B);
		expect(choosePrivateBookPage(pages, C)).toBeNull();
		expect(choosePrivateBookPage(pages, 'x')).toBeNull();
	});
	it('使えるページが無ければ null', () => {
		expect(choosePrivateBookPage([])).toBeNull();
	});
});

describe('privateBookVerdict（クッキーを信じない）', () => {
	const base = { cookie: A, isMember: true, pages, access: true, partner, today: TODAY };
	it('全部そろえば状態になり、切り替え先は本人→家族の順', () => {
		const s = privateBookVerdict(base);
		expect(s?.partnerId).toBe(A);
		expect(s?.via).toBe('self');
		expect(s?.pages.map((p) => p.partnerId)).toEqual([A, B]);
	});
	it('クッキーが UUID でなければ null', () => {
		expect(privateBookVerdict({ ...base, cookie: 'abc' })).toBeNull();
		expect(privateBookVerdict({ ...base, cookie: null })).toBeNull();
	});
	it('会員でなければ null', () => {
		expect(privateBookVerdict({ ...base, isMember: false })).toBeNull();
	});
	it('使えるページに無い partnerId（他人のページを書き込んだクッキー）は null', () => {
		expect(privateBookVerdict({ ...base, cookie: C })).toBeNull();
	});
	it('rms_member_page_access が偽なら null（家族の招待を外された・退会）', () => {
		expect(privateBookVerdict({ ...base, access: false })).toBeNull();
	});
	it('kind が member でない（取引先のページ）なら null', () => {
		expect(privateBookVerdict({ ...base, partner: { ...partner, kind: 'agent' } })).toBeNull();
		expect(privateBookVerdict({ ...base, partner: null })).toBeNull();
	});
	it('公開停止・公開期間の外なら null', () => {
		expect(privateBookVerdict({ ...base, partner: { ...partner, is_active: false } })).toBeNull();
		expect(privateBookVerdict({ ...base, partner: { ...partner, valid_from: '2026-12-01' } })).toBeNull();
		expect(privateBookVerdict({ ...base, partner: { ...partner, valid_until: '2026-11-26' } })).toBeNull();
	});
	it('大文字のクッキーでも同じページとみなす', () => {
		expect(privateBookVerdict({ ...base, cookie: A.toUpperCase() })?.partnerId).toBe(A);
	});
});

describe('pbFacilitySpecial（施設ごとの判定）', () => {
	const F1 = '10000000-0000-0000-0000-000000000001';
	const F2 = '10000000-0000-0000-0000-000000000002';
	const ctx = {
		kind: 'member',
		booking_enabled: true,
		facility_available: true,
		facility_id: F1,
		pricing: { rules: [{ action: 'adjust', dateTo: null }] }
	};
	it('予約受付オン・施設オン・販売中のルールがあれば特別料金', () => {
		expect(pbFacilitySpecial(ctx, F1, TODAY)).toBe(true);
	});
	it('別の施設で合成した値は使わない', () => {
		expect(pbFacilitySpecial(ctx, F2, TODAY)).toBe(false);
	});
	it('施設がオフ・予約受付オフ・ルールなし・期限切れのルールだけならふつうの料金', () => {
		expect(pbFacilitySpecial({ ...ctx, facility_available: false }, F1, TODAY)).toBe(false);
		expect(pbFacilitySpecial({ ...ctx, booking_enabled: false }, F1, TODAY)).toBe(false);
		expect(pbFacilitySpecial({ ...ctx, pricing: { rules: [] } }, F1, TODAY)).toBe(false);
		expect(pbFacilitySpecial({ ...ctx, pricing: { rules: [{ action: 'adjust', dateTo: '2026-11-01' }] } }, F1, TODAY)).toBe(false);
	});
	it('取引先（kind が member 以外）・null はふつうの料金', () => {
		expect(pbFacilitySpecial({ ...ctx, kind: 'agent' }, F1, TODAY)).toBe(false);
		expect(pbFacilitySpecial(null, F1, TODAY)).toBe(false);
	});
});

describe('小物', () => {
	it('parsePbCookie は UUID だけ', () => {
		expect(parsePbCookie(A)).toBe(A);
		expect(parsePbCookie(` ${A} `)).toBe(A);
		expect(parsePbCookie('1; DROP')).toBeNull();
	});
	it('かごの保存キーは状態のときだけ分ける', () => {
		expect(pbCartStorageKey(null)).toBe('ab_booking_cart_v1');
		expect(pbCartStorageKey(A)).toBe(`ab_booking_cart_v1:pb:${A}`);
	});
	it('戻り先は自サイトのパスだけ（入口へは戻さない）', () => {
		expect(pbSafeBack('/yamado/nishiwaga/plans?checkin=2026-12-01')).toBe('/yamado/nishiwaga/plans?checkin=2026-12-01');
		expect(pbSafeBack('https://evil.example/')).toBe('/search');
		expect(pbSafeBack('//evil.example/')).toBe('/search');
		expect(pbSafeBack('/private-book?back=/x')).toBe('/search');
		expect(pbSafeBack(null, '/')).toBe('/');
	});
	it('VIP の専用ページに足す施設は行の無い施設だけ（オフの行は戻さない）', () => {
		expect(vipFacilitiesToAdd(['f1', 'f2'], [{ facility_id: 'f1' }])).toEqual(['f2']);
		expect(vipFacilitiesToAdd(['f1', 'f2'], [{ facility_id: 'f1' }, { facility_id: 'f2' }])).toEqual([]);
		expect(vipFacilitiesToAdd(['f1', 'f2'], [])).toEqual(['f1', 'f2']);
	});
});

const day = (date: string, opts: { closed?: boolean; price?: number; remaining?: number | null; adults?: string } = {}): PbRateDay => ({
	date,
	closed: opts.closed ?? false,
	rooms: [
		{
			roomCode: 'R1',
			remainingRooms: opts.remaining === undefined ? 3 : opts.remaining,
			plans: [{ planCode: 'P1', planName: '夕朝食', pricesPerPerson: { [opts.adults ?? '2']: opts.price ?? 20000 } }]
		}
	]
});

describe('pbStayQuotes（泊ごとの1名料金 × 人数の和）', () => {
	it('2泊・2名の合計と泊ごとの残室の最小', () => {
		const q = pbStayQuotes([day('2026-12-01', { price: 20000, remaining: 3 }), day('2026-12-02', { price: 22000, remaining: 1 })], '2026-12-01', 2, 2);
		expect(q).toEqual([{ roomCode: 'R1', planKey: 'P1■夕朝食', total: 84000, remaining: 1 }]);
	});
	it('どれかの泊が休館・料金なし・その人数の料金なしなら出さない', () => {
		expect(pbStayQuotes([day('2026-12-01'), day('2026-12-02', { closed: true })], '2026-12-01', 2, 2)).toEqual([]);
		expect(pbStayQuotes([day('2026-12-01')], '2026-12-01', 2, 2)).toEqual([]);
		expect(pbStayQuotes([day('2026-12-01', { adults: '3' })], '2026-12-01', 1, 2)).toEqual([]);
	});
	it('プラン・部屋タイプで絞れる', () => {
		expect(pbStayQuotes([day('2026-12-01')], '2026-12-01', 1, 2, { plans: new Set(['P9■x']) })).toEqual([]);
		expect(pbStayQuotes([day('2026-12-01')], '2026-12-01', 1, 2, { roomCodes: new Set(['R2']) })).toEqual([]);
	});
	it('残室を出さない料金カレンダーは null', () => {
		expect(pbStayQuotes([day('2026-12-01', { remaining: null })], '2026-12-01', 1, 2)[0].remaining).toBeNull();
	});
});

describe('mergePbOffers（ふつうの料金に特別料金を重ねる）', () => {
	it('同じ組は差し替え、無い組は足し、特別料金の組を返す', () => {
		const normal = [
			{ ratePlanId: 'p1', roomTypeId: 'r1', total: 50000, perPerson: 25000, remaining: 2 },
			{ ratePlanId: 'p2', roomTypeId: 'r1', total: 30000, perPerson: 15000, remaining: 2 }
		];
		const special = [
			{ ratePlanId: 'p1', roomTypeId: 'r1', total: 40000, perPerson: 20000, remaining: 1 },
			{ ratePlanId: 'p3', roomTypeId: 'r2', total: 35000, perPerson: 17500, remaining: 1 }
		];
		const { offers, specialKeys } = mergePbOffers(normal, special);
		expect(offers.map((o) => [o.ratePlanId, o.total])).toEqual([
			['p1', 40000],
			['p2', 30000],
			['p3', 35000]
		]);
		expect([...specialKeys].sort()).toEqual(['p1|r1', 'p3|r2']);
	});
	it('特別料金が無ければふつうの料金のまま', () => {
		const normal = [{ ratePlanId: 'p1', roomTypeId: 'r1', total: 50000, perPerson: 25000, remaining: 2 }];
		expect(mergePbOffers(normal, []).offers).toEqual(normal);
	});
});

describe('pbStayCalendarDays', () => {
	const days = [day('2026-12-01', { price: 20000 }), day('2026-12-02', { price: 18000 }), day('2026-12-03', { price: 18000, remaining: 0 })];
	it('1泊の日ごとの最安「1名1泊」。満室の日は出さない', () => {
		const out = pbStayCalendarDays(days, { from: '2026-12-01', to: '2026-12-03' }, 1, 2);
		expect(out).toEqual([
			{ date: '2026-12-01', price: 20000, remaining: 3, rooms: 3 },
			{ date: '2026-12-02', price: 18000, remaining: 3, rooms: 3 }
		]);
	});
	it('締切を過ぎた日は出さない', () => {
		const out = pbStayCalendarDays(days, { from: '2026-12-01', to: '2026-12-02' }, 1, 2, { canBook: (d) => d > '2026-12-01' });
		expect(out.map((d) => d.date)).toEqual(['2026-12-02']);
	});
	it('残室が分からない日はふつうのカレンダーの残室を使い、それも無ければ出さない', () => {
		const unknown = [day('2026-12-01', { remaining: null }), day('2026-12-02', { remaining: null })];
		const out = pbStayCalendarDays(unknown, { from: '2026-12-01', to: '2026-12-02' }, 1, 2, {
			fallback: new Map([['2026-12-01', { remaining: 2, rooms: 4 }]])
		});
		expect(out).toEqual([{ date: '2026-12-01', price: 20000, remaining: 2, rooms: 4 }]);
	});
});

describe('memberPortalForward（B面の特別会員の URL → 公式サイト・v0.355.0）', () => {
	const ID = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
	const entry = '/private-book?page=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
	it('予約・料金の画面はプライベートブックの入口（?page= はページの partnerId）', () => {
		for (const sub of ['/', '', '/calendar', '/calendar/', '/plans', '/rooms', '/rate-sheet', '/rate-sheet/csv', '/book', '/calendar/month']) {
			expect(memberPortalForward(sub, 'GET', ID)).toEqual({ kind: 'redirect', location: entry });
		}
		expect(memberPortalForward('/calendar', 'HEAD', ID)).toEqual({ kind: 'redirect', location: entry });
	});
	it('ご予約一覧はマイページの予約一覧', () => {
		expect(memberPortalForward('/bookings', 'GET', ID)).toEqual({ kind: 'redirect', location: '/account/reservations' });
		expect(memberPortalForward('/bookings/', 'GET', ID)).toEqual({ kind: 'redirect', location: '/account/reservations' });
	});
	it('ご予約の詳細とその下は同じ形（日程変更・お部屋の変更・アレンジ）', () => {
		const at = (sub: string) => memberPortalForward(sub, 'GET', ID);
		expect(at('/bookings/YB-2026-000001')).toEqual({ kind: 'redirect', location: '/account/reservations/YB-2026-000001' });
		expect(at('/bookings/YB-2026-000001/amend')).toEqual({ kind: 'redirect', location: '/account/reservations/YB-2026-000001/amend' });
		expect(at('/bookings/YB-2026-000001/amend/room/2')).toEqual({ kind: 'redirect', location: '/account/reservations/YB-2026-000001/amend/room/2' });
		expect(at('/bookings/YB-2026-000001/options')).toEqual({ kind: 'redirect', location: '/account/reservations/YB-2026-000001/options' });
		// 知らない下の階層は詳細へ
		expect(at('/bookings/YB-2026-000001/receipt')).toEqual({ kind: 'redirect', location: '/account/reservations/YB-2026-000001' });
	});
	it('形の違う予約番号は一覧へ（外のパス・別のホストへは出さない）', () => {
		for (const sub of ['/bookings/..%2F..%2Fadmin', '/bookings/%E0%A4%A', '/bookings/a%20b', '/bookings/%2F%2Fevil.example']) {
			expect(memberPortalForward(sub, 'GET', ID)).toEqual({ kind: 'redirect', location: '/account/reservations' });
		}
	});
	it('GET / HEAD 以外は 410（gone）', () => {
		for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
			expect(memberPortalForward('/book', m, ID)).toEqual({ kind: 'gone' });
			expect(memberPortalForward('/bookings/YB-2026-000001', m, ID)).toEqual({ kind: 'gone' });
		}
	});
	it('partnerId が UUID でなければ ?page なしの入口', () => {
		expect(memberPortalForward('/calendar', 'GET', 'x')).toEqual({ kind: 'redirect', location: '/private-book' });
		expect(privateBookEntryHref(null)).toBe('/private-book');
		expect(privateBookEntryHref(ID)).toBe(entry);
	});
});

describe('memberPageUrlToAccount（DB の member_page_url → マイページの予約詳細）', () => {
	it('/p/<token>/bookings/<予約番号> だけ置き換える', () => {
		expect(memberPageUrlToAccount('/p/tokP_abc-1/bookings/YB-2026-007001')).toBe('/account/reservations/YB-2026-007001');
		expect(memberPageUrlToAccount(null)).toBeNull();
		expect(memberPageUrlToAccount('')).toBeNull();
		expect(memberPageUrlToAccount('https://evil.example/p/t/bookings/YB-1')).toBeNull();
		expect(memberPageUrlToAccount('/p/t/calendar')).toBeNull();
		expect(memberPageUrlToAccount('/p/t/bookings/YB-1/amend')).toBeNull();
		expect(memberPageUrlToAccount('/p/t/bookings/a%20b')).toBeNull();
	});
});
