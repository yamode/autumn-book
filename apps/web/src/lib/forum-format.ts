// コミュニティ掲示板 本文整形（pure・サーバ/クライアント共用）。
// 設計書 §4 / §7: plain text のみ。Markdown 不採用。
// renderForumBody は必ず「HTML エスケープ → >>n リンク化 → URL 自動リンク → 改行 <br>」の順で処理する。
// {@html} に渡してよいのは renderForumBody の出力のみ（エスケープを最初に行うことで XSS を防ぐ）。

/** 生テキスト本文から最初の >>n（1〜9999）を抽出する。なければ null。 */
export function extractReplyTo(body: string): number | null {
	const match = body.match(/>>(\d{1,4})/);
	if (!match) return null;
	const n = Number(match[1]);
	if (n < 1 || n > 9999) return null;
	return n;
}

const ANCHOR_RE = /&gt;&gt;(\d{1,4})/g;
// エスケープ後の本文に対して URL を拾う。クエリの & は &amp; になっているため許容しつつ、
// それ以外のエンティティ（&lt; &gt; &quot; &#39;）で URL を打ち切る。
// （&gt; を巻き込むと後段の >>n 置換が <a> の属性内で起き、表示が崩れるため）
const URL_RE = /https?:\/\/(?:&amp;|[^\s&])+/g;

/** HTML エスケープ（& < > " '）。最初に必ず行う。 */
function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * 本文を表示用 HTML に整形する。
 * 1) HTML エスケープ（& < > " '）
 * 2) >>n → <a href="#post-n">&gt;&gt;n</a>
 * 3) https?:// URL → <a href rel="nofollow noopener ugc" target="_blank">（表示は60字で省略）
 * 4) 改行 → <br>
 */
export function renderForumBody(body: string): string {
	// 1) エスケープ（>> は &gt;&gt; になる）
	let html = escapeHtml(body);

	// 3) 先に URL を自動リンク化する（>>n のアンカー置換で挿入する <a> と干渉しないよう URL を先に）。
	//    URL 内の表示は60字で省略。href には実 URL（エスケープ済み文字列）を使う。
	html = html.replace(URL_RE, (url) => {
		// エスケープ済み文字列なので &amp; を & に戻して href に使う（属性内なので &amp; のままで安全に出せる）
		const href = url; // 既にエスケープ済み（&amp; など）。属性値として安全。
		const display = url.length > 60 ? url.slice(0, 60) + '…' : url;
		return `<a href="${href}" rel="nofollow noopener ugc" target="_blank" class="text-accent-600 underline break-all">${display}</a>`;
	});

	// 2) >>n を同一スレ内アンカーへ（URL 化された <a href="...">https://...&gt;&gt;...</a> は
	//    href 内に >> を含まないため、ここでの置換対象にならない）。
	html = html.replace(ANCHOR_RE, (_full, n: string) => {
		const num = Number(n);
		if (num < 1 || num > 9999) return `&gt;&gt;${n}`;
		return `<a href="#post-${num}" class="text-accent-600 hover:underline">&gt;&gt;${num}</a>`;
	});

	// 4) 改行
	html = html.replace(/\r?\n/g, '<br>');

	return html;
}
