// 管理画面のフォームを「変えたらすぐ保存」にする use:autosave（2026-11-27 指示「事前チェックインの設定を自動保存にする」）。
//
// - 欄の change（チェック・選択は即時、文字の欄は欄を離れたとき）で送る。数の欄の ▲▼ は 0.6 秒まとめて、欄を離れたら即時。
// - 送信中に次の変更が来たら、終わってからもう一度送る（同時に 2 本送らない。質問の新規追加が二重にならないように）。
// - レイアウトの離脱ガード（未保存の確認）の対象から外す（data-no-guard）。保存は欄を離れた時点で始まるため。
// - 送信は $lib/enhance を通すので、保存ボタン（あれば）の「保存中… → ✓ 保存しました」もそのまま出る。
// - 画面側から「今の内容で保存して」と頼むときは form.dispatchEvent(new Event('change')) を投げる（requestAutosave）。
import { tick } from 'svelte';
import type { SubmitFunction } from '@sveltejs/kit';
import { enhance } from './enhance';

export function requestAutosave(form: HTMLFormElement | null | undefined): void {
	form?.dispatchEvent(new Event('change'));
}

export function autosave(form: HTMLFormElement, submit: SubmitFunction = () => {}) {
	form.dataset.noGuard = '';
	let busy = false;
	let again = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const fire = () => {
		clearTimeout(timer);
		timer = undefined;
		if (!form.isConnected) return;
		if (busy) {
			again = true;
			return;
		}
		form.requestSubmit();
	};
	const onChange = (e: Event) => {
		const t = e.target;
		if (t instanceof HTMLInputElement && t.type === 'number' && document.activeElement === t) {
			clearTimeout(timer);
			timer = setTimeout(fire, 600);
			return;
		}
		fire();
	};
	const onFocusOut = () => {
		if (timer) fire();
	};
	form.addEventListener('change', onChange);
	form.addEventListener('focusout', onFocusOut);

	const kit = enhance(form, async (input) => {
		const after = await submit(input);
		busy = true;
		return async (opts) => {
			try {
				if (typeof after === 'function') await after(opts);
				else await opts.update();
			} finally {
				busy = false;
				if (again) {
					again = false;
					await tick();
					fire();
				}
			}
		};
	});

	return {
		destroy() {
			clearTimeout(timer);
			form.removeEventListener('change', onChange);
			form.removeEventListener('focusout', onFocusOut);
			kit.destroy();
		}
	};
}
