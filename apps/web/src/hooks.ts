import '$lib/locale-strategy'; // 言語の持ち越し戦略を getLocale() より前に登録する
import { deLocalizeUrl } from '$lib/paraglide/runtime';
import type { Reroute } from '@sveltejs/kit';

// ロケールプレフィックス（/en/... / /zh-TW/...）をカノニカルパスに変換する
// SvelteKit のルートファイルはプレフィックスなしのまま（設計書 §1.1）
export const reroute: Reroute = ({ url }) => {
	return deLocalizeUrl(url).pathname;
};
