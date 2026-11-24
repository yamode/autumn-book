// 管理画面のパスが「施設に紐づく画面」かどうか（2026-11-24 指示）。
//
// 施設の割り当て（/admin/users の「施設の割り当て」＝ core.memberships）の外の施設を開いたときは、
// その施設に紐づく画面を**閲覧だけ**にする（保存はサーバで止める）。
// テナント共通の画面（会員・クーポン・キャンセル規定など、施設を切り替えても中身が変わらないもの）は
// 割り当てと関係がないので、そのまま編集できる（ユーザー確認済み・2026-11-24）。
//
// 「共通かどうか」は ADMIN_NAV の tenantWide を正とする（メニューの表示と判定がずれないように）。
// ⚠ メニューに無いパスは「施設に紐づく」とみなす（安全側）。新しい共通画面を足すときは
//    admin-nav.ts に tenantWide: true を付けること。付け忘れても編集できなくなるだけで、
//    割り当て外の施設のデータを触ってしまう事故にはならない。
import { ADMIN_NAV } from '$lib/admin-nav';

/** ログイン・二段階認証・施設の切り替えなど、施設にも割り当てにも関係のない入口（メニューに無い） */
const EXEMPT_PREFIXES = [
	'/admin/login', // ログイン・初期登録・パスワード再設定（そもそも未ログイン）
	'/admin/mfa', // 自分の二段階認証・パスキー
	'/admin/sso', // デスクトップアプリの SSO
	'/admin/switch' // 施設の切り替え（GET だけ）
];

/** tenantWide が付いたパス（長いものから見る＝ /admin/inquiries/ai は共通・/admin/inquiries は施設ごと） */
const TENANT_WIDE_PREFIXES: string[] = (() => {
	const out: string[] = [];
	for (const group of ADMIN_NAV) {
		for (const item of group.items) {
			if (item.tenantWide) out.push(item.href);
			for (const child of item.children ?? []) if (child.tenantWide) out.push(child.href);
		}
	}
	// ?tab= 等を落とし、長い順（最長一致を先に見る）
	return [...new Set(out.map((h) => h.split('?')[0]))].sort((a, b) => b.length - a.length);
})();

/** パスが prefix そのものか、その下か（/admin/members は /admin/members/legacy を含むが /admin/members-x は含まない） */
const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** 割り当てられた施設。'all' = 全施設（facility_id が null の行を持つ・判定できない環境） */
export type AssignedFacilities = 'all' | { bookIds: string[] };

/** この施設（Book の施設 ID）を操作してよいか */
export function canOperateFacility(assigned: AssignedFacilities, bookFacilityId: string): boolean {
	return assigned === 'all' || assigned.bookIds.includes(bookFacilityId);
}

/**
 * 管理画面で開く施設を決める（2026-11-24 指示）。
 *   ・クッキー（ab_fac）があればそれ。担当外の施設でも開ける（閲覧だけになる）
 *   ・無ければ**担当の施設**から始める。以前は常に先頭の施設だったため、
 *     男鹿だけ担当の ID でログインしても西和賀が開いていた
 *   ・担当がどれでもなければ先頭
 */
export function pickFacilityId(allIds: string[], cookieId: string | undefined, assigned: AssignedFacilities): { id: string; fromCookie: boolean } {
	if (cookieId && allIds.includes(cookieId)) return { id: cookieId, fromCookie: true };
	return { id: allIds.find((id) => canOperateFacility(assigned, id)) ?? allIds[0], fromCookie: false };
}

/** 施設に紐づかない（テナント共通の）画面か */
export function isTenantWideAdminPath(pathname: string): boolean {
	if (EXEMPT_PREFIXES.some((p) => under(pathname, p))) return true;
	// 最長一致。/admin/inquiries/ai（共通）と /admin/inquiries（施設ごと）を取り違えない
	for (const prefix of TENANT_WIDE_PREFIXES) if (under(pathname, prefix)) return true;
	return false;
}

/**
 * 割り当て外の施設を開いているときに、書き込みを止めるパスか。
 * ダッシュボード（/admin ちょうど）は読むだけなので対象外。
 */
export function isFacilityScopedAdminPath(pathname: string): boolean {
	if (!under(pathname, '/admin')) return false;
	if (pathname === '/admin') return false;
	return !isTenantWideAdminPath(pathname);
}
