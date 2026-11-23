// 会員のアバター画像の URL は、自分たちの Supabase Storage の avatars バケットのものだけ出す
// （2026-11-23 セキュリティレビュー M-9）。外部の URL を出すと、掲示板を見た人の IP・UA が
// その外部サーバへ渡る（追跡用の画像にされる）。DB の book.set_my_avatar でも同じ形に限っている。
import { env as publicEnv } from '$env/dynamic/public';

export function avatarUrlPrefix(base = publicEnv.PUBLIC_SUPABASE_URL ?? ''): string | null {
	const b = base.replace(/\/+$/, '');
	return b ? `${b}/storage/v1/object/public/avatars/` : null;
}

/** 自分たちの avatars バケットの URL ならそのまま、そうでなければ null */
export function ownAvatarUrl(url: string | null | undefined, base?: string): string | null {
	const prefix = avatarUrlPrefix(base);
	if (!url || !prefix || !url.startsWith(prefix)) return null;
	const rest = url.slice(prefix.length);
	// <会員の uuid>/<ファイル名>[?v=数字]
	return /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,100}(\?v=\d{1,20})?$/i.test(rest) ? url : null;
}
