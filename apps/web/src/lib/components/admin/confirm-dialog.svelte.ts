// 管理画面共通の確認ダイアログ。ブラウザ標準の confirm() の代わりに使う（見た目と文言をそろえる）。
// 画面には管理画面レイアウトに置いた <ConfirmDialog /> が1つだけ出る。
//
//   if (!(await askConfirm({ message: '…を削除します', confirmLabel: '削除する' }))) return;

export type ConfirmRequest = {
	message: string;
	/** 確定ボタンの文言（何が起きるかを動詞で。既定は「実行する」） */
	confirmLabel?: string;
	/** 取り消せない・お客様に影響する操作は true（赤いボタン） */
	danger?: boolean;
};

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

export const confirmState = $state<{ current: Pending | null }>({ current: null });

export function askConfirm(req: ConfirmRequest): Promise<boolean> {
	// 前の確認が開いたままなら「戻る」扱いで閉じる
	confirmState.current?.resolve(false);
	return new Promise((resolve) => {
		confirmState.current = { danger: true, ...req, resolve };
	});
}

export function settleConfirm(ok: boolean) {
	const c = confirmState.current;
	confirmState.current = null;
	c?.resolve(ok);
}

/**
 * submit ボタンの onclick 用。確認できたら同じボタンでフォームを送る（formaction なども保たれる）。
 * requestSubmit は click を発火しないので、ここに戻ってきて二重に確認することはない。
 *   <button type="submit" onclick={confirmSubmit({ message: '…' })}>削除</button>
 */
export function confirmSubmit(req: ConfirmRequest) {
	return async (e: MouseEvent) => {
		const btn = e.currentTarget as HTMLButtonElement;
		e.preventDefault();
		if (await askConfirm(req)) btn.form?.requestSubmit(btn);
	};
}
