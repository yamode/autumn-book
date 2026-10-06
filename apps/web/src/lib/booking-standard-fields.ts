// 予約入力で毎回聞く項目（アレルギー・備考など）の見出し・例文。施設ごとに管理画面「予約時に聞く項目」で変えられる
// （book.booking_form_settings・autumn-shared 20261006081330）。文言だけの設定で、回答の行き先は変えない
// （アレルギー → 顧客マスタ core.guests.allergies と PMS の事前質問「アレルギー」）。
export type StandardFieldKey = 'allergies' | 'notes';

export const STANDARD_FIELDS: readonly { key: StandardFieldKey; name: string; label: string; placeholder: string; note: string }[] = [
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
  }
];

// help = 見出しの下に小さい文字で出す補足の説明（改行可）
export type StandardFieldText = { label: string; placeholder: string; help: string };
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
    if (label || placeholder || help) out[f.key] = { ...(label ? { label } : {}), ...(placeholder ? { placeholder } : {}), ...(help ? { help } : {}) };
  }
  return out;
}

// 画面に出す文言（施設の設定 → 無ければ既定）
export function resolveStandardFields(raw: unknown): StandardFieldTexts {
  const saved = normalizeStandardFields(raw);
  return Object.fromEntries(
    STANDARD_FIELDS.map((f) => [f.key, { label: saved[f.key]?.label || f.label, placeholder: saved[f.key]?.placeholder ?? f.placeholder, help: saved[f.key]?.help ?? '' }])
  ) as StandardFieldTexts;
}
