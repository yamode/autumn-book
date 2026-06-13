import type { SessionUser } from '$lib/server/session';

/** 同一ブランド内の他施設（施設間移動リンク用） */
export interface SiblingFacility {
	slug: string;
	name: string;
	brandSlug: string;
}

/** 施設シェル（ヘッダー/フッター）に渡す最小情報 */
export interface ShellFacility {
	template: 'standard' | 'yamado-v1' | 'oga-v1';
	name: string;
	slug: string;
	brandSlug: string;
	phone: string;
	addressPublic: string;
	/** ブランド表示名（ポータル導線のラベル用） */
	brandName: string;
	/** 同一ブランドの他施設（施設間移動リンク用・自施設は除く） */
	siblings: SiblingFacility[];
}

export type ShellUser = SessionUser | null;
