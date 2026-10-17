// 客室案内のプレビュー（2026-10-17）。見本の滞在（施設ごとに1本・PMS の「見本の館内図」と共通）に出す
// 精算案内・お知らせ・湯量の見本を、施設ごとに DB に保存する（book.inroom_settings.demo_preview）。
// 保存した見本は、プレビューの枠・プレビューの QR・PMS の見本の QR のどれで開いても同じに出る。
// QR は見本の滞在の入口（/r/c/<token>）。スマホのカメラで読むと、その端末で見本の客室案内が開く。
import { fail } from '@sveltejs/kit';
import qrcode from 'qrcode-generator';
import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { facilities } from '$lib/server/store';
import { demoStayToken } from '$lib/server/inroom-demo-token';
import { loadDemoPreview, saveDemoPreviewDemo, sbSaveDemoPreview } from '$lib/server/inroom-settings';
import { parsePreviewBillFlags } from '$lib/inroom-bill';
import { inroomTestPaymentBlocker } from '$lib/server/inroom-bill';
import { normalizePreviewNotice, normalizePreviewSpring, type DemoPreview } from '$lib/inroom-preview';
import type { Actions, PageServerLoad } from './$types';

const useSupabaseAdmin = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';
const facilityOf = (id: string | undefined) => facilities.find((f) => f.id === id) ?? facilities[0];

export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	const facility = facilityOf(event.cookies.get('ab_fac'));
	// 見本の中身と見本の滞在は互いに依存しないので同時に投げる（2026-10-18 高速化）
	const tokenLoad = demoStayToken(event, facility.id);
	tokenLoad.catch(() => {});
	const demoPreview = await loadDemoPreview(facility.id);
	// 見本の滞在の QR（用意できない環境・失敗は null＝QR を出さず理由を出す）
	let qr: { svg: string; url: string } | null = null;
	let qrError: string | null = null;
	try {
		const t = await tokenLoad;
		if (t) {
			const url = `${event.url.origin}/r/c/${t.token}`;
			const q = qrcode(0, 'M');
			q.addData(url);
			q.make();
			// 自己生成の SVG なので {@html} で出してよい
			qr = { svg: q.createSvgTag({ cellSize: 4, margin: 2 }), url };
		} else {
			qrError = 'この環境では見本の滞在を用意できません。';
		}
	} catch (e) {
		qrError = e instanceof Error ? e.message : '見本の滞在を用意できませんでした。';
	}
	// 本番の Stripe での ¥100 のテスト決済を、この端末で試せるか（できなければ理由・2026-10-17）
	return { demoPreview, qr, qrError, testPaymentBlocker: inroomTestPaymentBlocker(event.locals) };
};

export const actions: Actions = {
	// 見本を保存する（スタッフも保存できる・見本の滞在にだけ効く）
	save: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'admin' && user.role !== 'staff')) return fail(403, { message: '権限がありません' });
		const form = await event.request.formData();
		const facility = facilityOf(event.cookies.get('ab_fac'));
		const billMode = String(form.get('billMode') ?? 'settings');
		const billParts = form.getAll('bill').map(String);
		const preview: DemoPreview = {
			bill: billMode === 'custom' ? (parsePreviewBillFlags(billParts.join(',')) ?? { items: false, front: false, online: false }) : null,
			notice: normalizePreviewNotice(form.get('noticeMode'), form.get('noticeTitle'), form.get('noticeBody')),
			spring: normalizePreviewSpring(form.get('springMode'), form.get('springPercent'))
		};
		try {
			if (useSupabaseAdmin) await sbSaveDemoPreview(createSupabaseServerClient(event), facility.id, preview);
			else saveDemoPreviewDemo(facility.id, preview);
		} catch (e) {
			return fail(500, { message: e instanceof Error ? e.message : '保存できませんでした' });
		}
		return { saved: true };
	}
};
