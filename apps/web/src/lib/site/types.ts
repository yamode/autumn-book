import type { SessionUser } from '$lib/server/session';

/** 施設シェル（ヘッダー/フッター）に渡す最小情報 */
export interface ShellFacility {
	template: 'standard' | 'yamado-v1' | 'oga-v1';
	name: string;
	slug: string;
	brandSlug: string;
	phone: string;
	addressPublic: string;
}

export type ShellUser = SessionUser | null;
