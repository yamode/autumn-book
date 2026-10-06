// 予約入力で毎回聞く項目（アレルギー・備考など）の見出し・例文。施設ごとに管理画面「予約時に聞く項目」で変えられる
// （book.booking_form_settings・autumn-shared 20261006081330）。文言だけの設定で、回答の行き先は変えない
// （アレルギー → 顧客マスタ core.guests.allergies と PMS の事前質問「アレルギー」）。
export type StandardFieldKey = 'allergies' | 'notes' | 'pickup';

// choices = 選択肢を持つ項目（お迎え時間）。placeholder の代わりに選択肢を設定する
export const STANDARD_FIELDS: readonly { key: StandardFieldKey; name: string; label: string; placeholder: string; note: string; choices?: true }[] = [
  {
    key: 'allergies',
    name: '食物アレルギー・苦手な食材',
    label: '食物アレルギー・苦手な食材',
    placeholder: '例: えび・かに（2名）',
    note: '回答は顧客マスタのアレルギーと、PMS の事前質問「アレルギー」に入ります。'
  },
  {
    key: 'notes',
    name: 'その他ご要望・備考',
    label: 'その他ご要望・備考',
    placeholder: '',
    note: '回答は PMS の予約備考に入ります。'
  },
  {
    key: 'pickup',
    name: 'JRご利用時のお迎え時間',
    label: 'お迎えの時間',
    placeholder: '',
    note: '交通手段で「JR」を選んだときだけ出ます（必須）。時間の選択肢が空なら出ません。回答は PMS の事前質問に入ります。',
    choices: true
  }
];

// help = 見出しの下に小さい文字で出す補足の説明（改行可）
export type StandardFieldText = { label: string; placeholder: string; help: string; choices: string[] };
export type StandardFieldTexts = Record<StandardFieldKey, StandardFieldText>;

const MAX_LABEL = 60;
const MAX_PLACEHOLDER = 200;
const MAX_HELP = 500;

// 保存する形（施設が変えた文言だけ。空は既定に戻す）
export function normalizeStandardFields(raw: unknown): Partial<Record<StandardFieldKey, Partial<StandardFieldText>>> {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Partial<Record<StandardFieldKey, Partial<StandardFieldText>>> = {};
  for (const f of STANDARD_FIELDS) {
    const v = src[f.key] && typeof src[f.key] === 'object' ? (src[f.key] as Record<string, unknown>) : {};
    const label = String(v.label ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL);
    const placeholder = String(v.placeholder ?? '').trim().slice(0, MAX_PLACEHOLDER);
    const help = String(v.help ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_HELP);
    const choices = f.choices ? parseChoices(v.choices) : [];
    if (label || placeholder || help || choices.length)
      out[f.key] = { ...(label ? { label } : {}), ...(placeholder ? { placeholder } : {}), ...(help ? { help } : {}), ...(choices.length ? { choices } : {}) };
  }
  return out;
}

// 選択肢（配列、または「、」「,」・改行区切りの文字列）。重複と空を除いて30件まで
export function parseChoices(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.map((c) => String(c ?? '')) : String(raw ?? '').split(/[、,，\n]/);
  return [...new Set(list.map((c) => c.trim().slice(0, 40)).filter(Boolean))].slice(0, 30);
}

// 画面に出す文言（施設の設定 → 無ければ既定）
export function resolveStandardFields(raw: unknown): StandardFieldTexts {
  const saved = normalizeStandardFields(raw);
  return Object.fromEntries(
    STANDARD_FIELDS.map((f) => [f.key, { label: saved[f.key]?.label || f.label, placeholder: saved[f.key]?.placeholder ?? f.placeholder, help: saved[f.key]?.help ?? '', choices: saved[f.key]?.choices ?? [] }])
  ) as StandardFieldTexts;
}
