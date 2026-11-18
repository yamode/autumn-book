// 客室・プランの翻訳（book.content_translations）の型。管理画面の画面とサーバで共有する（2026-11-18）
import type { ContentSection, ContentSpec } from '$lib/content-blocks';

export type TranslationEntity = 'plan' | 'room_type';
export type TranslationLocale = 'en' | 'zh-TW';
export const TRANSLATION_LOCALES: readonly TranslationLocale[] = ['en', 'zh-TW'];

/** 翻訳の元になる日本語（編集画面で項目ごとに並べて見せる） */
export interface TranslationSource {
	name: string;
	headline: string;
	description: string;
	tags: string[];
	amenities: string[];
	specs: ContentSpec[];
	sections: ContentSection[];
	photoCaptions: string[];
}

export interface TranslationRow {
	fields: Record<string, unknown>;
	isPublished: boolean;
	updatedAt: string | null;
}

export type TranslationSet = Record<TranslationLocale, TranslationRow | null>;

