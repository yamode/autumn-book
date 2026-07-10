import { error } from '@sveltejs/kit';
import qrcode from 'qrcode-generator';
import { getStayTokenById } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID, sbListStayTokens } from '$lib/server/supabase-data';
import type { StayToken } from '$lib/types';
import type { PageServerLoad } from './$types';

const useSupabaseAdmin = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';

export const load: PageServerLoad = async (event) => {
	const id = event.params.id;

	let token: StayToken | undefined;
	if (useSupabaseAdmin) {
		const { currentFacility } = await event.parent();
		const client = createSupabaseServerClient(event);
		const uuid = FACILITY_UUID[currentFacility.id] ?? currentFacility.id;
		// 単体取得 RPC は無いため、施設のトークン一覧（全件）から id で引く
		const list = await sbListStayTokens(client, uuid, true);
		token = list.find((t) => t.id === id);
	} else {
		token = getStayTokenById(id);
	}
	if (!token) error(404, 'スリップが見つかりません');

	// QR には claim 用の絶対URL（/r/c/<token>）を入れる。手入力用に /r も併記。
	const claimUrl = `${event.url.origin}/r/c/${token.token}`;
	const manualUrl = `${event.url.origin}/r`;

	// 純JS で SVG を生成（canvas 不使用・サーバ側で完結）。自己生成 SVG なので {@html} 安全。
	const qr = qrcode(0, 'M');
	qr.addData(claimUrl);
	qr.make();
	const qrSvg = qr.createSvgTag({ cellSize: 4, margin: 2 });

	return {
		token: {
			id: token.id,
			roomCode: token.roomCode,
			guestName: token.guestName,
			shortCode: token.shortCode,
			validTo: token.validTo
		},
		qrSvg,
		claimUrl,
		manualUrl
	};
};
