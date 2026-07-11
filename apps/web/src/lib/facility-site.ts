// 各施設の「独立した公式サイト」URL。
// ポータル（autumn-book）は予約導線に専念し、施設サイトの再描画はしない方針のため、
// 「施設サイト」リンクは外部の独立サイトへ遷移させる（新規タブ推奨）。
// 山人業務に特化（汎用化しない）— 既知の2施設を slug でマッピングする。
export function facilitySiteUrl(f: { slug: string; brandSlug?: string }): string {
	switch (f.slug) {
		case 'oga':
			return 'https://oga.yamado.co.jp';
		case 'nishiwaga':
		default:
			return 'https://yamado.co.jp';
	}
}
