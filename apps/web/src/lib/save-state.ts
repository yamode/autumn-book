// 管理画面の保存ボタンの中で「保存中… → ✓ 保存しました」を見せる（2026-10-18 指示
// 「保存バナーの表示位置が離れていると保存状態がわからない。保存ボタンの中で状態遷移を完結させられないか」）。
//
// $lib/enhance がフォームを送るたびに呼ぶ。ボタンの中身（Svelte が管理している文字やアイコン）には触らず、
// data-save-state と data-save-label を付けるだけ。見た目は管理画面のレイアウトの CSS が切り替える
// （元の文字を隠し、::after で data-save-label を出す）。中身を書き換えると Svelte の表示が壊れるため。
//
// 効かせるのは管理画面（.admin-main の中）だけ。お客様の画面は多言語なので触らない。
// 外したいフォームは <form data-no-save-state>、ボタンは <button data-no-save-state>。

export type SaveState = 'saving' | 'done' | 'error';

const VERBS = ['保存', '追加', '削除', '返金', '送信', '発行', '更新', '変更', '反映', '登録', '取り下げ', '失効', '取消', '作成'] as const;

/** ボタンの文字から、状態ごとの言葉を作る（「保存」→「保存中…」「✓ 保存しました」） */
export function saveStateLabel(buttonText: string, state: SaveState): string {
	const verb = VERBS.find((v) => buttonText.includes(v));
	if (state === 'saving') return verb ? `${verb}中…` : '処理中…';
	if (state === 'done') return verb ? `✓ ${verb}しました` : '✓ 完了しました';
	return verb ? `${verb}できませんでした` : 'できませんでした';
}

/** 送ったボタン（無ければフォームの最初の送信ボタン）。対象外なら null */
export function saveStateButton(form: HTMLFormElement, submitter: HTMLElement | null): HTMLButtonElement | null {
	if (!form.closest('.admin-main') || form.hasAttribute('data-no-save-state')) return null;
	const btn =
		submitter instanceof HTMLButtonElement
			? submitter
			: form.querySelector<HTMLButtonElement>('button[type="submit"], button:not([type])');
	if (!btn || btn.hasAttribute('data-no-save-state')) return null;
	return btn;
}

const timers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>();

/** ボタンの状態を付ける（null で外す）。done / error は少しして自動で外す */
export function setSaveState(btn: HTMLButtonElement, state: SaveState | null, text: string): void {
	const t = timers.get(btn);
	if (t) clearTimeout(t);
	if (!state) {
		btn.removeAttribute('data-save-state');
		btn.removeAttribute('data-save-label');
		btn.removeAttribute('aria-busy');
		return;
	}
	btn.setAttribute('data-save-state', state);
	btn.setAttribute('data-save-label', saveStateLabel(text, state));
	if (state === 'saving') btn.setAttribute('aria-busy', 'true');
	else btn.removeAttribute('aria-busy');
	if (state !== 'saving') {
		timers.set(
			btn,
			setTimeout(() => setSaveState(btn, null, text), state === 'done' ? 2000 : 3500)
		);
	}
}
