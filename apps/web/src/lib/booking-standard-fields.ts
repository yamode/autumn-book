// 予約入力で毎回聞く項目（アレルギー・備考など）の見出し・例文。施設ごとに管理画面「予約時に聞く項目」で変えられる
// （book.booking_form_settings・autumn-shared 20261006081330）。文言だけの設定で、回答の行き先は変えない
// （アレルギー → 顧客マスタ core.guests.allergies と PMS の事前質問「アレルギー」）。
export type StandardFieldKey = 'allergies' | 'transport' | 'pickup' | 'notes';

// choices = 選択肢を持つ項目（交通手段・お迎え時間）。placeholder の代わりに選択肢を設定する。defaultChoices は未設定のときの選択肢
export const STANDARD_FIELDS: readonly {
  key: StandardFieldKey;
  name: string;
  label: string;
  placeholder: string;
  note: string;
  choices?: true;
  defaultChoices?: readonly string[];
}[] = [
  {
    key: 'allergies',
    name: '食物アレルギー・苦手な食材',
    label: '食物アレルギー・苦手な食材',
    placeholder: '例: えび・かに（2名）',
    note: '回答は顧客マスタのアレルギーと、PMS の事前質問「アレルギー」に入ります。'
  },
  {
    // 宿までの交通手段（2026-11-02）。公式サイトの予約入力で聞く。追加で聞く項目の条件（「JR のときだけ聞く」など）にも使える
    key: 'transport',
    name: '宿までの交通手段',
    label: '宿までの交通手段',
    placeholder: '',
    note: '公式サイトの予約入力に出ます（取引先ページは JR／車／その他 のまま）。「その他」を選ぶと内容を書く欄が出ます。回答は PMS の事前質問に入ります。追加で聞く項目の「条件」にも使えます。',
    choices: true,
    defaultChoices: ['JR', '車', 'その他']
  },
  {
    key: 'pickup',
    name: 'お迎え時間',
    label: 'お迎えの時間',
    placeholder: '',
    note: '交通手段で「お迎えを聞く選択肢」（既定は JR）を選んだときだけ出ます（必須）。時間の選択肢が空なら出ません。回答は PMS の事前質問に入ります。',
    choices: true
  },
  {
    key: 'notes',
    name: 'その他ご要望・備考',
    label: 'その他ご要望・備考',
    placeholder: '',
    note: '回答は PMS の予約備考に入ります。'
  }
];

/** 交通手段の「その他」（内容を書く欄を出す選択肢） */
export const TRANSPORT_OTHER = 'その他';
/** お迎え時間を聞く交通手段の既定 */
export const PICKUP_WHEN_DEFAULT = 'JR';

// help = 見出しの下に小さい文字で出す補足の説明（改行可）
// when = お迎え時間を聞く交通手段の選択肢（pickup だけ）。required = 必須（transport だけ）
export type StandardFieldText = { label: string; placeholder: string; help: string; choices: string[]; when?: string; required?: boolean };
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
    const when = f.key === 'pickup' ? String(v.when ?? '').trim().slice(0, 40) : '';
    const required = f.key === 'transport' && (v.required === true || v.required === 'on' || v.required === 'true');
    if (label || placeholder || help || choices.length || when || required)
      out[f.key] = {
        ...(label ? { label } : {}),
        ...(placeholder ? { placeholder } : {}),
        ...(help ? { help } : {}),
        ...(choices.length ? { choices } : {}),
        ...(when ? { when } : {}),
        ...(required ? { required } : {})
      };
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
    STANDARD_FIELDS.map((f) => {
      const s = saved[f.key];
      const t: StandardFieldText = {
        label: s?.label || f.label,
        placeholder: s?.placeholder ?? f.placeholder,
        help: s?.help ?? '',
        choices: s?.choices ?? [...(f.defaultChoices ?? [])]
      };
      if (f.key === 'pickup') t.when = s?.when || PICKUP_WHEN_DEFAULT;
      if (f.key === 'transport') t.required = s?.required === true;
      return [f.key, t];
    })
  ) as StandardFieldTexts;
}
