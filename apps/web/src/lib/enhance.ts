// アプリ共通の use:enhance（2026-10-17 指示「保存すると全体のフィールドがいちど空になったように見える挙動をなくして」）。
//
// SvelteKit の enhance は、送信が成功すると既定で form.reset() を呼ぶ。Svelte が値を入れた欄（value={...}・checked={...}）は
// HTML の初期値を持たないため、リセットで一度空（チェックは外れる）になり、読み直したデータが入るまでの間ちらつく。
// ここでは既定を「リセットしない」にする。新しく追加するフォーム（送ったら空に戻したいもの）は <form data-reset> を付ける。
// 呼び出し側の書き方（use:enhance / use:enhance={submit} / コールバック内の update(...)）はそのまま使える。
//
// 2026-10-18: 管理画面では、押したボタンの中で「保存中… → ✓ 保存しました」を見せる（$lib/save-state.ts）。
import { enhance as kitEnhance } from '$app/forms';
import type { SubmitFunction } from '@sveltejs/kit';
import { saveStateButton, setSaveState } from './save-state';

type Opts = Parameters<Exclude<Awaited<ReturnType<SubmitFunction>>, void>>[0];

export function enhance(form: HTMLFormElement, submit: SubmitFunction = () => {}) {
	const resetByDefault = form.hasAttribute('data-reset');
	return kitEnhance(form, async (input) => {
		const btn = saveStateButton(form, input.submitter as HTMLElement | null);
		const label = btn?.textContent?.trim() ?? '';
		let cancelled = false;
		const after = await submit({
			...input,
			cancel: () => {
				cancelled = true;
				input.cancel();
			}
		});
		if (btn && !cancelled) setSaveState(btn, 'saving', label);
		return async (opts: Opts) => {
			const update: Opts['update'] = (o) => opts.update({ reset: resetByDefault, ...o });
			try {
				if (typeof after === 'function') await after({ ...opts, update });
				else await update();
			} finally {
				if (btn && btn.isConnected) {
					const ok = opts.result.type === 'success' || opts.result.type === 'redirect';
					setSaveState(btn, ok ? 'done' : 'error', label);
				}
			}
		};
	});
}
