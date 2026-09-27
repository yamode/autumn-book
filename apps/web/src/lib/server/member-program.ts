// 会員制度の設定（入会ボーナス）。DB: autumn-shared 20260927001351（book.member_program_settings）。
//   公開側: welcomeBonusPoints() … 登録画面の「入会で ○pt」表示用（anon で読める。読めなければ従来の 500）
//   管理画面: sbAdminMemberProgram / sbSaveMemberProgram（ログイン中スタッフの権限で RPC）
import type { SupabaseClient } from '@supabase/supabase-js';
import { DATA_SOURCE, supa } from './supabase';

/** 設定が無い・読めないときの入会ボーナス（従来の直書き値） */
export const DEFAULT_WELCOME_BONUS = 500;

export async function welcomeBonusPoints(): Promise<number> {
  if (DATA_SOURCE !== 'supabase') return DEFAULT_WELCOME_BONUS;
  try {
    // 現状シングルテナント（book._admin_tenant と同じく最初の1行）
    const { data, error } = await supa().from('member_program_settings').select('welcome_bonus_points').limit(1).maybeSingle();
    if (error || !data) return DEFAULT_WELCOME_BONUS;
    return Math.max(0, Number(data.welcome_bonus_points) || 0);
  } catch {
    return DEFAULT_WELCOME_BONUS;
  }
}

export type MemberProgram = {
  welcomeBonusPoints: number;
  welcomeBonusValidDays: number;
  updatedAt: string | null;
  grantedTotal: number;
  granted30d: number;
};

export async function sbAdminMemberProgram(client: SupabaseClient): Promise<MemberProgram> {
  const { data, error } = await client.schema('book').rpc('admin_member_program');
  if (error) {
    if (error.message.includes('Could not find the function')) throw new Error('DB の更新（autumn-shared 20260927001351）がまだ適用されていません。');
    throw new Error(`入会ボーナスの設定を読み込めませんでした（${error.message}）`);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    welcomeBonusPoints: Number(d.welcome_bonus_points ?? DEFAULT_WELCOME_BONUS),
    welcomeBonusValidDays: Number(d.welcome_bonus_valid_days ?? 365),
    updatedAt: (d.updated_at as string | null) ?? null,
    grantedTotal: Number(d.granted_total ?? 0),
    granted30d: Number(d.granted_30d ?? 0)
  };
}

export async function sbSaveMemberProgram(client: SupabaseClient, points: number, validDays: number): Promise<void> {
  const { error } = await client.schema('book').rpc('admin_save_member_program', {
    p_welcome_bonus_points: points,
    p_welcome_bonus_valid_days: validDays
  });
  if (error) {
    if (error.message.includes('forbidden')) throw new Error('入会ボーナスの設定は管理者だけが変更できます。');
    if (error.message.includes('invalid_params')) throw new Error('ポイントは 0〜100,000、有効期限は 1〜3,650 日で入れてください。');
    throw new Error(`入会ボーナスの設定を保存できませんでした（${error.message}）`);
  }
}
