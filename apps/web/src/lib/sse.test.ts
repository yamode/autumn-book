// AI 下書きのリアルタイム表示で使う SSE の読み取り（区切りが途中で切れても・日本語が途中で割れても読める）
import { describe, expect, it } from 'vitest';
import { readSseJson, sseData, sseLine } from './sse';

function streamOf(chunks: Uint8Array[]) {
	return new ReadableStream<Uint8Array>({
		start(c) {
			for (const ch of chunks) c.enqueue(ch);
			c.close();
		}
	});
}

describe('readSseJson', () => {
	it('届いた順に読み、区切りやマルチバイト文字が途中で割れても読める', async () => {
		const bytes = new TextEncoder().encode(sseLine({ type: 'delta', append: 'お客様' }) + sseLine({ type: 'done', message: '保存しました' }));
		const chunks = [bytes.slice(0, 20), bytes.slice(20, 31), bytes.slice(31)]; // 「お」の途中・区切りの途中で割る
		const got: Record<string, unknown>[] = [];
		await readSseJson(streamOf(chunks), (ev) => got.push(ev));
		expect(got).toEqual([{ type: 'delta', append: 'お客様' }, { type: 'done', message: '保存しました' }]);
	});
	it('読めない行は飛ばし、最後に区切りが無くても読む', async () => {
		const got: Record<string, unknown>[] = [];
		await readSseJson(streamOf([new TextEncoder().encode(': ping\n\ndata: not json\n\ndata: {"type":"stage","stage":"writing"}')]), (ev) => got.push(ev));
		expect(got).toEqual([{ type: 'stage', stage: 'writing' }]);
	});
	it('onEvent が投げた例外はそのまま外へ出る（error を受けて止める）', async () => {
		await expect(readSseJson(streamOf([new TextEncoder().encode(sseLine({ type: 'error' }))]), () => { throw new Error('止める'); })).rejects.toThrow('止める');
	});
});

describe('sseData', () => {
	it('data: の行だけをつなぐ', () => expect(sseData('event: x\r\ndata: a\r\ndata: b')).toBe('a\nb'));
});
