// Server-Sent Events の読み取り（ブラウザ・Cloudflare のどちらでも動く）。
// AI 下書きの作り直しをリアルタイムに見せるのに使う（2026-11-22）。data: の中身を1件ずつ JSON にして渡す。

/** SSE のかたまり（空行で区切られた1件）から data: の中身を取り出す */
export function sseData(block: string): string {
	return block
		.split(/\r?\n/)
		.filter((l) => l.startsWith('data:'))
		.map((l) => l.slice(5).replace(/^ /, ''))
		.join('\n');
}

/** 本文を最後まで読み、届いた順に onEvent を呼ぶ。onEvent が投げた例外はそのまま外へ出る */
export async function readSseJson(body: ReadableStream<Uint8Array>, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	const flush = (block: string) => {
		const data = sseData(block);
		if (!data) return;
		let event: unknown;
		try {
			event = JSON.parse(data);
		} catch {
			return; // 読めない行は飛ばす
		}
		if (event && typeof event === 'object') onEvent(event as Record<string, unknown>);
	};
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			let m: RegExpExecArray | null;
			while ((m = /\r?\n\r?\n/.exec(buf))) {
				flush(buf.slice(0, m.index));
				buf = buf.slice(m.index + m[0].length);
			}
		}
		buf += decoder.decode();
		if (buf.trim()) flush(buf);
	} finally {
		reader.releaseLock();
	}
}

/** SSE の1件を書く */
export function sseLine(event: Record<string, unknown>): string {
	return 'data: ' + JSON.stringify(event) + '\n\n';
}
