// 取引先 × PMS 顧客マスタ Phase 3a: 旅行会社の受付枠（与信）の純関数（サーバ・画面の両方から読む）。
// 設計: docs/partner-pms-customer-link.md §5.4〜5.6・§6.1〜6.3・Phase 3a（決定 #3 #7 #8・N4 N5）
//
// 与信は「金額」ではなく「月別の受付上限（延べ室数＝部屋×泊）」。判定そのものは DB 関数
// public.rms_partner_credit_check（autumn-shared 20261007000239）が行い、ここは
//   - 予約が触る月と、月ごとにこの予約で足す延べ室数（p_add）の計算
//   - RPC の返り値（jsonb）の正規化
//   - 取引先・宿に見せる文言
//   - 管理画面の与信設定フォームの検証
// だけを持つ。数え方を DB 関数と食い違わせないこと（チェックアウト日は泊ではない・泊ごとにその月へ）。

/** 'YYYY-MM' の月（JST の暦）。 */
export type YearMonth = string;

export type CreditMonth = {
  month: YearMonth;
  /** 過去3年の同月の送客実績（延べ室数）の平均 */
  baseline: number;
  /** その月の上限（延べ室数） */
  limit: number;
  /** 予約済み（この予約を含まない・取消/No Show は除く） */
  booked: number;
  /** この予約で足す延べ室数（見積で渡したもの。管理画面・料金カレンダーでは 0） */
  adding: number;
  /** 上限 − 予約済み − この予約。負なら超過 */
  remaining: number;
  over: boolean;
};

export type CreditSettings = {
  growthRate: number;
  minRooms: number;
  note: string;
  /** core.guests.metadata.pms.credit_updated_at / _by（book から保存したときだけ入る） */
  updatedAt: string | null;
  updatedBy: string | null;
};

export type CreditCheck = {
  /** 旅行会社（group）で与信管理 ON のときだけ true */
  enabled: boolean;
  settings: CreditSettings | null;
  over: boolean;
  months: CreditMonth[];
};

const toNum = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const toStr = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** rms_partner_credit_check の返り値（jsonb）を画面で使う形にする。読めないものは「与信なし」に倒す。 */
export function normalizeCreditCheck(raw: unknown): CreditCheck {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const s = r.settings && typeof r.settings === 'object' ? (r.settings as Record<string, unknown>) : null;
  const months = (Array.isArray(r.months) ? r.months : [])
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof (m as Record<string, unknown>).month === 'string')
    .map((m) => {
      const limit = Math.trunc(toNum(m.limit));
      const booked = Math.trunc(toNum(m.booked));
      const adding = Math.trunc(toNum(m.adding));
      const remaining = m.remaining == null ? limit - booked - adding : Math.trunc(toNum(m.remaining));
      return {
        month: m.month as string,
        baseline: toNum(m.baseline),
        limit,
        booked,
        adding,
        remaining,
        over: m.over === true || remaining < 0
      };
    });
  return {
    enabled: r.enabled === true,
    settings: s
      ? {
          growthRate: toNum(s.growth_rate),
          minRooms: Math.trunc(toNum(s.min_rooms)),
          note: typeof s.note === 'string' ? s.note : '',
          updatedAt: toStr(s.updated_at),
          updatedBy: toStr(s.updated_by)
        }
      : null,
    over: r.over === true || months.some((m) => m.over),
    months
  };
}

/** 予約時に保存した判定（rms_partner_bookings.credit_result）が「超過」か。判定なし（null）は false。 */
export function isCreditOver(creditResult: unknown): boolean {
  if (!creditResult || typeof creditResult !== 'object') return false;
  const r = creditResult as Record<string, unknown>;
  if (r.enabled === false) return false;
  return r.over === true;
}

/** 超過した月だけ（予約一覧・メールの補足用）。 */
export function overMonthsOf(creditResult: unknown): CreditMonth[] {
  if (!isCreditOver(creditResult)) return [];
  return normalizeCreditCheck(creditResult).months.filter((m) => m.over);
}

// ---------------------------------------------------------------------------
// 月と延べ室数
// ---------------------------------------------------------------------------

const addDaysUtc = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * 滞在の月ごとの延べ室数（室数 × その月の泊数）。泊はチェックイン日〜チェックアウト日の前日（チェックアウト日は数えない）。
 * 例: 1/31 チェックイン 2泊 1室 → { '2027-01': 1, '2027-02': 1 }。
 * DB 関数の p_add にそのまま渡す。日付・泊数・室数が正しくなければ {}。
 */
export function stayRoomNightsByMonth(checkIn: string, nights: number, roomCount: number): Record<YearMonth, number> {
  const out: Record<YearMonth, number> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !Number.isInteger(nights) || nights < 1 || !Number.isInteger(roomCount) || roomCount < 1) return out;
  for (let i = 0; i < nights; i += 1) {
    const ym = addDaysUtc(checkIn, i).slice(0, 7);
    out[ym] = (out[ym] ?? 0) + roomCount;
  }
  return out;
}

/** 滞在が触る月（泊のある月だけ・昇順）。 */
export const stayMonths = (checkIn: string, nights: number): YearMonth[] => Object.keys(stayRoomNightsByMonth(checkIn, nights, 1)).sort();

/** from（'YYYY-MM'）から count か月ぶんの月。 */
export function nextMonths(from: YearMonth, count: number): YearMonth[] {
  const [y, m] = from.split('-').map(Number);
  if (!y || !m) return [];
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const t = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** '2027-02' → '2027年2月' */
export const creditMonthLabel = (ym: YearMonth) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;

// ---------------------------------------------------------------------------
// 文言（取引先ページ・メール・管理画面）
// ---------------------------------------------------------------------------

/** 単位の注記（延べ室数）。 */
export const CREDIT_UNIT_NOTE = '受付枠は室数×泊数で数えます（例: 2室で3泊＝6室）。';

/** 超過しても受け付けるときの案内（Phase 3a は warn / deposit とも止めない）。 */
export const CREDIT_OVER_NOTICE = '受付枠を超えますが、このままお申し込みいただけます（宿で確認のうえご連絡することがあります）。';

/** 予約一覧・メール件名の印。 */
export const CREDIT_OVER_MARK = '受付枠超過';

/** 宿への通知メールの件名の先頭に付ける印（超過の予約だけ）。 */
export const creditOverSubjectPrefix = (creditResult: unknown) => (isCreditOver(creditResult) ? `【${CREDIT_OVER_MARK}】` : '');

/** この予約を入れる前の残り（上限 − 予約済み）。 */
export const creditRemainingBefore = (m: Pick<CreditMonth, 'limit' | 'booked'>) => m.limit - m.booked;

/**
 * 取引先ページの1か月ぶんの表示。
 *   head  … 「2027年2月: 残り 3 室（上限 10 室・ご予約済み 7 室）」（残りが負なら「上限を 2 室超えています」）
 *   after … 「このご予約で残り 1 室」/「このご予約で上限を 1 室超えます」。この予約ぶん（adding）が無ければ null
 */
export function creditMonthText(m: CreditMonth): { head: string; after: string | null } {
  const before = creditRemainingBefore(m);
  const rest = before >= 0 ? `残り ${before} 室` : `上限を ${-before} 室超えています`;
  const head = `${creditMonthLabel(m.month)}: ${rest}（上限 ${m.limit} 室・ご予約済み ${m.booked} 室）`;
  if (m.adding <= 0) return { head, after: null };
  const after = m.remaining >= 0 ? `このご予約で残り ${m.remaining} 室` : `このご予約で上限を ${-m.remaining} 室超えます`;
  return { head, after };
}

/** 料金カレンダーの見出しの脇（短く）: 「2027年2月の受付枠 残り 3 室」。 */
export function creditMonthShort(m: Pick<CreditMonth, 'month' | 'limit' | 'booked'>): string {
  const before = creditRemainingBefore(m);
  return `${creditMonthLabel(m.month)}の受付枠 ${before >= 0 ? `残り ${before} 室` : `上限超過（${-before} 室）`}`;
}

/** 宿への通知メール本文の1行（超過した月の内訳）。超過でなければ null。 */
export function creditOverLine(creditResult: unknown): string | null {
  const months = overMonthsOf(creditResult);
  if (!months.length) return null;
  return `【${CREDIT_OVER_MARK}】${months.map((m) => `${creditMonthLabel(m.month)} 上限${m.limit}室・予約${m.booked}室`).join(' / ')}`;
}

// ---------------------------------------------------------------------------
// 超過時の挙動（rms_partners.credit_over_action）
// ---------------------------------------------------------------------------

export type CreditOverAction = 'ignore' | 'warn' | 'deposit';

/**
 * 管理画面の選択肢（Phase 3b で deposit を有効化・2026-10-07）。
 * deposit: 受付枠を超える予約は後払い（月末締め・自由入力・チェックアウト日決済〈N1〉）を選べなくし、
 * 全額の予約時決済かデポジット（一部を予約時にオンライン決済・残額は後日）だけで受ける。
 */
export const CREDIT_OVER_ACTION_OPTIONS: readonly { id: CreditOverAction; label: string; note: string; selectable: boolean }[] = [
  {
    id: 'deposit',
    label: '後払いを止めてデポジットで受ける',
    note: '枠を超える予約は、全額の予約時決済か、デポジット（一部を予約時にオンライン決済・残額は後日）だけで受けます。後払い（月末締め・自由入力・チェックアウト日決済）は選べません。',
    selectable: true
  },
  { id: 'warn', label: '受け付けて警告する', note: '枠を超えても予約を受け、予約一覧・宿への通知メール・PMS の備考に【受付枠超過】の印を付けます。', selectable: true },
  { id: 'ignore', label: '与信を見ない', note: '受付枠を判定せず、取引先ページにも残り室数を出しません。', selectable: true }
];

export const normalizeCreditOverAction = (v: unknown): CreditOverAction => (v === 'ignore' || v === 'warn' ? v : 'deposit');

/** 管理画面から保存できる値か。 */
export const isSelectableCreditOverAction = (v: unknown): v is CreditOverAction =>
  CREDIT_OVER_ACTION_OPTIONS.some((o) => o.id === v && o.selectable);

/** 取引先ページで受付枠を見せるか（ignore 以外）。 */
export const showsCredit = (action: CreditOverAction) => action !== 'ignore';

/**
 * 超過時にデポジット方式で受ける予約か（判定が「超過」で、超過時の挙動が deposit）。
 * このときの支払方法は online（全額の予約時決済）と deposit_online（デポジット）だけ。
 */
export const requiresDeposit = (action: CreditOverAction, credit: Pick<CreditCheck, 'over'> | null | undefined) =>
  action === 'deposit' && !!credit?.over;

/**
 * 超過時（deposit）の案内（§6.2）。「2027年2月は御社の受付枠（上限 10 室）を超えるため、このご予約は …」
 * depositAmount はデポジットの額（円）。
 */
export function creditDepositNotice(months: CreditMonth[], depositAmount: number): string {
  const over = months.filter((m) => m.over);
  const head = over.length
    ? `${over.map((m) => `${creditMonthLabel(m.month)}は御社の受付枠（上限 ${m.limit} 室）`).join('、')}を超えるため、`
    : '御社の受付枠を超えるため、';
  return `${head}このご予約はデポジット（${depositAmount.toLocaleString('ja-JP')}円）を予約時にお支払いいただく方法か、全額の予約時決済でお受けします。後払いはお選びいただけません。枠について御社担当者へご相談の場合は宿までご連絡ください。`;
}

// ---------------------------------------------------------------------------
// 与信設定の編集（管理画面・管理者のみ）
// ---------------------------------------------------------------------------

export type CreditSettingsPatch = {
  credit_enabled: '1' | '';
  credit_growth_rate: string;
  credit_min_rooms: string;
  credit_note: string;
};

/**
 * 管理画面の入力 → rms_partner_set_agency_credit の p_patch。範囲は DB 関数と同じ（増加率 0〜1000％・最低枠 0〜9999 室の整数）。
 * 空欄は ''（PMS と同じく「未設定」＝増加率 0％・最低枠 0 室として扱われる）。全角数字・％・カンマは読む。
 */
export function parseCreditSettingsInput(input: {
  enabled: unknown;
  growthRate: unknown;
  minRooms: unknown;
  note: unknown;
}): { ok: true; patch: CreditSettingsPatch } | { ok: false; message: string } {
  const clean = (v: unknown) =>
    String(v ?? '')
      .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[,，％%\s]/g, '');
  const rate = clean(input.growthRate);
  if (rate && (!/^\d+(\.\d+)?$/.test(rate) || Number(rate) > 1000)) {
    return { ok: false, message: '増加率は 0〜1000 の数で入力してください（％）。' };
  }
  const min = clean(input.minRooms);
  if (min && (!/^\d+$/.test(min) || Number(min) > 9999)) {
    return { ok: false, message: '最低枠は 0〜9999 の整数で入力してください（室/月）。' };
  }
  const enabled = input.enabled === true || input.enabled === '1' || input.enabled === 'true' || input.enabled === 'on';
  return {
    ok: true,
    patch: {
      credit_enabled: enabled ? '1' : '',
      credit_growth_rate: rate ? String(Number(rate)) : '',
      credit_min_rooms: min ? String(Number(min)) : '',
      credit_note: String(input.note ?? '').trim().slice(0, 500)
    }
  };
}

/** core.guests.metadata.pms から与信の4キー＋最終更新を読む（編集フォームの初期値）。 */
export function readAgencyCreditMeta(metadata: unknown): {
  enabled: boolean;
  growthRate: string;
  minRooms: string;
  note: string;
  updatedAt: string | null;
  updatedBy: string | null;
} {
  const m = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const p = m.pms && typeof m.pms === 'object' && !Array.isArray(m.pms) ? (m.pms as Record<string, unknown>) : {};
  const s = (v: unknown) => (v == null ? '' : String(v).trim());
  return {
    enabled: s(p.credit_enabled) === '1',
    growthRate: s(p.credit_growth_rate),
    minRooms: s(p.credit_min_rooms),
    note: s(p.credit_note),
    updatedAt: toStr(p.credit_updated_at),
    updatedBy: toStr(p.credit_updated_by)
  };
}

/** 'book:<user id>' から user id を取り出す（book 以外・空なら null）。 */
export function bookActorUserId(updatedBy: string | null | undefined): string | null {
  const m = /^book:(.+)$/.exec((updatedBy ?? '').trim());
  return m ? m[1] : null;
}

/**
 * 「最終更新」の表示の出所。updated_by が book:… なら book（名前は呼び出し側で引く）。
 * それ以外の値（PMS が将来書く等）はそのまま、無ければ「PMS などで設定」（PMS の保存は credit_updated_* を書かないため区別できない）。
 */
export function creditUpdatedSource(updatedBy: string | null | undefined, bookName: string | null = null): string {
  const by = (updatedBy ?? '').trim();
  if (!by) return 'PMS などで設定';
  if (bookActorUserId(by)) return `book${bookName ? `・${bookName}` : ''}`;
  return by;
}
