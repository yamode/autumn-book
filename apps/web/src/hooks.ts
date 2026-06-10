import { deLocalizeUrl } from '$lib/paraglide/runtime';
import type { Reroute } from '@sveltejs/kit';

// ロケールプレフィックス（/en/... / /zh-TW/...）をカノニカルパスに変換する
// SvelteKit のルートファイルはプレフィックスなしのまま（設計書 §1.1）
export const reroute: Reroute = ({ url }) => {
	return deLocalizeUrl(url).pathname;
};
