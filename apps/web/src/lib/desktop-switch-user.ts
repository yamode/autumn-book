// デスクトップアプリ（autumn-pms desktop）で開いているときの「ユーザーの切り替え」。
// デスクトップではログアウトのボタンは出さず、代わりに「ユーザーを切り替え」だけを出す方針（2026-10-31 指示）。
// ログインは PMS・RMS・Order・Book で共有なので、確認ダイアログのあと全アプリをログアウトして
// ログイン画面へ戻す（シェルの tabs:switchUser）。ブラウザでは何も変わらない（従来どおり「ログアウト」）。

type DesktopBridge = { tabs?: { switchUser?: () => Promise<boolean> } };

function bridge(): DesktopBridge | null {
	if (typeof window === 'undefined') return null;
	return (window as unknown as { autumnDesktop?: DesktopBridge }).autumnDesktop ?? null;
}

/** デスクトップアプリの中か（ログアウトのボタンを「ユーザーを切り替え」に差し替えるか）。 */
export function inDesktopApp(): boolean {
	return bridge() !== null;
}

/**
 * シェルに切り替えを頼む。旧シェル（switchUser が無い版）は false を返すので、
 * 呼び出し側は従来の /logout の POST にフォールバックする。
 */
export async function switchUserInDesktop(): Promise<boolean> {
	const fn = bridge()?.tabs?.switchUser;
	if (typeof fn !== 'function') return false;
	try {
		await fn();
		return true;
	} catch {
		return false;
	}
}
