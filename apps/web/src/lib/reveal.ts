// 操作の結果（保存しました・削除しました・エラー）を画面に入れる Svelte アクション（2026-11-18 指示）。
// 結果のお知らせがページ上部にあり、押したボタンが下の方にあると、スマホでは結果が見えなかった。
// 表示されたとき画面の外にあれば、そこまでスクロールする（画面内なら何もしない）。
// 使い方: <p use:reveal role="status">保存しました</p>
// ボタンのすぐ近くに置ける結果は、こちらではなくボタンの横・下に置く（プロフィール・ログイン設定など）。
export function reveal(node: HTMLElement): void {
	if (typeof window === 'undefined') return;
	requestAnimationFrame(() => {
		const rect = node.getBoundingClientRect();
		// 上はヘッダー（固定・約 5rem）に隠れる分を見込む
		const hiddenAbove = rect.top < 80;
		const hiddenBelow = rect.bottom > window.innerHeight;
		if (!hiddenAbove && !hiddenBelow) return;
		const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		node.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
	});
}
