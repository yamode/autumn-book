import { error, redirect } from '@sveltejs/kit';
import { facilities } from '$lib/server/store';
import { stayCookieMaxAge } from '$lib/server/stay-cookie';
import { BROWSE_FACILITY_COOKIE, rememberBrowseFacility } from '$lib/server/inroom-browse';
import { demoStayToken } from '$lib/server/inroom-demo-token';
import { loadDemoPreview } from '$lib/server/inroom-settings';
import { PREVIEW_BILL_COOKIE } from '$lib/inroom-bill';
import { encodePreviewNotice, encodePreviewSpring, PREVIEW_NOTICE_COOKIE, PREVIEW_SPRING_COOKIE } from '$lib/inroom-preview';
import type { RequestHandler } from './$types';

// 管理画面の「客室案内のプレビュー」（2026-10-17 指示）の入口。この端末の Cookie を切り替えて客室案内（/r）へ送る。
//   mode=stay   … 見本（デモ）の滞在トークン（PMS の「見本の館内図」と同じ・施設ごとに1本）で、ご滞在中のお客様の表示。
//                  精算案内・お知らせ・湯量の見本は施設ごとに DB に持つ（book.inroom_settings.demo_preview）ので、
//                  PMS の QR やプレビューの QR からスマホで開いても同じに出る
//   mode=browse … 滞在の Cookie を消し、入口QRと同じ「コード入力前（館内案内だけ）」の表示。
//                  お知らせ・湯量の見本は、保存済みの見本をこの端末の Cookie に写して出す（本物のお客様には出ない）
// 見本の貸切風呂の予約は本番の台帳に入る（PMS の見本と同じ）。トークンはブラウザの URL に出さない（Cookie だけ）。
// +server.ts は管理画面の layout の関所を通らないので、ここでもスタッフかを確かめる。
const STAY_COOKIE = 'ab_stay';

export const GET: RequestHandler = async (event) => {
	const { locals, cookies, url } = event;
	if (locals.user?.role !== 'admin' && locals.user?.role !== 'staff') redirect(303, '/admin/login');

	const facility = facilities.find((f) => f.id === cookies.get('ab_fac')) ?? facilities[0];
	const mode = url.searchParams.get('mode') === 'browse' ? 'browse' : 'stay';
	// 以前の版が置いた精算案内の見本の Cookie は使わなくなった（DB の見本に一本化）
	cookies.delete(PREVIEW_BILL_COOKIE, { path: '/' });

	if (mode === 'browse') {
		const demo = await loadDemoPreview(facility.id);
		const opts = { path: '/', httpOnly: true, sameSite: 'lax' as const, maxAge: 24 * 60 * 60 };
		if (demo.notice) cookies.set(PREVIEW_NOTICE_COOKIE, encodePreviewNotice(demo.notice), opts);
		else cookies.delete(PREVIEW_NOTICE_COOKIE, { path: '/' });
		if (demo.spring) cookies.set(PREVIEW_SPRING_COOKIE, encodePreviewSpring(demo.spring), opts);
		else cookies.delete(PREVIEW_SPRING_COOKIE, { path: '/' });
		cookies.delete(STAY_COOKIE, { path: '/' });
		rememberBrowseFacility(cookies, facility.slug, 'ja');
		redirect(303, `/r?f=${encodeURIComponent(facility.slug)}`);
	}

	// ご滞在中（見本）は DB の見本を使うので、コード入力前の Cookie は消す
	cookies.delete(PREVIEW_NOTICE_COOKIE, { path: '/' });
	cookies.delete(PREVIEW_SPRING_COOKIE, { path: '/' });
	let demo;
	try {
		demo = await demoStayToken(event, facility.id);
	} catch (e) {
		error(400, e instanceof Error ? e.message : '見本の滞在を用意できませんでした');
	}
	if (!demo) error(400, 'この環境では見本の滞在を用意できません（管理画面が実データに繋がっていません）。「コード入力前」の表示はお試しいただけます。');

	cookies.set(STAY_COOKIE, demo.token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: stayCookieMaxAge(demo.validTo) });
	// 入口QRで覚えた施設は、見本の施設に合わせておく（滞在が切れたときの館内案内）
	if (cookies.get(BROWSE_FACILITY_COOKIE) !== facility.slug) rememberBrowseFacility(cookies, facility.slug, 'ja');
	redirect(303, '/r');
};
