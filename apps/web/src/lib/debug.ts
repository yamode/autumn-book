// 全社デバッグ方針（CLAUDE.md）: DEBUG フラグ + dbg() + デバッグパネル。リリース時は false に変えるだけ
import { writable } from 'svelte/store';

export const DEBUG = true;

export const debugLines = writable<string[]>([]);

export function dbg(...args: unknown[]) {
	if (!DEBUG) return;
	const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
	console.log('[DBG]', line);
	debugLines.update((lines) => [...lines.slice(-100), `${new Date().toLocaleTimeString('ja-JP')} ${line}`]);
}
