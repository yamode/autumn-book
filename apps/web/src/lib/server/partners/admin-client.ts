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
//
// 例外その2（v0.43.0）: 公式サイト予約のオンライン決済（src/lib/server/direct-payments.ts）もこのクライアントを使う。
//   Stripe の Webhook（ブラウザが閉じられた後の確定・返金の同期）はお客様のセッションが無いところで予約を確定する
//   必要があり、book.direct_payment_* は service_role だけに grant している。サーバが Stripe から Intent を取り直して
//   検証してから呼ぶこと（ブラウザから届いた値をそのまま渡さない）。
//
// 例外その3（2026-10-09・セキュリティレビュー H-1）: 客室案内の手入力コード照合（supabase-data.ts sbClaimStayByCode）。
//   book.claim_stay_by_code を anon から外して総当たりを防ぐため、サーバが接続元 IP を添えて service_role で呼ぶ。
//   ほかに保存カード（member-saved-cards.ts）・スタッフの会員登録（staff-member-register.ts）でも使っている。
//
// 例外その4（2026-10-10・auth-hardening.md §9 S1）: FAQ ボットの質問ログ（routes/api/faq/[facility]/search・feedback）。
//   book.faq_log_query / faq_feedback を anon から外し、IP 制限を通したサーバからだけ記録する（ログ汚染・集計改ざん対策）。
// 例外その5（2026-10-10・docs/auth-hardening.md §7.4）: 管理画面の二段階認証の復旧（src/lib/server/admin-mfa.ts）。
//   他の管理者の第2要素の一覧・削除は Supabase Auth の管理 API（auth.admin.listUsers / auth.admin.mfa.*）で service_role が要る。
//   呼び出し元（routes/admin/security/users）は「操作者が admin・aal2」を確かめてから呼び、book.admin_audit_logs に
//   admin_mfa_reset を記帳してから削除する。
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
