// 取引先ページの料金表（CSV / PDF）の組み立て（サーバ・テスト共通の純関数）。docs/partner-rank-rates.md §5.3（2026-10-09）。
//
// 料金区分: 日ごとに「出ている全組合せ（部屋 × プラン × 人数 → 1名料金）」の署名を作り、同じ署名の日を1つの区分にまとめる。
//   取引先ランク暦ならほぼランクと一致し、特別レートの曜日・期間のルールで料金が分かれた日は別の区分になる。
//   区分は平均料金（署名の全料金の平均）の安い順に「区分A, B, C…」。休館・料金の無い日は区分なし。
// 紙面（PDF）は1ファイル完結の HTML（CSS インライン・Noto Sans JP）。lib/partner-invoice の renderInvoiceHtml と同じ流儀で、
// サーバが Cloudflare Browser Rendering で PDF にする（作れなければ同じ HTML を印刷用に返す）。
import { isHoliday } from '$lib/holidays';
import { partnerPlanName } from '$lib/partner-booking';
import type { PartnerRateDay } from '$lib/partner-pricing';

// 区分の色（淡い色・白黒印刷でも濃淡で区別しやすい順）。13 以上は色を繰り返し、文字（区分名）で区別する
export const RATE_SHEET_COLORS = [
  '#dbeafe', // 青
  '#dcfce7', // 緑
  '#fef3c7', // 黄
  '#fce7f3', // 桃
  '#ede9fe', // 紫
  '#ffedd5', // 橙
  '#cffafe', // 水
  '#ecfccb', // 黄緑
  '#fee2e2', // 赤
  '#e0e7ff', // 藍
  '#f5f5f4', // 灰
  '#fae8ff' // 薄紫
];

export const RATE_SHEET_MAX_MONTHS = 12;

// 区分名: A〜Z、その先は AA, AB…（Excel の列名と同じ数え方）
export function rateCategoryLabel(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export type RateSheetRow = {
  roomCode: string;
  roomName: string;
  planCode: string;
  // 取引先向けのプラン名（booking_settings.planNames。無ければ PMS の名前から作る既定の表示名）
  planName: string;
  mealType: string | null;
};

export type RateSheetCategory = {
  label: string; // 'A', 'B', …
  color: string;
  dates: string[];
  avg: number; // 1名料金の平均（並び順の根拠）
  // `${roomCode}|${planCode}|${guests}` → 1名料金（税込・入湯税別）
  prices: Record<string, number>;
};

export type RateSheetDay = { date: string; closed: boolean; category: string | null };

export type RateSheet = {
  days: RateSheetDay[];
  categories: RateSheetCategory[];
  rows: RateSheetRow[];
  guests: number[]; // 期間に出ている人数（昇順）
};

export const comboKey = (roomCode: string, planCode: string, guests: number) => `${roomCode}|${planCode}|${guests}`;

/** 期間の日別料金（buildPartnerDays の結果・全人数）から料金表を組み立てる。days は日付順。 */
export function buildRateSheet(days: PartnerRateDay[], opts: { planNames?: Record<string, string> } = {}): RateSheet {
  const rows: RateSheetRow[] = [];
  const rowKeys = new Set<string>();
  const guestSet = new Set<number>();
  // 署名 → 区分の材料（並べ替え前）
  const groups = new Map<string, { dates: string[]; prices: Record<string, number>; sum: number; n: number }>();
  const signatureOf = new Map<string, string>();

  for (const d of days) {
    if (d.closed) continue;
    const entries: string[] = [];
    const prices: Record<string, number> = {};
    let sum = 0;
    let n = 0;
    for (const r of d.rooms) {
      for (const p of r.plans) {
        const rk = `${r.roomCode}|${p.planCode}`;
        let any = false;
        for (const [g, v] of Object.entries(p.pricesPerPerson)) {
          const guests = Number(g);
          if (!(v > 0) || !Number.isInteger(guests)) continue;
          any = true;
          guestSet.add(guests);
          const key = comboKey(r.roomCode, p.planCode, guests);
          prices[key] = v;
          entries.push(`${key}=${v}`);
          sum += v;
          n += 1;
        }
        if (any && !rowKeys.has(rk)) {
          rowKeys.add(rk);
          rows.push({
            roomCode: r.roomCode,
            roomName: r.roomName,
            planCode: p.planCode,
            planName: partnerPlanName(opts.planNames, p.planCode, p.planName),
            mealType: p.mealType
          });
        }
      }
    }
    if (!entries.length) continue;
    const sig = entries.sort().join(';');
    signatureOf.set(d.date, sig);
    const g = groups.get(sig);
    if (g) g.dates.push(d.date);
    else groups.set(sig, { dates: [d.date], prices, sum, n });
  }

  // 平均の安い順（同じなら早い日付の順）に区分名を振る
  const ordered = [...groups.entries()].sort(([, a], [, b]) => a.sum / a.n - b.sum / b.n || a.dates[0].localeCompare(b.dates[0]));
  const labelOf = new Map<string, string>();
  const categories: RateSheetCategory[] = ordered.map(([sig, g], i) => {
    const label = rateCategoryLabel(i);
    labelOf.set(sig, label);
    return { label, color: RATE_SHEET_COLORS[i % RATE_SHEET_COLORS.length], dates: g.dates, avg: Math.round(g.sum / g.n), prices: g.prices };
  });

  // 部屋は日別データの並び（RMS の部屋順）で最初に出た順・プランは部屋の中で最初に出た順
  const roomOrder = new Map<string, number>();
  for (const r of rows) if (!roomOrder.has(r.roomCode)) roomOrder.set(r.roomCode, roomOrder.size);
  const sortedRows = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => roomOrder.get(a.r.roomCode)! - roomOrder.get(b.r.roomCode)! || a.i - b.i)
    .map((x) => x.r);

  return {
    days: days.map((d) => {
      const sig = signatureOf.get(d.date);
      return { date: d.date, closed: d.closed, category: sig ? (labelOf.get(sig) ?? null) : null };
    }),
    categories,
    rows: sortedRows,
    guests: [...guestSet].sort((a, b) => a - b)
  };
}

// ---------------------------------------------------------------------------
// 入力（開始月・月数・人数）
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};
export const shiftYm = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

export type RateSheetRequest = {
  fromYm: string; // 開始月（YYYY-MM）
  months: number; // 1〜12
  monthList: string[]; // 開始月から months か月
  // 公開範囲に収めた期間（1日も無ければ null）
  range: { from: string; to: string } | null;
};

/**
 * 料金表の入力を検査して、公開範囲（earliest〜latest。clampPartnerRange と同じ規則で出したもの）に収める。
 * from（YYYY-MM）・months（1〜12）が不正なら null（呼び出し側は 400）。既定は今月・3か月。
 */
export function parseRateSheetRequest(
  params: { from?: string | null; months?: string | null },
  bounds: { earliest: string; latest: string }
): RateSheetRequest | null {
  const fromRaw = (params.from ?? '').trim() || bounds.earliest.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromRaw)) return null;
  const monthsRaw = (params.months ?? '').trim() || '3';
  if (!/^\d{1,2}$/.test(monthsRaw)) return null;
  const months = Number(monthsRaw);
  if (months < 1 || months > RATE_SHEET_MAX_MONTHS) return null;
  const monthList = Array.from({ length: months }, (_, i) => shiftYm(fromRaw, i));
  const start = `${fromRaw}-01`;
  const end = lastDayOf(monthList[monthList.length - 1]);
  const from = start < bounds.earliest ? bounds.earliest : start;
  const to = end > bounds.latest ? bounds.latest : end;
  return { fromYm: fromRaw, months, monthList, range: from <= to ? { from, to } : null };
}

/** 人数の選択（"2,3"）。1〜maxGuests の整数だけ・重複なし・昇順。空なら既定（2。maxGuests が 1 なら 1） */
export function parseRateSheetGuests(raw: string | null | undefined, maxGuests: number): number[] {
  const list = [
    ...new Set(
      String(raw ?? '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= maxGuests)
    )
  ].sort((a, b) => a - b);
  return list.length ? list : [Math.min(2, Math.max(1, maxGuests))];
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
export const weekdayLabel = (iso: string) => `${WD[weekdayOf(iso)]}${isHoliday(iso) ? '・祝' : ''}`;

/**
 * CSV の1マス（カンマ・ダブルクォート・改行を含むときは "…" で囲み、" は "" にする）。
 * CSV インジェクション対策: 文字列で先頭が = + - @ タブ CR のときは ' を前置して必ず "…" で囲む（Excel に式として読ませない）。
 * 数値（number）は対象外（料金・人数はそのまま）。
 */
export function csvCell(v: string | number | null | undefined): string {
  if (typeof v === 'number') return String(v);
  const s = v ?? '';
  if (/^[=+\-@\t\r]/.test(s)) return `"'${s.replace(/"/g, '""')}"`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const RATE_SHEET_CSV_HEADER = ['日付', '曜日', '料金区分', '施設', '部屋タイプ', 'プラン', '食事', '人数', '1名料金（税込・入湯税別）', '1室合計（税込・入湯税別）'];

/**
 * 料金表の CSV（UTF-8 BOM・CRLF）。1行 = 日 × 部屋 × プラン × 人数（人数は選択に依らず全部）。
 * 休館の日は「休館」、料金の無い日は「販売なし」の1行だけ（日付が抜けないように）。
 */
export function rateSheetCsv(sheet: RateSheet, days: PartnerRateDay[], opts: { facilityName: string; planNames?: Record<string, string> }): string {
  const lines: string[] = [RATE_SHEET_CSV_HEADER.map(csvCell).join(',')];
  const catOf = new Map(sheet.days.map((d) => [d.date, d.category]));
  const rowIndex = new Map(sheet.rows.map((r, i) => [`${r.roomCode}|${r.planCode}`, i]));
  for (const d of days) {
    const head = [d.date, weekdayLabel(d.date)];
    const cat = catOf.get(d.date) ?? null;
    if (d.closed || !cat) {
      lines.push([...head, d.closed ? '休館' : '販売なし', opts.facilityName, '', '', '', '', '', ''].map(csvCell).join(','));
      continue;
    }
    const out: { order: number; g: number; cells: (string | number)[] }[] = [];
    for (const r of d.rooms) {
      for (const p of r.plans) {
        const order = rowIndex.get(`${r.roomCode}|${p.planCode}`) ?? 0;
        for (const [g, v] of Object.entries(p.pricesPerPerson)) {
          const guests = Number(g);
          if (!(v > 0) || !Number.isInteger(guests)) continue;
          out.push({
            order,
            g: guests,
            cells: [...head, `区分${cat}`, opts.facilityName, r.roomName, partnerPlanName(opts.planNames, p.planCode, p.planName), p.mealType ?? '', guests, v, v * guests]
          });
        }
      }
    }
    out.sort((a, b) => a.order - b.order || a.g - b.g);
    for (const o of out) lines.push(o.cells.map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ファイル名に使えない文字は全角に置き換える（partner-invoice の safeFilePart と同じ）
const safeFilePart = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 60);

/** 料金表_<施設名>_<YYYYMM>-<YYYYMM>.<ext> */
export const rateSheetFileName = (facilityName: string, fromYm: string, toYm: string, ext: 'csv' | 'pdf' | 'html') =>
  `料金表_${safeFilePart(facilityName) || '施設'}_${fromYm.replace('-', '')}-${toYm.replace('-', '')}.${ext}`;

// ---------------------------------------------------------------------------
// 紙面（PDF / 印刷用 HTML）
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
const jpDate = (iso: string) => `${Number(iso.slice(0, 4))}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
// 1つの表に並べる区分の列の上限（A4 縦の紙幅で 1名料金が読める幅）。超えたら表を分ける
export const MAX_CATEGORY_COLUMNS = 8;

/**
 * 区分の列を表ごとに分ける。1表 max 列まで・表の数は最小にして、列数はなるべく均等にする
 * （9区分なら 8 + 1 ではなく 5 + 4。最後の表だけ細くならないように）。
 */
export function chunkCategoryColumns<T>(cats: T[], max = MAX_CATEGORY_COLUMNS): T[][] {
  if (!cats.length) return [];
  const tables = Math.ceil(cats.length / max);
  const size = Math.ceil(cats.length / tables);
  const out: T[][] = [];
  for (let i = 0; i < cats.length; i += size) out.push(cats.slice(i, i + size));
  return out;
}

export type RateSheetMeta = {
  partnerName: string;
  facilityName: string;
  issuedOn: string; // 発行日（YYYY-MM-DD）
  months: string[]; // 紙面に出す月（YYYY-MM）
  range: { from: string; to: string }; // 料金を出す期間（公開範囲に収めたもの）
  guests: number[]; // 料金表を作る人数
  // 印刷用 HTML: 開いたら印刷ダイアログを出す（CSP の nonce を付けた小さなスクリプト）
  autoPrintNonce?: string;
};

// A4 縦（210 × 297mm・余白 11mm → 紙面 188 × 275mm）。月カレンダーは1ページに2か月を上下に並べ、
// 1か月 = 見出し 6mm ＋ 曜日 5mm ＋ 6週 × 17mm ≒ 113mm。2か月 ＋ 見出し・注記・凡例で 1ページに収まる。
const STYLE = `
@page { size: A4 portrait; margin: 11mm 11mm 11mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif; color: #1c1917; font-size: 9pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
.hd { display: flex; justify-content: space-between; align-items: flex-end; gap: 4mm; border-bottom: 1.5px solid #1c1917; padding-bottom: 1.5mm; }
.hd h1 { margin: 0; font-size: 12.5pt; font-weight: 700; }
.hd .m { font-size: 8pt; color: #44403c; text-align: right; }
.hd .m span { white-space: nowrap; }
.nt { margin: 1.2mm 0 3mm; font-size: 7.5pt; color: #57534e; }
.months { display: flex; flex-direction: column; gap: 5mm; }
.month { page-break-inside: avoid; break-inside: avoid; }
.month h2 { margin: 0 0 1.2mm; font-size: 11pt; }
table.cal { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.cal th { font-size: 8pt; font-weight: 600; padding: 0.6mm 0; border: 1px solid #a8a29e; background: #fafaf9; }
table.cal td { height: 17mm; border: 1px solid #a8a29e; vertical-align: top; padding: 0.8mm 1.2mm; }
table.cal td .d { font-size: 8.5pt; font-variant-numeric: tabular-nums; }
table.cal td .c { display: block; text-align: center; font-size: 13pt; font-weight: 700; line-height: 1.2; margin-top: 0.2mm; }
table.cal td .x { display: block; text-align: center; font-size: 8pt; color: #57534e; margin-top: 1.5mm; }
table.cal td.none { background: #e7e5e4; }
table.cal td.out { background: #fff; color: #d6d3d1; }
table.cal td.blank { border: none; }
.sun { color: #b91c1c; }
.sat { color: #1d4ed8; }
.legend { margin-top: 4mm; display: flex; flex-wrap: wrap; gap: 1.2mm 5mm; font-size: 7.8pt; page-break-inside: avoid; break-inside: avoid; }
.legend span { display: inline-flex; align-items: center; gap: 1.2mm; }
.legend .legend-note { flex-basis: 100%; color: #57534e; }
.legend i { display: inline-block; width: 6mm; height: 4mm; border: 1px solid #a8a29e; font-style: normal; text-align: center; font-size: 7pt; font-weight: 700; line-height: 3.6mm; }
table.pt { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 7.6pt; }
table.pt thead tr.top th { border: none; background: none; padding: 0 0 2.5mm; text-align: left; font-weight: 400; }
table.pt th, table.pt td { border: 1px solid #a8a29e; padding: 0.8mm 1mm; vertical-align: top; overflow-wrap: anywhere; }
table.pt th { background: #f5f5f4; font-weight: 600; }
table.pt th.cat { text-align: center; }
table.pt td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.pt td.n small { display: block; color: #78716c; font-size: 6.5pt; }
table.pt td.na { text-align: center; color: #a8a29e; }
table.pt tr { page-break-inside: avoid; break-inside: avoid; }
table.pt tbody.grp { page-break-inside: avoid; break-inside: avoid; border-top: 2px solid #57534e; }
table.pt td.room { font-weight: 600; border-bottom-color: transparent; }
table.pt tbody.grp tr:last-child td.room { border-bottom-color: #a8a29e; }
.pt-title { font-size: 10pt; font-weight: 700; margin: 0 0 1.5mm; }
.empty { margin-top: 10mm; text-align: center; color: #57534e; font-size: 11pt; }
`;

function headerHtml(meta: RateSheetMeta): string {
  const period = `${jpDate(meta.range.from)}〜${jpDate(meta.range.to)}`;
  return `<div class="hd"><h1>${esc(meta.partnerName)} 様 専用料金表</h1><div class="m"><span>${esc(meta.facilityName)}</span>　<span>期間 ${period}</span>　<span>発行日 ${jpDate(meta.issuedOn)}</span></div></div>
<p class="nt">料金は1名1泊・税込・入湯税別です。残室により予約できない日があります。発行日時点の料金です（料金は変わることがあります）。</p>`;
}

function monthHtml(ym: string, meta: RateSheetMeta, dayMap: Map<string, RateSheetDay>, colorOf: Map<string, string>): string {
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const last = lastDayOf(ym);
  const lead = weekdayOf(first);
  const total = Number(last.slice(8, 10));
  const cells: string[] = [];
  for (let i = 0; i < lead; i++) cells.push('<td class="blank"></td>');
  for (let day = 1; day <= total; day++) {
    const iso = `${ym}-${pad(day)}`;
    const wd = weekdayOf(iso);
    const tone = wd === 0 || isHoliday(iso) ? ' sun' : wd === 6 ? ' sat' : '';
    const num = `<span class="d${tone}">${day}</span>`;
    if (iso < meta.range.from || iso > meta.range.to) {
      cells.push(`<td class="out">${num}</td>`);
      continue;
    }
    const d = dayMap.get(iso);
    if (d?.closed) cells.push(`<td class="none">${num}<span class="x">休館</span></td>`);
    else if (d?.category) cells.push(`<td style="background:${colorOf.get(d.category)}">${num}<span class="c">${esc(d.category)}</span></td>`);
    else cells.push(`<td class="none">${num}<span class="x">—</span></td>`);
  }
  while (cells.length % 7) cells.push('<td class="blank"></td>');
  const weeks: string[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);
  const head = WD.map((w, i) => `<th class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</th>`).join('');
  return `<div class="month"><h2>${y}年${m}月</h2><table class="cal"><thead><tr>${head}</tr></thead><tbody>${weeks.join('')}</tbody></table></div>`;
}

function priceTablesHtml(sheet: RateSheet, meta: RateSheetMeta, guests: number): string {
  // その人数で料金のある行・区分だけ
  const rows = sheet.rows.filter((r) => sheet.categories.some((c) => c.prices[comboKey(r.roomCode, r.planCode, guests)] != null));
  const cats = sheet.categories.filter((c) => rows.some((r) => c.prices[comboKey(r.roomCode, r.planCode, guests)] != null));
  if (!rows.length || !cats.length) {
    return `<div class="page">${headerHtml(meta)}<p class="pt-title">${guests}名1室の料金</p><p class="empty">この人数で予約できる料金はありません。</p></div>`;
  }
  const chunks = chunkCategoryColumns(cats);
  return chunks
    .map((chunk) => {
      const span = 3 + chunk.length;
      const suffix = chunks.length > 1 ? `（区分 ${chunk[0].label}〜${chunk[chunk.length - 1].label}）` : '';
      // 縦の紙幅（188mm）: 部屋 30mm・プラン 40mm・食事 10mm、残り（約108mm）を区分の列で等分（8列で約13.5mm）
      const head = `<tr class="top"><th colspan="${span}">${headerHtml(meta)}<p class="pt-title">区分別の料金表　${guests}名1室の料金（1名あたり・下段は1室合計）${suffix}</p></th></tr>
<tr><th style="width:30mm">部屋タイプ</th><th style="width:40mm">プラン</th><th style="width:10mm">食事</th>${chunk
        .map((c) => `<th class="cat" style="background:${c.color}">区分${esc(c.label)}</th>`)
        .join('')}</tr>`;
      // 部屋タイプごとに tbody を分け、部屋名は先頭の行だけに出す（毎行くり返すと読みにくい・2026-10-09）。
      // tbody は改ページで割らない（rowspan は改ページで部屋名が消えるので使わない）
      const groups: (typeof rows)[] = [];
      for (const r of rows) {
        const last = groups[groups.length - 1];
        if (last && last[0].roomCode === r.roomCode) last.push(r);
        else groups.push([r]);
      }
      const body = groups
        .map((g) => {
          const trs = g
            .map((r, i) => {
              const tds = chunk
                .map((c) => {
                  const v = c.prices[comboKey(r.roomCode, r.planCode, guests)];
                  return v != null ? `<td class="n">${yen(v)}<small>${yen(v * guests)}</small></td>` : '<td class="na">—</td>';
                })
                .join('');
              return `<tr><td class="room">${i === 0 ? esc(r.roomName) : ''}</td><td>${esc(r.planName)}</td><td>${esc(r.mealType ?? '')}</td>${tds}</tr>`;
            })
            .join('');
          return `<tbody class="grp">${trs}</tbody>`;
        })
        .join('');
      return `<div class="page"><table class="pt"><thead>${head}</thead>${body}</table></div>`;
    })
    .join('');
}

/** 料金表の紙面（A4 縦）: 月カレンダー（1ページに2か月を上下に・区分の凡例つき）＋人数ごとの区分の料金表 */
export function renderRateSheetHtml(sheet: RateSheet, meta: RateSheetMeta): string {
  const dayMap = new Map(sheet.days.map((d) => [d.date, d]));
  const colorOf = new Map(sheet.categories.map((c) => [c.label, c.color]));
  const months = meta.months.filter((ym) => `${ym}-01` <= meta.range.to && lastDayOf(ym) >= meta.range.from);
  const legend = sheet.categories.length
    ? `<div class="legend">${sheet.categories
        // 凡例は色と区分名だけ（2026-10-10 指示: 全部屋・全プラン・全人数の最安〜最高を並べても区分の差が読めない）。
        // 料金は後ろのページの区分別料金表を見てもらう
        .map((c) => `<span><i style="background:${c.color}">${esc(c.label)}</i>区分${esc(c.label)}</span>`)
        .join('')}<span><i style="background:#e7e5e4"></i>休館・販売なし</span><span class="legend-note">各区分の料金は、後ろのページの「区分別の料金表」をご覧ください。</span></div>`
    : '<p class="empty">この期間にご案内できる料金はありません。</p>';
  const calPages: string[] = [];
  for (let i = 0; i < months.length; i += 2) {
    const inner = months
      .slice(i, i + 2)
      .map((ym) => monthHtml(ym, meta, dayMap, colorOf))
      .join('');
    calPages.push(`<div class="page">${headerHtml(meta)}<div class="months">${inner}</div>${legend}</div>`);
  }
  const tables = sheet.categories.length ? meta.guests.map((g) => priceTablesHtml(sheet, meta, g)).join('') : '';
  const title = `${meta.partnerName} 様 専用料金表 ${meta.facilityName}`;
  const script = meta.autoPrintNonce
    ? `<script nonce="${esc(meta.autoPrintNonce)}">window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});</script>`
    : '';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700&display=block" rel="stylesheet">
<style>${STYLE}</style>${script}</head><body>${calPages.join('')}${tables}</body></html>`;
}
