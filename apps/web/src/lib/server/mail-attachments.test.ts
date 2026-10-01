// メールの添付（Cloudflare Email Sending REST の attachments）の組み立てのテスト。
import { describe, expect, it } from 'vitest';
import { buildRestAttachments, bytesToBase64, fitsAttachmentLimit, MAX_ATTACHMENT_TOTAL_BYTES } from './mail-attachments';

const enc = (s: string) => new TextEncoder().encode(s);

describe('bytesToBase64', () => {
  it('Buffer と同じ結果', () => {
    const bytes = enc('請求書 PDF %PDF-1.7');
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
  it('大きなバイト列（小分けの境界を跨ぐ）', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});

describe('buildRestAttachments', () => {
  it('空なら何も付けない', () => {
    expect(buildRestAttachments(undefined)).toEqual({});
    expect(buildRestAttachments([])).toEqual({});
  });

  it('REST の形（content=base64・disposition=attachment）', () => {
    const r = buildRestAttachments([{ filename: '請求書_PI-202610-00001.pdf', type: 'application/pdf', content: enc('abc') }]);
    expect(r.error).toBeUndefined();
    expect(r.attachments).toEqual([{ content: 'YWJj', filename: '請求書_PI-202610-00001.pdf', type: 'application/pdf', disposition: 'attachment' }]);
  });

  it('ファイル名から改行・引用符・パス区切りを除く', () => {
    const r = buildRestAttachments([{ filename: 'a"b\r\nc/d\\e.pdf', type: '', content: enc('x') }]);
    expect(r.attachments?.[0].filename).toBe('abcde.pdf');
    expect(r.attachments?.[0].type).toBe('application/octet-stream');
  });

  it('合計 5MiB を超えると error', () => {
    const big = new Uint8Array(MAX_ATTACHMENT_TOTAL_BYTES - 10);
    const list = [
      { filename: 'a.pdf', type: 'application/pdf', content: big },
      { filename: 'b.pdf', type: 'application/pdf', content: new Uint8Array(11) }
    ];
    expect(fitsAttachmentLimit(list)).toBe(false);
    expect(buildRestAttachments(list).error).toMatch(/attachments-too-large/);
    expect(fitsAttachmentLimit(list.slice(0, 1))).toBe(true);
  });
});
