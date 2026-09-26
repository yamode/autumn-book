// 取引先専用ページ（/p/<token>・/api/partner/*・/api/cron/partner-charge）専用の service_role クライアント。
//
// ⚠ autumn-book の他の機能では service_role を使わない方針（書き込みは book.admin_* の SECURITY DEFINER RPC、
//   読み取りは anon / ログイン中ユーザーの RLS で行う）。このファイルはその唯一の例外で、取引先モジュール
//   （src/lib/server/partners/** と上記ルート）以外から import しないこと。
//
// 例外にしている理由:
//   - 取引先機能は Supabase Auth を使わず、独自のセッション（cookie rms_partner_session・path /p/<token>）と
//     API キー（rmsp_）で本人確認する。auth.uid() が無いので RLS では守れず、rms_partner_* の表と RPC は
//     RLS / GRANT で service_role 以外を拒否している（autumn-shared migration 20260926025319 ほか）。
//   - そのため「限定URLのトークン → 取引先 → セッション/API キー」の結び付きを store.ts で必ず確かめてから、
//     このクライアントで読み書きする。入口の検証が命綱なので、ここを通さずに rms_partner_* を触らないこと。
//
// 2026-09-26 に autumn-rms から移設（予約に関わる社外向け画面は Book に集約）。
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

let cached: { key: string; client: SupabaseClient } | null = null;

// SUPABASE_SERVICE_ROLE_KEY（Cloudflare の secret）と URL が揃っていなければ null。
// 呼び出し側は null のとき「現在ご利用いただけません」（503）にして、画面を落とさない。
export function partnerServiceClient(): SupabaseClient | null {
	const serviceRoleKey = privateEnv.SUPABASE_SERVICE_ROLE_KEY?.trim();
	const supabaseUrl = (privateEnv.SUPABASE_URL || publicEnv.PUBLIC_SUPABASE_URL)?.trim();
	if (!serviceRoleKey || !supabaseUrl) return null;
	const key = `${supabaseUrl}|${serviceRoleKey}`;
	if (cached?.key === key) return cached.client;
	const client = createClient(supabaseUrl, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
	});
	cached = { key, client };
	return client;
}
