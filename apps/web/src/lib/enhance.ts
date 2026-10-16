// アプリ共通の use:enhance（2026-10-17 指示「保存すると全体のフィールドがいちど空になったように見える挙動をなくして」）。
//
// SvelteKit の enhance は、送信が成功すると既定で form.reset() を呼ぶ。Svelte が値を入れた欄（value={...}・checked={...}）は
// HTML の初期値を持たないため、リセットで一度空（チェックは外れる）になり、読み直したデータが入るまでの間ちらつく。
// ここでは既定を「リセットしない」にする。新しく追加するフォーム（送ったら空に戻したいもの）は <form data-reset> を付ける。
// 呼び出し側の書き方（use:enhance / use:enhance={submit} / コールバック内の update(...)）はそのまま使える。
import { enhance as kitEnhance } from '$app/forms';
import type { SubmitFunction } from '@sveltejs/kit';

type Opts = Parameters<Exclude<Awaited<ReturnType<SubmitFunction>>, void>>[0];

export function enhance(form: HTMLFormElement, submit: SubmitFunction = () => {}) {
	const resetByDefault = form.hasAttribute('data-reset');
	return kitEnhance(form, async (input) => {
		const after = await submit(input);
		return async (opts: Opts) => {
			const update: Opts['update'] = (o) => opts.update({ reset: resetByDefault, ...o });
			if (typeof after === 'function') return after({ ...opts, update });
			return update();
		};
	});
}
