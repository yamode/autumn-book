// バージョン表記のずれを防ぐテスト。`pnpm --filter @autumn-book/web test`
// 管理画面の表示（$lib/version の APP_VERSION）はモノレポルートの package.json から来る（vite.config.ts の define）。
// apps/web/package.json だけ上げてルートを忘れると表示が古いまま残る（2026-09-27 に v0.47.1 のまま止まっていた）ため、両方が同じかを確かめる。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const versionOf = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')).version as string;

describe('バージョン', () => {
	it('ルートと apps/web の package.json のバージョンが同じ', () => {
		expect(versionOf('../../package.json')).toBe(versionOf('../../../../package.json'));
	});
});
