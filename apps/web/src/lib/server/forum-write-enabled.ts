// コミュニティ書き込み導線のゲート。
//
// DATA_SOURCE=supabase では公開側の読み取りは book スキーマの実データを使うが、
// 書き込み系 RPC（forum_create_thread / forum_create_post / forum_set_nickname 等）は
// auth.uid() を必須とする一方、Web の会員認証は現状 demo cookie のままで Supabase Auth に
// 未接続（= P5 計画）。よって supabase モードでは Web からの投稿は構造的に不可能なため、
// 書き込み導線を隠してアプリ（YAMADO ONE）へ誘導する。
//
// DATA_SOURCE=demo（現状の既定）では従来どおり Web から投稿できる。
//
// P5 で Supabase Auth（@supabase/ssr の cookie 連携）を接続したら、
// ここの条件を「supabase かつ 会員ログイン済み」を許可する形へ差し替える。
import { DATA_SOURCE } from '$lib/server/supabase';

export const FORUM_WRITE_ENABLED: boolean = DATA_SOURCE !== 'supabase';
