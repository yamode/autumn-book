// 予約入力で毎回聞く項目（アレルギー・備考など）の見出し・例文。施設ごとに管理画面「予約時に聞く項目」で変えられる
// （book.booking_form_settings・autumn-shared 20261006081330）。文言だけの設定で、回答の行き先は変えない
// （アレルギー → 顧客マスタ core.guests.allergies と PMS の事前質問「アレルギー」）。
export type StandardFieldKey = 'arrival' | 'allergies' | 'transport' | 'pickup' | 'notes';

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
    // 到着予定時刻（2026-11-02）。公式サイトと取引先ページの予約入力の選択肢。先頭に「未定」が付く
    key: 'arrival',
    name: '到着予定時刻',
    label: '到着予定時刻',
    placeholder: '',
    note: '公式サイトと取引先ページの予約入力に出ます（先頭に「未定」が付きます）。回答は PMS の到着予定に入ります。',
    choices: true,
    defaultChoices: ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00']
  },
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
    note: '公式サイトと取引先ページの予約入力に出ます。「その他」を選ぶと内容を書く欄が出ます。回答は PMS の事前質問に入ります。追加で聞く項目の「条件」にも使えます。',
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
export type StandardFieldTexts = Record<StandardFieldKey, StandardFieldText> & { order: FieldOrderKey[] };

// 予約入力での並び順（2026-11-02）。questions = 追加で聞く項目（プラン・取引先）のまとまり。
// お迎え時間・交通手段の「その他」の内容欄は交通手段のすぐ後ろに付いて動く（単独では動かさない）
export type FieldOrderKey = 'arrival' | 'transport' | 'allergies' | 'questions' | 'notes';
export const DEFAULT_FIELD_ORDER: FieldOrderKey[] = ['arrival', 'transport', 'allergies', 'questions', 'notes'];
export const FIELD_ORDER_NAMES: Record<FieldOrderKey, string> = {
  arrival: '到着予定時刻',
  transport: '宿までの交通手段（お迎え時間を含む）',
  allergies: '食物アレルギー・苦手な食材',
  questions: '追加で聞く項目（プラン・取引先ごとの項目）',
  notes: 'その他ご要望・備考'
};

/** 保存してある並び順（知らないキー・重複は捨て、足りないキーは既定の位置で後ろに足す） */
export function normalizeFieldOrder(raw: unknown): FieldOrderKey[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,\s]+/);
  const seen = new Set<FieldOrderKey>();
  for (const k of list) if ((DEFAULT_FIELD_ORDER as string[]).includes(String(k))) seen.add(String(k) as FieldOrderKey);
  return [...seen, ...DEFAULT_FIELD_ORDER.filter((k) => !seen.has(k))];
}

const MAX_LABEL = 60;
const MAX_PLACEHOLDER = 200;
const MAX_HELP = 500;

// 保存する形（施設が変えた文言だけ。空は既定に戻す）
export function normalizeStandardFields(raw: unknown): Partial<Record<StandardFieldKey, Partial<StandardFieldText>>> & { order?: FieldOrderKey[] } {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Partial<Record<StandardFieldKey, Partial<StandardFieldText>>> & { order?: FieldOrderKey[] } = {};
  // 並び順は既定と違うときだけ残す
  if (src.order != null) {
    const order = normalizeFieldOrder(src.order);
    if (order.join() !== DEFAULT_FIELD_ORDER.join()) out.order = order;
  }
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
  const texts = Object.fromEntries(
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
  ) as Record<StandardFieldKey, StandardFieldText>;
  return { ...texts, order: saved.order ?? [...DEFAULT_FIELD_ORDER] };
}
