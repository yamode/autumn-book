// 取引先ページの料金表（CSV / PDF / 印刷用 HTML）の読み込みと応答。docs/partner-rank-rates.md §5.3（2026-10-09）。
// 組み立て（料金区分・CSV・紙面）は純関数 $lib/partner-rate-sheet。ここは入力の検査・料金の読み込み・応答ヘッダだけ。
import { error, type RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PartnerRateDay } from '$lib/partner-pricing';
import {
  buildRateSheet,
  parseRateSheetGuests,
  parseRateSheetRequest,
  rateSheetFileName,
  type RateSheet,
  type RateSheetRequest
} from '$lib/partner-rate-sheet';
import { logPartnerAccess, todayJst, type PartnerContext } from './store';
import { loadPartnerRates, partnerPublicBounds, partnerRangeChunks } from './rates';
import { requestMeta } from './portal';

// 同時に読むのは4本まで（loadPartnerPriceRange と同じ。RPC を一度に投げすぎない）
const CONCURRENCY = 4;
// 人数の上限（料金に出ている人数が取れないときの既定。料金カレンダーの人数の選択肢と同じ）
export const RATE_SHEET_DEFAULT_MAX_GUESTS = 6;

/**
 * 期間の日別料金。公開範囲のチャンク（partnerRangeChunks・料金の幅と同じ区切り＝同じキャッシュのキー）のうち
 * 要求範囲にかかるものを読み、要求範囲の外を切り落として日付順につなぐ（チャンクは重ならず連続なので欠け・重複は無い）。
 */
export async function loadRangeDays(
  db: SupabaseClient,
  partner: PartnerContext,
  range: { from: string; to: string },
  today = todayJst()
): Promise<PartnerRateDay[]> {
  const chunks = partnerRangeChunks(partner, today).filter((c) => c.to >= range.from && c.from <= range.to);
  const results: PartnerRateDay[][] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      results[i] = (await loadPartnerRates(db, partner, chunks[i])).days;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  const seen = new Set<string>();
  return results
    .flat()
    .filter((d) => d.date >= range.from && d.date <= range.to && !seen.has(d.date) && (seen.add(d.date), true))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type RateSheetInput = RateSheetRequest & { range: { from: string; to: string } };

/**
 * ?from=YYYY-MM&months=N を検査し、公開範囲に収める（料金は読まない）。
 * 入力が不正なら 400、公開範囲に1日もかからなければ 400（公開範囲外）、オンの施設が無い取引先（N9）は 404。
 */
export function parseRateSheetInput(partner: PartnerContext, url: URL, today = todayJst()): RateSheetInput {
  if (!partner.facility_available) throw error(404, '現在ご案内できる施設がありません。');
  const req = parseRateSheetRequest({ from: url.searchParams.get('from'), months: url.searchParams.get('months') }, partnerPublicBounds(partner, today));
  if (!req) throw error(400, '開始月・月数（1〜12）を確かめてください。');
  if (!req.range) throw error(400, '指定の期間は公開範囲外です。');
  return { ...req, range: req.range };
}

export type RateSheetData = {
  req: RateSheetInput;
  days: PartnerRateDay[];
  sheet: RateSheet;
  guests: number[];
};

/** CSV / PDF / 印刷用の共通: 入力を検査して料金を読み、料金表を組み立てる（?guests=2,3 は料金に出ている人数の内側に収める） */
export async function loadRateSheetData(db: SupabaseClient, partner: PartnerContext, url: URL, today = todayJst()): Promise<RateSheetData> {
  const req = parseRateSheetInput(partner, url, today);
  const days = await loadRangeDays(db, partner, req.range, today);
  const sheet = buildRateSheet(days, { planNames: partner.booking_settings.planNames });
  const maxGuests = sheet.guests.length ? sheet.guests[sheet.guests.length - 1] : RATE_SHEET_DEFAULT_MAX_GUESTS;
  return { req, days, sheet, guests: parseRateSheetGuests(url.searchParams.get('guests'), maxGuests) };
}

/** ファイル名（月は公開範囲に収めた後の実際の期間から作る） */
export const rateSheetDownloadName = (partner: PartnerContext, req: Pick<RateSheetInput, 'range'>, ext: 'csv' | 'pdf' | 'html') =>
  rateSheetFileName(partner.facility_name, req.range.from.slice(0, 7), req.range.to.slice(0, 7), ext);

/** アクセスログ（rate_sheet_csv / rate_sheet_pdf）。確認モードは logPartnerAccess 側で記録しない */
export function logRateSheet(
  db: SupabaseClient,
  event: Pick<RequestEvent, 'request'>,
  partner: PartnerContext,
  accountId: string,
  action: 'rate_sheet_csv' | 'rate_sheet_pdf',
  req: Pick<RateSheetInput, 'fromYm' | 'months'>,
  detail: Record<string, unknown> = {}
) {
  return logPartnerAccess(db, {
    partnerId: partner.id,
    accountId,
    channel: 'web',
    action,
    detail: { facility: partner.facility_slug, from: req.fromYm, months: req.months, ...detail },
    ip: requestMeta(event).ip
  });
}

/** 印刷用 HTML の CSP: スクリプトは nonce の付いた印刷ダイアログの1つだけ */
export const rateSheetPrintCsp = (nonce: string) =>
  `default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;
