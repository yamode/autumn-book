// 管理画面「Autumn Live の背景」（/admin/security/live/scenes）のサーバ処理。設計: docs/autumn-live.md §10
//
// - シーン（期間・優先・空の色・層の JSON）の一覧・追加・保存・使う／使わない・削除
// - 画像を book-photos バケットの live-scenes/ に上げて URL を返す（ログイン中の管理者の権限で上げる）
// 保存した内容は、Live の画面が 1 分以内に読み直して差し替える（版の更新は要らない）。
// 表 book.live_scenes は service_role だけ（admin-client.ts の例外その16）。呼ぶ側は role が admin であることを確かめる。操作は監査ログへ。
import type { SupabaseClient } from '@supabase/supabase-js';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { isMonthDay, parseSceneConfig, type LiveSceneConfig } from '$lib/live-scene';

export class LiveSceneError extends Error {
	constructor(message: string, public status = 400) {
		super(message);
	}
}

export type LiveSceneRow = {
	id: string;
	name: string;
	starts: string;
	ends: string;
	priority: number;
	enabled: boolean;
	config: LiveSceneConfig;
	updated_at: string;
};

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const book = (svc: SupabaseClient) => svc.schema('book');
function db(): SupabaseClient {
	const svc = partnerServiceClient();
	if (!svc) throw new LiveSceneError('サーバの設定（SUPABASE_SERVICE_ROLE_KEY）が無いため、使えません。', 503);
	return svc;
}
async function audit(svc: SupabaseClient, actorId: string, action: string, detail: Record<string, unknown>) {
	const { error } = await book(svc).from('admin_audit_logs').insert({ tenant_id: TENANT_ID, actor: actorId, action, detail });
	if (error) console.error('[live-scenes] 監査ログを書けませんでした:', error.message);
}

export async function listLiveScenes(): Promise<LiveSceneRow[]> {
	const { data, error } = await book(db()).from('live_scenes').select('id, name, starts, ends, priority, enabled, config, updated_at').order('starts');
	if (error) throw new LiveSceneError('背景の一覧を読めませんでした。', 500);
	return (data ?? []) as LiveSceneRow[];
}

export type SceneInput = { id: string | null; name: string; starts: string; ends: string; priority: number; enabled: boolean; configText: string };

/** 入力を確かめる。だめなら日本語の理由 */
export function checkSceneInput(f: FormData): { ok: true; input: SceneInput; config: LiveSceneConfig } | { ok: false; message: string } {
	const id = String(f.get('id') ?? '').trim() || null;
	if (id && !/^[0-9a-f-]{36}$/.test(id)) return { ok: false, message: '対象のシーンが分かりません。' };
	const name = String(f.get('name') ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
	if (!name || name.length > 60) return { ok: false, message: '名前を 60 文字以内で入れてください。' };
	const starts = String(f.get('starts') ?? '').trim(), ends = String(f.get('ends') ?? '').trim();
	if (!isMonthDay(starts) || !isMonthDay(ends)) return { ok: false, message: '期間は「11-01」のように 月-日 で入れてください。' };
	const priority = Number(f.get('priority') ?? 0);
	if (!Number.isInteger(priority) || priority < -100 || priority > 100) return { ok: false, message: '優先は -100〜100 の整数で入れてください。' };
	const configText = String(f.get('config') ?? '');
	if (configText.length > 20000) return { ok: false, message: '設定が長すぎます。' };
	const parsed = parseSceneConfig(configText);
	if (!parsed.ok) return { ok: false, message: `設定（JSON）: ${parsed.message}` };
	return { ok: true, input: { id, name, starts, ends, priority, enabled: f.get('enabled') === 'on', configText }, config: parsed.config };
}

export async function saveLiveScene(actorId: string, input: SceneInput, config: LiveSceneConfig): Promise<string> {
	const svc = db();
	const row = { name: input.name, starts: input.starts, ends: input.ends, priority: input.priority, enabled: input.enabled, config, updated_at: new Date().toISOString(), updated_by: actorId };
	if (input.id) {
		const { error } = await book(svc).from('live_scenes').update(row).eq('id', input.id);
		if (error) throw new LiveSceneError('保存できませんでした。', 500);
		await audit(svc, actorId, 'live_scene_saved', { id: input.id, name: input.name });
		return input.id;
	}
	const { data, error } = await book(svc).from('live_scenes').insert(row).select('id').single<{ id: string }>();
	if (error || !data) throw new LiveSceneError('追加できませんでした。', 500);
	await audit(svc, actorId, 'live_scene_created', { id: data.id, name: input.name });
	return data.id;
}

export async function deleteLiveScene(actorId: string, id: string): Promise<void> {
	if (!/^[0-9a-f-]{36}$/.test(id)) throw new LiveSceneError('対象のシーンが分かりません。');
	const svc = db();
	const { data, error } = await book(svc).from('live_scenes').delete().eq('id', id).select('name').maybeSingle<{ name: string }>();
	if (error) throw new LiveSceneError('削除できませんでした。', 500);
	await audit(svc, actorId, 'live_scene_deleted', { id, name: data?.name ?? null });
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/avif': 'avif', 'image/gif': 'gif' };
export const SCENE_IMAGE_MAX = 4 * 1024 * 1024;

/** 画像の形式・大きさの確かめ（だめなら理由） */
export function sceneImageProblem(file: File | null): string | null {
	if (!file || !file.size) return '画像を選んでください。';
	if (!EXT[file.type]) return '画像は PNG・WebP・JPEG・AVIF・GIF にしてください（透明な部分がある絵は PNG か WebP）。';
	if (file.size > SCENE_IMAGE_MAX) return '画像は 4MB までにしてください。';
	return null;
}

/** 画像を上げて公開 URL を返す（ログイン中の管理者の権限で） */
export async function uploadSceneImage(client: SupabaseClient, actorId: string, file: File): Promise<string> {
	const path = `live-scenes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${EXT[file.type]}`;
	const { error } = await client.storage.from('book-photos').upload(path, file, { contentType: file.type, upsert: false });
	if (error) throw new LiveSceneError('画像を上げられませんでした。もう一度お試しください。', 500);
	const svc = partnerServiceClient();
	if (svc) await audit(svc, actorId, 'live_scene_image_uploaded', { path });
	return client.storage.from('book-photos').getPublicUrl(path).data.publicUrl;
}
