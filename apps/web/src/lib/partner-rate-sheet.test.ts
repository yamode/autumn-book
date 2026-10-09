// 料金表（CSV / PDF）の組み立てのテスト（docs/partner-rank-rates.md §5.3）。
import { describe, it, expect } from 'vitest';
import type { PartnerRateDay } from '$lib/partner-pricing';
import {
  buildRateSheet,
  chunkCategoryColumns,
  csvCell,
  parseRateSheetGuests,
  parseRateSheetRequest,
  rateCategoryLabel,
  rateSheetCsv,
  rateSheetFileName,
  renderRateSheetHtml,
  RATE_SHEET_COLORS,
  MAX_CATEGORY_COLUMNS
} from './partner-rate-sheet';

// 1日ぶん（部屋 101 / 201・プラン a001）。p1 / p2 は 1名・2名の1名料金
const day = (date: string, p2: number, p1 = p2 + 4000, extra: Partial<PartnerRateDay> = {}): PartnerRateDay => ({
  date,
  closed: false,
  remainingRooms: null,
  rooms: [
    {
      roomCode: '101',
      roomName: '和室',
      remainingRooms: null,
      plans: [{ planCode: 'a001', planName: '基本■2食■夕朝食付', mealType: '2食', advance: false, pricesPerPerson: { 1: p1, 2: p2 } }]
    },
    {
      roomCode: '201',
      roomName: '洋室',
      remainingRooms: null,
      plans: [{ planCode: 'a001', planName: '基本■2食■夕朝食付', mealType: '2食', advance: false, pricesPerPerson: { 2: p2 + 2000 } }]
    }
  ],
  ...extra
});
const closed = (date: string): PartnerRateDay => ({ date, closed: true, remainingRooms: 0, rooms: [] });
const empty = (date: string): PartnerRateDay => ({ date, closed: false, remainingRooms: null, rooms: [] });

describe('rateCategoryLabel', () => {
  it('A〜Z の先は AA, AB…', () => {
    expect(rateCategoryLabel(0)).toBe('A');
    expect(rateCategoryLabel(25)).toBe('Z');
    expect(rateCategoryLabel(26)).toBe('AA');
    expect(rateCategoryLabel(27)).toBe('AB');
  });
});

describe('buildRateSheet', () => {
  const days = [day('2026-10-01', 20000), day('2026-10-02', 15000), day('2026-10-03', 20000), closed('2026-10-04'), empty('2026-10-05'), day('2026-10-06', 15000)];

  it('同じ署名（全組合せの料金）の日が1つの区分にまとまる', () => {
    const s = buildRateSheet(days);
    expect(s.categories).toHaveLength(2);
    expect(s.days.find((d) => d.date === '2026-10-01')!.category).toBe(s.days.find((d) => d.date === '2026-10-03')!.category);
    expect(s.days.find((d) => d.date === '2026-10-02')!.category).toBe(s.days.find((d) => d.date === '2026-10-06')!.category);
  });

  it('区分は平均料金の安い順に A, B…', () => {
    const s = buildRateSheet(days);
    expect(s.categories.map((c) => c.label)).toEqual(['A', 'B']);
    expect(s.categories[0].dates).toEqual(['2026-10-02', '2026-10-06']);
    expect(s.categories[1].dates).toEqual(['2026-10-01', '2026-10-03']);
    expect(s.categories[0].avg).toBeLessThan(s.categories[1].avg);
    expect(s.categories[0].color).toBe(RATE_SHEET_COLORS[0]);
    expect(s.categories[0].prices['101|a001|2']).toBe(15000);
    expect(s.categories[0].prices['201|a001|2']).toBe(17000);
  });

  it('1つでも料金が違えば別の区分（特別レートの曜日ルールで分かれた日など）', () => {
    const s = buildRateSheet([day('2026-10-01', 15000), day('2026-10-02', 15000, 19500)]);
    expect(s.categories).toHaveLength(2);
  });

  it('休館・料金の無い日は区分なし', () => {
    const s = buildRateSheet(days);
    expect(s.days.find((d) => d.date === '2026-10-04')).toEqual({ date: '2026-10-04', closed: true, category: null });
    expect(s.days.find((d) => d.date === '2026-10-05')).toEqual({ date: '2026-10-05', closed: false, category: null });
  });

  it('行は部屋 × プラン（取引先向けのプラン名に差し替え）・人数は期間に出ているもの', () => {
    const s = buildRateSheet(days, { planNames: { a001: '【御社専用】2食付' } });
    expect(s.rows.map((r) => [r.roomName, r.planName, r.mealType])).toEqual([
      ['和室', '【御社専用】2食付', '2食'],
      ['洋室', '【御社専用】2食付', '2食']
    ]);
    expect(s.guests).toEqual([1, 2]);
    // 差し替えが無ければ PMS の名前から作る既定の表示名
    expect(buildRateSheet(days).rows[0].planName).not.toContain('■');
  });

  it('13 以上の区分は色を繰り返す', () => {
    const many = Array.from({ length: 14 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, '0')}`, 10000 + i * 100));
    const s = buildRateSheet(many);
    expect(s.categories).toHaveLength(14);
    expect(s.categories[12].color).toBe(RATE_SHEET_COLORS[0]);
    expect(s.categories[12].label).toBe('M');
  });
});

describe('CSV', () => {
  it('csvCell: カンマ・ダブルクォート・改行をエスケープ', () => {
    expect(csvCell('和室')).toBe('和室');
    expect(csvCell('A,B')).toBe('"A,B"');
    expect(csvCell('「"特"」')).toBe('"「""特""」"');
    expect(csvCell('1\n2')).toBe('"1\n2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12000)).toBe('12000');
  });

  it('csvCell: 先頭が = + - @ タブ CR の文字列は \' を前置して "…" で囲む（数値は対象外）', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('\tx')).toBe(`"'\tx"`);
    expect(csvCell('\rx')).toBe(`"'\rx"`);
    expect(csvCell('和室=A')).toBe('和室=A');
    expect(csvCell(-1000)).toBe('-1000');
  });

  it('CSV の部屋・プラン名が式に読まれない', () => {
    const days = [day('2026-10-01', 20000)];
    days[0].rooms[0].roomName = '=cmd|x';
    const csv = rateSheetCsv(buildRateSheet(days), days, { facilityName: '山人', planNames: { a001: '@プラン' } });
    expect(csv).toContain(`"'=cmd|x","'@プラン"`);
  });

  it('UTF-8 BOM・CRLF・1行 = 日 × 部屋 × プラン × 人数・休館/販売なしは1行', () => {
    const days = [day('2026-10-01', 20000), closed('2026-10-04'), empty('2026-10-05')];
    const s = buildRateSheet(days, { planNames: { a001: 'プラン,"特"' } });
    const csv = rateSheetCsv(s, days, { facilityName: '山人', planNames: { a001: 'プラン,"特"' } });
    expect(csv.startsWith('﻿日付,曜日,料金区分,施設,部屋タイプ,プラン,食事,人数,')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.includes('\n') && !/[^\r]\n/.test(csv)).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    // 見出し + 10/1（和室 1名・2名、洋室 2名）+ 休館 + 販売なし
    expect(lines).toHaveLength(1 + 3 + 2);
    expect(lines[1]).toBe('2026-10-01,木,区分A,山人,和室,"プラン,""特""",2食,1,24000,24000');
    expect(lines[2]).toBe('2026-10-01,木,区分A,山人,和室,"プラン,""特""",2食,2,20000,40000');
    expect(lines[3]).toBe('2026-10-01,木,区分A,山人,洋室,"プラン,""特""",2食,2,22000,44000');
    expect(lines[4]).toBe('2026-10-04,日,休館,山人,,,,,,');
    expect(lines[5]).toBe('2026-10-05,月,販売なし,山人,,,,,,');
  });

  it('祝日は曜日に「祝」を付ける', () => {
    const days = [day('2026-11-03', 20000)];
    const csv = rateSheetCsv(buildRateSheet(days), days, { facilityName: '山人' });
    expect(csv).toContain('2026-11-03,火・祝,区分A');
  });

  it('ファイル名', () => {
    expect(rateSheetFileName('山人-yamado-', '2026-10', '2026-12', 'csv')).toBe('料金表_山人-yamado-_202610-202612.csv');
    expect(rateSheetFileName('A/B', '2026-10', '2026-10', 'pdf')).toBe('料金表_A／B_202610-202610.pdf');
  });
});

describe('parseRateSheetRequest / parseRateSheetGuests', () => {
  const bounds = { earliest: '2026-10-09', latest: '2027-01-15' };

  it('既定は今月から3か月・公開範囲に収める', () => {
    expect(parseRateSheetRequest({}, bounds)).toEqual({
      fromYm: '2026-10',
      months: 3,
      monthList: ['2026-10', '2026-11', '2026-12'],
      range: { from: '2026-10-09', to: '2026-12-31' }
    });
    expect(parseRateSheetRequest({ from: '2026-12', months: '12' }, bounds)!.range).toEqual({ from: '2026-12-01', to: '2027-01-15' });
  });

  it('不正な値は null・公開範囲外は range が null', () => {
    expect(parseRateSheetRequest({ from: '2026-13' }, bounds)).toBeNull();
    expect(parseRateSheetRequest({ from: 'x' }, bounds)).toBeNull();
    expect(parseRateSheetRequest({ months: '0' }, bounds)).toBeNull();
    expect(parseRateSheetRequest({ months: '13' }, bounds)).toBeNull();
    expect(parseRateSheetRequest({ months: '1.5' }, bounds)).toBeNull();
    expect(parseRateSheetRequest({ from: '2027-02', months: '1' }, bounds)!.range).toBeNull();
    expect(parseRateSheetRequest({ from: '2026-08', months: '1' }, bounds)!.range).toBeNull();
  });

  it('人数: 1〜最大の整数・重複なし・昇順。空なら 2', () => {
    expect(parseRateSheetGuests('3,2,2,9,x,0', 6)).toEqual([2, 3]);
    expect(parseRateSheetGuests('', 6)).toEqual([2]);
    expect(parseRateSheetGuests(null, 1)).toEqual([1]);
  });
});

describe('renderRateSheetHtml', () => {
  const days = [day('2026-10-01', 20000), day('2026-10-02', 15000), closed('2026-10-03')];
  const sheet = buildRateSheet(days, { planNames: { a001: '<専用>' } });
  const meta = {
    partnerName: '○○トラベル',
    facilityName: '山人',
    issuedOn: '2026-10-01',
    months: ['2026-10', '2026-11', '2026-12'],
    range: { from: '2026-10-01', to: '2026-11-30' },
    guests: [1, 2]
  };

  it('月カレンダー（範囲にかかる月だけ・2か月で1ページ）と人数ごとの表', () => {
    const html = renderRateSheetHtml(sheet, meta);
    expect(html).toContain('○○トラベル 様 専用料金表');
    expect(html).toContain('2026年10月');
    expect(html).toContain('2026年11月');
    expect(html).not.toContain('2026年12月</h2>');
    expect(html).toContain('休館');
    expect(html).toContain('1名1室の料金');
    expect(html).toContain('2名1室の料金');
    // プラン名はエスケープ
    expect(html).toContain('&lt;専用&gt;');
    expect(html).not.toContain('<専用>');
    // 区分の色で塗る
    expect(html).toContain(`background:${RATE_SHEET_COLORS[0]}`);
    // 洋室は 1名の料金が無い → 1名の表には出ない
    const oneTable = html.slice(html.indexOf('1名1室の料金'), html.indexOf('2名1室の料金'));
    expect(oneTable).not.toContain('洋室');
    expect(html).not.toContain('<script');
  });

  it('印刷用は nonce 付きのスクリプトで印刷ダイアログを出す', () => {
    const html = renderRateSheetHtml(sheet, { ...meta, autoPrintNonce: 'abc123' });
    expect(html).toContain('<script nonce="abc123">');
    expect(html).toContain('window.print()');
  });

  it('紙面は A4 縦・月は上下に並べて月の途中で改ページしない', () => {
    const html = renderRateSheetHtml(sheet, meta);
    expect(html).toContain('size: A4 portrait');
    expect(html).not.toContain('landscape');
    expect(html).toContain('flex-direction: column');
    expect(html).toMatch(/\.month \{[^}]*page-break-inside: avoid/);
    // 料金表の行も途中で切らない・見出しは thead で繰り返す
    expect(html).toMatch(/table\.pt tr \{[^}]*page-break-inside: avoid/);
    expect(html).toContain('<thead><tr class="top">');
  });

  it('凡例に区分の目安（1名料金の最安〜最高）', () => {
    const html = renderRateSheetHtml(sheet, meta);
    const legend = html.slice(html.indexOf('<div class="legend">'));
    // 区分A（2026-10-02・2名 15,000 / 1名 19,000 / 洋室 17,000）
    expect(legend).toContain('区分A<b>¥15,000〜¥19,000</b>');
    expect(legend).toContain('区分B<b>¥20,000〜¥24,000</b>');
    expect(legend).toContain('休館・販売なし');
  });

  it('区分の列は 1表 8列まで・表の数は最小で均等に分ける', () => {
    expect(MAX_CATEGORY_COLUMNS).toBe(8);
    const n = (k: number) => Array.from({ length: k }, (_, i) => i);
    expect(chunkCategoryColumns(n(0))).toEqual([]);
    expect(chunkCategoryColumns(n(8)).map((c) => c.length)).toEqual([8]);
    expect(chunkCategoryColumns(n(9)).map((c) => c.length)).toEqual([5, 4]);
    expect(chunkCategoryColumns(n(17)).map((c) => c.length)).toEqual([6, 6, 5]);
    expect(chunkCategoryColumns(n(17)).flat()).toEqual(n(17));
  });

  it('区分が 9 以上なら表を分け、各表の見出しに区分の範囲', () => {
    // 毎日料金が違う 10 日 → 10 区分
    const many = Array.from({ length: 10 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, '0')}`, 10000 + i * 1000));
    const s = buildRateSheet(many, {});
    expect(s.categories).toHaveLength(10);
    const html = renderRateSheetHtml(s, { ...meta, guests: [2] });
    expect(html).toContain('2名1室の料金（1名あたり・下段は1室合計）（区分 A〜E）');
    expect(html).toContain('2名1室の料金（1名あたり・下段は1室合計）（区分 F〜J）');
    // 1表の区分の列は 8 以下
    const tables = html.split('<table class="pt">').slice(1);
    expect(tables).toHaveLength(2);
    for (const t of tables) expect((t.match(/<th class="cat"/g) ?? []).length).toBeLessThanOrEqual(8);
  });
});
