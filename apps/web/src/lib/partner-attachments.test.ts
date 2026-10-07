import { describe, expect, it } from 'vitest';
import {
  attachmentChangeOf,
  attachmentLine,
  attachmentPolicyOf,
  attachmentsFlagOn,
  attachmentTypeOf,
  checkAttachmentFile,
  formatAttachmentSize,
  isInlineAttachment,
  MAX_ATTACHMENT_BYTES,
  parseAttachmentIds,
  partnerCanDeleteAttachment,
  PARTNER_ATTACHMENT_ACCEPT,
  safeAttachmentName
} from './partner-attachments';

const none = { count: 0, bytes: 0 };
const MB = 1024 * 1024;

describe('attachmentTypeOf', () => {
  it('許可リストの拡張子は種類を返す（大文字も可）', () => {
    expect(attachmentTypeOf('名簿.xlsx')?.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(attachmentTypeOf('行程表.PDF')).toEqual({ ext: 'pdf', mime: 'application/pdf' });
    expect(attachmentTypeOf('photo.jpeg')?.mime).toBe('image/jpeg');
  });
  it('zip・html・svg・xml・実行形式・マクロ付き Office は断る', () => {
    for (const n of ['a.zip', 'a.html', 'a.htm', 'a.svg', 'a.xml', 'a.exe', 'a.xlsm', 'a.docm', 'a', 'a.']) {
      expect(attachmentTypeOf(n)).toBeNull();
    }
  });
  it('accept に zip が無い', () => {
    expect(PARTNER_ATTACHMENT_ACCEPT).toContain('.pdf');
    expect(PARTNER_ATTACHMENT_ACCEPT).not.toContain('.zip');
  });
});

describe('checkAttachmentFile', () => {
  it('pdf・xlsx・jpg は通る', () => {
    expect(checkAttachmentFile({ name: '名簿.xlsx', size: 48213 }, none)).toMatchObject({ ok: true, ext: 'xlsx' });
    expect(checkAttachmentFile({ name: 'a.pdf', size: 1 }, none).ok).toBe(true);
    expect(checkAttachmentFile({ name: 'a.jpg', size: MAX_ATTACHMENT_BYTES }, none).ok).toBe(true);
  });
  it('空・種類・サイズ・件数・合計の順で断る', () => {
    expect(checkAttachmentFile({ name: 'a.pdf', size: 0 }, none)).toMatchObject({ ok: false, message: expect.stringContaining('空') });
    expect(checkAttachmentFile({ name: 'a.zip', size: 10 }, none)).toMatchObject({ ok: false, message: expect.stringContaining('種類') });
    expect(checkAttachmentFile({ name: 'a.pdf', size: 21 * MB }, none)).toMatchObject({ ok: false, message: expect.stringContaining('20MB') });
    expect(checkAttachmentFile({ name: 'a.pdf', size: 10 }, { count: 10, bytes: 10 })).toMatchObject({ ok: false, message: expect.stringContaining('10件') });
    expect(checkAttachmentFile({ name: 'a.pdf', size: 11 * MB }, { count: 3, bytes: 40 * MB })).toMatchObject({ ok: false, message: expect.stringContaining('50MB') });
  });
  it('9件目までの合計 50MB ちょうどは通る', () => {
    expect(checkAttachmentFile({ name: 'a.pdf', size: 10 * MB }, { count: 9, bytes: 40 * MB }).ok).toBe(true);
  });
  it('ファイル名のパス区切り・制御文字を除く', () => {
    const r = checkAttachmentFile({ name: '../x\\y\u0001.pdf', size: 5 }, none);
    expect(r.ok && r.fileName).toBe('.._x_y_.pdf');
  });
});

describe('safeAttachmentName', () => {
  it('120文字に切り（拡張子を残すため後ろから）、空なら file', () => {
    expect(safeAttachmentName(`${'あ'.repeat(200)}.pdf`)).toHaveLength(120);
    expect(safeAttachmentName(`${'あ'.repeat(200)}.pdf`).endsWith('.pdf')).toBe(true);
    expect(safeAttachmentName('   ')).toBe('file');
  });
});

describe('attachmentPolicyOf', () => {
  const today = '2026-10-07';
  it('確定・支払待ちは追加・削除できる（チェックイン済みも）', () => {
    expect(attachmentPolicyOf({ status: 'confirmed', check_out_date: '2026-10-10' }, today)).toMatchObject({ canAdd: true, canDelete: true });
    expect(attachmentPolicyOf({ status: 'pending_payment', check_out_date: '2026-10-10' }, today)).toMatchObject({ canAdd: true, canDelete: true });
  });
  it('チェックアウトから 90 日まで。過ぎたら追加も削除もできない', () => {
    expect(attachmentPolicyOf({ status: 'confirmed', check_out_date: '2026-07-09' }, today).canAdd).toBe(true);
    const late = attachmentPolicyOf({ status: 'confirmed', check_out_date: '2026-07-08' }, today);
    expect(late).toMatchObject({ canAdd: false, canDelete: false });
    expect(late.note).toContain('90日');
  });
  it('取消済みは削除だけ・期限切れはどちらもできない', () => {
    expect(attachmentPolicyOf({ status: 'cancelled', check_out_date: '2026-10-10' }, today)).toMatchObject({ canAdd: false, canDelete: true });
    expect(attachmentPolicyOf({ status: 'expired', check_out_date: '2026-10-10' }, today)).toMatchObject({ canAdd: false, canDelete: false });
  });
});

describe('partnerCanDeleteAttachment', () => {
  const mine = { uploaded_by_kind: 'partner', uploaded_by_account: 'a1' };
  it('自分が上げたものは消せる。他の子アカウントのものは消せない', () => {
    expect(partnerCanDeleteAttachment(mine, { id: 'a1' })).toBe(true);
    expect(partnerCanDeleteAttachment(mine, { id: 'a2' })).toBe(false);
  });
  it('マスターは同じ取引先の全件（取引先が上げたもの）を消せる', () => {
    expect(partnerCanDeleteAttachment(mine, { id: 'a2', is_master: true })).toBe(true);
  });
  it('宿（スタッフ）が付けたものは取引先からは消せない', () => {
    expect(partnerCanDeleteAttachment({ uploaded_by_kind: 'staff', uploaded_by_account: null }, { id: 'a1', is_master: true })).toBe(false);
  });
});

describe('表示・整形', () => {
  it('formatAttachmentSize', () => {
    expect(formatAttachmentSize(500)).toBe('500 B');
    expect(formatAttachmentSize(48213)).toBe('47 KB');
    expect(formatAttachmentSize(1.25 * MB)).toBe('1.3 MB');
    expect(formatAttachmentSize(null)).toBe('');
  });
  it('isInlineAttachment は PDF と表示できる画像だけ（SVG・HEIC は保存）', () => {
    expect(isInlineAttachment('application/pdf')).toBe(true);
    expect(isInlineAttachment('image/png')).toBe(true);
    expect(isInlineAttachment('image/svg+xml')).toBe(false);
    expect(isInlineAttachment('image/heic')).toBe(false);
    expect(isInlineAttachment('text/csv')).toBe(false);
  });
  it('attachmentLine', () => {
    expect(attachmentLine(['名簿.xlsx', ' 行程表.pdf '])).toBe('添付ファイル: 名簿.xlsx, 行程表.pdf');
    expect(attachmentLine([], '（x）')).toBeNull();
  });
  it('attachmentChangeOf は文字列だけを拾い、誰がを付ける', () => {
    const c = attachmentChangeOf({ added: ['名簿.xlsx', 3, null], removed: 'x' }, { kind: 'partner', label: 'jtb-sendai' }, new Date('2026-10-07T01:25:00Z'));
    expect(c).toEqual({ added: ['名簿.xlsx'], removed: [], by_kind: 'partner', by_label: 'jtb-sendai', at: '2026-10-07T01:25:00.000Z' });
  });
  it('attachmentsFlagOn は true / 1 / on だけ', () => {
    expect(attachmentsFlagOn('true')).toBe(true);
    expect(attachmentsFlagOn(' ON ')).toBe(true);
    expect(attachmentsFlagOn('false')).toBe(false);
    expect(attachmentsFlagOn(undefined)).toBe(false);
  });
  it('parseAttachmentIds は uuid だけ・重複を除いて 10 件まで', () => {
    const id = '0b9f5c8e-1d2a-4e3b-9c4d-5e6f7a8b9c0d';
    expect(parseAttachmentIds(`${id}, ${id.toUpperCase()},x,`)).toEqual([id]);
    const many = Array.from({ length: 12 }, (_, i) => `0b9f5c8e-1d2a-4e3b-9c4d-5e6f7a8b9c${String(i).padStart(2, '0')}`);
    expect(parseAttachmentIds(many.join(','))).toHaveLength(10);
  });
});
