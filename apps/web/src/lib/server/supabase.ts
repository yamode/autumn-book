// Supabase クライアント（サーバー側・anon キー）
// DATA_SOURCE=supabase のとき supabase-data.ts が使用する。
// 会員操作（P5）は @supabase/ssr による cookie ベースの Auth クライアントに拡張する。
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

export const DATA_SOURCE: 'demo' | 'supabase' = env.DATA_SOURCE === 'supabase' ? 'supabase' : 'demo';

let client: SupabaseClient | null = null;

export function supa(): SupabaseClient {
	if (!client) {
		const url = env.PUBLIC_SUPABASE_URL;
		const key = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
		if (!url || !key) throw new Error('PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_PUBLISHABLE_KEY が未設定です');
		client = createClient(url, key, {
			auth: { persistSession: false, autoRefreshToken: false },
			db: { schema: 'book' }
		});
	}
	return client;
}
