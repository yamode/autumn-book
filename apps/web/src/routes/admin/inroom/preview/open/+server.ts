import { error, redirect } from '@sveltejs/kit';
import { facilities } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { stayCookieMaxAge } from '$lib/server/stay-cookie';
import { BROWSE_FACILITY_COOKIE, rememberBrowseFacility } from '$lib/server/inroom-browse';
import { parsePreviewBillFlags, previewBillCookieValue, PREVIEW_BILL_COOKIE } from '$lib/inroom-bill';
import {
	encodePreviewNotice,
	encodePreviewSpring,
	normalizePreviewNotice,
	normalizePreviewSpring,
	PREVIEW_NOTICE_COOKIE,
	PREVIEW_SPRING_COOKIE
} from '$lib/inroom-preview';
import type { RequestHandler } from './$types';

// 管理画面の「客室案内のプレビュー」（2026-10-17 指示）の入口。この端末の Cookie を切り替えて客室案内（/r）へ送る。
//   mode=stay   … 見本（デモ）の滞在トークン（PMS の「見本の館内図」と同じ・施設ごとに1本）で、ご滞在中のお客様の表示
//   mode=browse … 滞在の Cookie を消し、入口QRと同じ「コード入力前（館内案内だけ）」の表示
// 見本の貸切風呂の予約は本番の台帳に入る（PMS の見本と同じ）。トークンはブラウザの URL に出さない（Cookie だけ）。
// bill=items,front,online / none … 精算案内の見本の出し分け（Cookie ab_preview_bill・見本の滞在にだけ効く）。
//   bill=settings か省略 … 管理画面「精算案内」の設定どおり（Cookie を消す）
// notice=settings|sample|none（sample は nt＝見出し・nb＝本文）／spring=settings|sample|none（sample は sp＝0〜100）
//   … お知らせ・全館の湯量の見本（Cookie ab_preview_notice / ab_preview_spring・見本の滞在とコード入力前の表示にだけ効く）
// +server.ts は管理画面の layout の関所を通らないので、ここでもスタッフかを確かめる。
const STAY_COOKIE = 'ab_stay';
const useSupabaseAdmin = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';

// 見本の部屋名・お客様名（PMS の見本の館内図と同じ）
const DEMO_ROOM = '見本の間';
const DEMO_GUEST = '山人 太郎';
// DATA_SOURCE=demo の見本トークン（store.ts の固定データ）
const DEMO_STORE_TOKEN: Record<string, string> = { 'f-nishiwaga': 'demo-stay-nishiwaga', 'f-oga': 'demo-stay-oga' };

export const GET: RequestHandler = async (event) => {
	const { locals, cookies, url } = event;
	if (locals.user?.role !== 'admin' && locals.user?.role !== 'staff') redirect(303, '/admin/login');

	const facility = facilities.find((f) => f.id === cookies.get('ab_fac')) ?? facilities[0];
	const mode = url.searchParams.get('mode') === 'browse' ? 'browse' : 'stay';

	// お知らせ・湯量の見本（どちらの表示でも効く）。1日で消える
	const q = url.searchParams;
	const previewOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, maxAge: 24 * 60 * 60 };
	const notice = normalizePreviewNotice(q.get('notice'), q.get('nt'), q.get('nb'));
	if (notice) cookies.set(PREVIEW_NOTICE_COOKIE, encodePreviewNotice(notice), previewOpts);
	else cookies.delete(PREVIEW_NOTICE_COOKIE, { path: '/' });
	const spring = normalizePreviewSpring(q.get('spring'), q.get('sp'));
	if (spring) cookies.set(PREVIEW_SPRING_COOKIE, encodePreviewSpring(spring), previewOpts);
	else cookies.delete(PREVIEW_SPRING_COOKIE, { path: '/' });

	if (mode === 'browse') {
		cookies.delete(STAY_COOKIE, { path: '/' });
		cookies.delete(PREVIEW_BILL_COOKIE, { path: '/' });
		rememberBrowseFacility(cookies, facility.slug, 'ja');
		redirect(303, `/r?f=${encodeURIComponent(facility.slug)}`);
	}

	let token: string | null = null;
	let validTo = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
	if (useSupabaseAdmin) {
		const { data, error: e } = await createSupabaseServerClient(event)
			.schema('book')
			.rpc('get_or_issue_demo_stay_token', {
				p_facility: FACILITY_UUID[facility.id] ?? facility.id,
				p_room_code: DEMO_ROOM,
				p_guest_name: DEMO_GUEST
			});
		if (e) error(400, '見本の滞在を用意できませんでした（' + e.message + '）');
		const r = data as { token: string; valid_to: string };
		token = r.token;
		validTo = r.valid_to;
	} else if (DATA_SOURCE !== 'supabase') {
		token = DEMO_STORE_TOKEN[facility.id] ?? null;
	}
	if (!token) error(400, 'この環境では見本の滞在を用意できません（管理画面が実データに繋がっていません）。「コード入力前」の表示はお試しいただけます。');

	cookies.set(STAY_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: stayCookieMaxAge(validTo) });
	// 精算案内の見本の出し分け（2026-10-17）。'settings'・省略なら設定どおり
	const bill = url.searchParams.get('bill');
	const billFlags = bill && bill !== 'settings' ? parsePreviewBillFlags(bill) : null;
	if (bill && bill !== 'settings') {
		cookies.set(PREVIEW_BILL_COOKIE, billFlags ? previewBillCookieValue(billFlags) : 'none', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: stayCookieMaxAge(validTo) });
	} else {
		cookies.delete(PREVIEW_BILL_COOKIE, { path: '/' });
	}
	// 入口QRで覚えた施設は、見本の施設に合わせておく（滞在が切れたときの館内案内）
	if (cookies.get(BROWSE_FACILITY_COOKIE) !== facility.slug) rememberBrowseFacility(cookies, facility.slug, 'ja');
	redirect(303, '/r');
};
