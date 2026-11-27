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
// 例外その6（2026-10-10・auth-hardening.md §9 S8）: 公式サイトの仮押さえ（supabase-data.ts createHold / releaseHold）。
//   book.create_hold（新署名）/ release_hold を anon から外し、KV `hold:<ip>` を通したサーバが接続元 IP と
//   検証済みセッションの会員 id を添えて呼ぶ（在庫枯渇攻撃の対策。DB 側にも 10 分 20 件の上限）。
// 例外その7（2026-10-11・docs/vip-member-page.md §13.5）: 特別会員の専用ページ（rms_partners.kind='member'）。
//   - マイページの「あなた専用のページ」（public.rms_member_pages_for）と、公式マイページ・完了画面・非会員リンクの
//     専用ページへのリンク（rms_partners.url_token の解決）
//   - 専用ページの仮押さえ book.create_member_page_hold_group と、取消・日程変更・オプションの入口 book.member_page_*
//     （lib/server/partners/member-hold.ts・member-bookings.ts）。サーバが Supabase で検証した会員 id と、
//     料金ルールでサーバが計算した泊明細を渡す（RPC の中でも対象者・予約の持ち主・ページの一致を確かめる）
//   - 会員のグレードの還元率（book.member_ranks）・部屋タイプ／プランのコードと UUID の対応（booking.rate_plans・pms.room_types）
// 例外その8（2026-10-17）: 管理画面のパスキー（src/lib/server/admin-passkeys.ts・book.admin_passkey*）。
//   表は service_role だけに grant している。呼ぶ側（routes/admin/**）は getUser() で検証した本人の id で絞り、
//   パスワード無しのログインは署名を確かめてから管理 API（generateLink → verifyOtp）でセッションを作る。
// 例外その9（2026-10-17）: 客室案内の精算のオンライン決済（src/lib/server/inroom-bill.ts・book.inroom_payment_*）。
//   お客様はログインしていない（滞在トークンの Cookie だけ）うえ、Webhook はお客様のセッションが無いところで確定するため。
//   RPC の中で滞在トークン・残額・決済額を確かめ、PMS の請求書に入金行を立てる。台帳 book.inroom_payments は service_role だけ。
//   プレビューでの本番のテスト決済（v0.142.0・inroom_test_payment_prepare）も同じ。見本の滞在トークンと、アプリが確かめた管理者の id で呼ぶ。
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// 例外その10: 西和賀HPの署名検証済み受付API（/api/inquiries/nishiwaga）。
// 公開受付からは service-only の inquiry_accept だけを呼ぶ。社内の閲覧・変更は利用者JWTと施設権限で行う。
// 例外その11: news/preview の署名・期限・記事ID・施設一致を検証した後に、その1記事だけを読む。
// 例外その12（2026-10-28・docs/auth-hardening.md §7.5）: デスクトップアプリからの管理画面 SSO（routes/admin/sso/+server.ts）。
//   Bearer の access_token を auth.getUser(jwt) で確かめ、admin / staff・停止なしを確認してから、パスキーのログイン（例外その8）と
//   同じ generateLink → verifyOtp で Book 専用 Cookie にセッションを作る。メールアドレスは検証済みトークンの user.email だけを使う。
// 例外その13（2026-10-28・docs/auth-hardening.md §7.6）: 共有セッション Cookie による管理画面の自動ログイン（lib/server/admin-shared-sso.ts）。
//   例外その12 と同じ確かめ方（共有 Cookie の access_token を auth.getUser(jwt)・admin / staff・停止なし）のあと、同じ手で Book 専用のセッションを作る。
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

// 例外その15（2026-11-22・docs/member-support.md）: 会員サポート（lib/server/member-support.ts）。
//   ヘルプページの問い合わせフォーム（book.support_submit）と、受信用 Worker からの署名つき受信（book.support_inbound）。
//   どちらも service_role だけに grant している。フォームは Turnstile・回数制限・入力の検証の後、受信は署名と時刻の検証の後に呼ぶ。
//   会員の id はサーバが auth.getUser() で確かめた値だけを渡す。
// 例外その14（2026-11-01・v0.230.0）: スタッフの販売ページプレビュー（lib/server/plan-preview.ts）。
//   販売中でないプランを本物の在庫・料金で確かめるため、x-book-preview-plan ヘッダー付きで呼ぶ（autumn-shared 20261101073819）。
//   DB は service_role の呼び出しのときだけヘッダーを見る。呼ぶ側はログイン中の役割が admin / staff であることを確かめてから使う。
// 例外その16（2026-11-27・docs/autumn-live.md §4）: Autumn Live の入場の口（lib/server/live-session.ts・POST /live/session）。
//   端末の表 book.live_devices / live_device_codes と book.live_device_* は service_role だけに grant している。
//   端末の Ed25519 の署名・時刻を確かめた後に触る。業務 PC は Bearer の access_token を auth.getUser(jwt) で確かめ、admin / staff・停止なしのときだけ通す。
//   人の流れ（routes/api/live/beacon・book.live_beacon）と Live の画面のデータ（routes/live/api/snapshot・book.live_snapshot_*）も同じ例外。
//   信号は同意・Origin・運営・ボット・回数を確かめてから記録し、画面のデータは入場券（/live の関所）を確かめてから読む。
// 例外その17（2026-11-27・docs/private-book.md）: プライベートブック（公式サイトの中の特別料金・lib/server/private-book.ts）。
//   検証済みの会員セッションの id で rms_member_pages_for / rms_member_page_access を引き、そのページを今使えると確かめてから
//   専用ページの料金・施設設定を読み、特別会員の束（create_member_page_hold_group・RPC でも対象者を確かめる）を作る。クッキーは信じない。
const previewCache = new Map<string, SupabaseClient>();

/** プレビュー中のプラン 1 つを販売中と同じに扱わせる service_role クライアント（鍵が無ければ null） */
export function previewServiceClient(ratePlanId: string): SupabaseClient | null {
	const base = partnerServiceClient();
	if (!base) return null;
	const serviceRoleKey = privateEnv.SUPABASE_SERVICE_ROLE_KEY!.trim();
	const supabaseUrl = (privateEnv.SUPABASE_URL || publicEnv.PUBLIC_SUPABASE_URL)!.trim();
	const key = `${supabaseUrl}|${serviceRoleKey}|${ratePlanId}`;
	const hit = previewCache.get(key);
	if (hit) return hit;
	const client = createClient(supabaseUrl, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		global: { headers: { 'x-book-preview-plan': ratePlanId } }
	});
	// プランの数だけ増えるので、ある程度で捨てる
	if (previewCache.size > 50) previewCache.clear();
	previewCache.set(key, client);
	return client;
}
