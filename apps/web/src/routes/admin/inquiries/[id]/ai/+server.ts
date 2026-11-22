// AI 下書きの作り直しを、書いているそばから画面に出す（2026-11-22）。
// draft-inquiry-reply を stream: true で呼び、stage（今していること）・delta（本文の増えた分）をそのまま画面へ流す。
// 最後の結果（done）を受けたら、これまでのフォームの action=ai と同じように下書きを保存してから done を送る。
// 返すのは Server-Sent Events（data: {type, ...}）。始める前の失敗（権限・競合など）は JSON のエラーで返す。
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseServerClient, ADMIN_SUPABASE } from '$lib/server/auth';
import { aiConfigured, inquiry, openDraftStream, type Source } from '$lib/server/inquiries';
import { canDraftInquiry } from '$lib/inquiries';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { readSseJson, sseLine } from '$lib/sse';

type DraftResult = { text: string; sources: Source[]; model: string; language: string; japanese: string };

export const POST: RequestHandler = async (event) => {
	const reply = (data: unknown, status = 200) => json(data, { status, headers: { 'cache-control': 'no-store' } });
	if (event.request.headers.get('origin') !== event.url.origin) return reply({ error: '許可されていないアクセスです。' }, 403);
	if (!ADMIN_SUPABASE || !['admin', 'staff'].includes(event.locals.user?.role ?? '')) return reply({ error: 'スタッフとしてログインしてください。' }, 401);
	let input: { revision?: unknown; draftVersion?: unknown; instructions?: unknown };
	try {
		input = await event.request.json();
	} catch {
		return reply({ error: '入力内容を確認してください。' }, 400);
	}
	const revision = Number(input?.revision), draftVersion = Number(input?.draftVersion);
	const instructions = typeof input?.instructions === 'string' ? input.instructions.trim() : '';
	if (!Number.isInteger(revision) || !Number.isInteger(draftVersion)) return reply({ error: '入力内容を確認してください。' }, 400);
	if (instructions.length > 2000) return reply({ error: '書き直しの指示は2,000文字以内で入力してください。' }, 400);

	const db = createSupabaseServerClient(event);
	let item;
	try {
		item = await inquiry(db, event.params.id);
	} catch (e) {
		return reply({ error: e instanceof Error ? e.message : 'お問い合わせを取得できません。' }, 503);
	}
	if (!item || item.facility_id !== FACILITY_UUID['f-nishiwaga']) return reply({ error: 'お問い合わせが見つかりません。' }, 404);
	if (!canDraftInquiry(item)) return reply({ error: 'このお問い合わせはAI下書きの対象外です。' }, 409);
	if (!aiConfigured()) return reply({ error: '本番データ環境で利用できます。' }, 503);
	if (revision !== item.revision) return reply({ error: '新しい返信または他の担当者の変更があります。入力内容を控えて再読み込みしてください。' }, 409);
	if (draftVersion !== item.draft_version) return reply({ error: '他の担当者の下書きが更新されました。入力本文をコピーし、再読み込みしてください。' }, 409);

	const opened = await openDraftStream(db, item, instructions);
	if ('error' in opened) return reply({ error: opened.error }, opened.status);

	const enc = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(c) {
			let open = true;
			const send = (ev: Record<string, unknown>) => {
				if (!open) return;
				try {
					c.enqueue(enc.encode(sseLine(ev)));
				} catch {
					open = false; // 画面が閉じられた。保存は続ける
				}
			};
			try {
				let result: DraftResult | null = null;
				await readSseJson(opened.body, (ev) => {
					if (ev.type === 'stage' || ev.type === 'delta') send(ev);
					else if (ev.type === 'done') result = ev.result as DraftResult;
					else if (ev.type === 'error') throw new Error(typeof ev.error === 'string' ? ev.error : 'AI下書きを作成できませんでした。');
				});
				const draft = result as DraftResult | null;
				if (!draft?.text) throw new Error('AI下書きを作成できませんでした。時間をおいて再度お試しください。');
				send({ type: 'stage', stage: 'saving' });
				// 保存はこれまでのフォームの action=ai と同じ（本文・根拠・モデルを入れ、版の確認は DB が行う）
				const { error: e } = await db.schema('book').rpc('admin_inquiry_edit', {
					p_id: item.id,
					p_revision: revision,
					p_action: 'ai',
					p_body: draft.text,
					p_expected_draft_version: item.draft_version,
					p_sources: draft.sources,
					p_model: draft.model
				});
				if (e) throw new Error(/conflict/.test(e.message) ? '作成中に下書きが更新されました。再読み込みしてからもう一度お試しください。' : 'AI下書きを保存できませんでした。時間をおいて再度お試しください。');
				if (draft.japanese)
					await db.schema('book').rpc('admin_inquiry_translation_save', { p_id: item.id, p_target: 'draft', p_source: draft.text, p_text: draft.japanese, p_language: draft.language, p_model: draft.model });
				send({ type: 'done', text: draft.text, message: 'AI下書きを保存しました。根拠と要確認箇所をご確認ください。' });
			} catch (err) {
				send({ type: 'error', error: err instanceof Error ? err.message : 'AI下書きを作成できませんでした。' });
			} finally {
				if (open) try { c.close(); } catch { /* 閉じられている */ }
			}
		}
	});
	return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
};
