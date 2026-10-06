// 予約時に聞く項目（送迎希望・記念日・夕食時間など）。サーバ・画面共通の純関数。
//   ・施設ごとのテンプレート（book.booking_question_templates）か、プラン独自（book.plan_contents.questions）を、
//     プランの question_mode で選ぶ（autumn-shared 20261006073112）。
//   ・取引先予約では、プランの項目の後ろに取引先ごとの項目（rms_partners.booking_settings.options）を足して聞く。
//   ・回答は「項目名: 回答」の行にして PMS の予約備考に入れる。
export type BookingQuestionType = 'check' | 'select' | 'text';

// booking = 予約ごとに1回聞く / room = 部屋ごとに聞く（複数室なら「1室目 …」「2室目 …」）
export type BookingQuestionScope = 'booking' | 'room';

export type BookingQuestion = {
  id: string;
  label: string;
  type: BookingQuestionType;
  choices: string[]; // type=select のときの選択肢
  required: boolean;
  scope: BookingQuestionScope;
};

export type PlanQuestionMode = 'none' | 'template' | 'custom';
export const PLAN_QUESTION_MODES: readonly PlanQuestionMode[] = ['none', 'template', 'custom'];

export type BookingQuestionTemplate = {
  id: string;
  name: string;
  questions: BookingQuestion[];
  sortOrder: number;
};

export const MAX_BOOKING_QUESTIONS = 20;

// DB の jsonb / 画面からの入力を、欠けや不正値を補って正規形にする（保存前・読込時の両方で通す）。
export function normalizeBookingQuestions(raw: unknown): BookingQuestion[] {
  const list = Array.isArray(raw) ? raw : [];
  const used = new Set<string>();
  return list
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map((o, i) => {
      const type: BookingQuestionType = o.type === 'select' || o.type === 'text' ? o.type : 'check';
      const choices = Array.isArray(o.choices)
        ? [...new Set(o.choices.map((c) => String(c ?? '').trim()).filter(Boolean))].slice(0, 20)
        : [];
      // id はフォームの name（opt_<id>）に使うので英数字・ハイフン・下線だけにし、重複させない
      let id = String(o.id ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || `opt-${i + 1}`;
      while (used.has(id)) id = `${id}_`;
      used.add(id);
      return {
        id,
        label: String(o.label ?? '').trim().slice(0, 60),
        type,
        choices: type === 'select' ? choices : [],
        required: o.required === true,
        scope: (o.scope === 'room' ? 'room' : 'booking') as BookingQuestionScope
      };
    })
    .filter((o) => o.label)
    .slice(0, MAX_BOOKING_QUESTIONS);
}

// 保存時の検証（normalize で吸収できない入力ミス）。
export function validateBookingQuestions(qs: BookingQuestion[]): string | null {
  for (const [i, o] of qs.entries()) {
    if (o.type === 'select' && o.choices.length < 2) return `項目${i + 1}「${o.label}」: 選択肢を2つ以上入れてください。`;
  }
  return null;
}

export const newBookingQuestion = (): BookingQuestion => ({
  id: `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
  label: '',
  type: 'check',
  choices: [],
  required: false,
  scope: 'booking'
});

// 取引先予約で聞く項目: プランの項目 → 取引先ごとの項目。id に出どころの印を付けて重ならないようにする
// （フォームの name は opt_<id>。p- = プラン、x- = 取引先）。
export function mergePartnerQuestions(plan: BookingQuestion[], partner: BookingQuestion[]): BookingQuestion[] {
  return [...plan.map((q) => ({ ...q, id: `p-${q.id}` })), ...partner.map((q) => ({ ...q, id: `x-${q.id}` }))];
}

// 回答のキー（フォームの name は opt_<key>）。部屋ごとの項目は <id>@<部屋の番号0始まり>
export const answerKey = (q: Pick<BookingQuestion, 'id' | 'scope'>, roomIndex = 0) => (q.scope === 'room' ? `${q.id}@${roomIndex}` : q.id);

// 聞く欄の並び（予約ごとの項目 → 部屋ごとの項目を部屋の数だけ）。label は表示・備考用（複数室なら「2室目 …」）
export function expandQuestions(questions: BookingQuestion[], roomCount = 1): (BookingQuestion & { key: string; roomIndex: number | null; fullLabel: string })[] {
  const n = Math.max(1, roomCount);
  return [
    ...questions.filter((q) => q.scope !== 'room').map((q) => ({ ...q, key: answerKey(q), roomIndex: null, fullLabel: q.label })),
    ...Array.from({ length: n }, (_, i) =>
      questions
        .filter((q) => q.scope === 'room')
        .map((q) => ({ ...q, key: answerKey(q, i), roomIndex: i, fullLabel: n > 1 ? `${i + 1}室目 ${q.label}` : q.label }))
    ).flat()
  ];
}

// フォームの回答（opt_<key>）を集める。
export function answersFromForm(fd: FormData, questions: BookingQuestion[], roomCount = 1): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const q of expandQuestions(questions, roomCount)) answers[q.key] = String(fd.get(`opt_${q.key}`) ?? '').trim();
  return answers;
}

// 回答を検証して {label, value} の並びにする（部屋ごとの項目は部屋の数だけ）。
export function resolveQuestionAnswers(
  questions: BookingQuestion[],
  answers: Record<string, string>,
  roomCount = 1
): { ok: true; values: { label: string; value: string }[] } | { ok: false; message: string } {
  const values: { label: string; value: string }[] = [];
  for (const q of expandQuestions(questions, roomCount)) {
    const o = { ...q, label: q.fullLabel };
    const raw = String(answers[q.key] ?? '').trim();
    if (o.type === 'check') {
      if (raw === '1' || raw === 'true' || raw === 'on') values.push({ label: o.label, value: 'あり' });
      else if (o.required) return { ok: false, message: `「${o.label}」を確認してください。` };
      continue;
    }
    if (!raw) {
      if (o.required) return { ok: false, message: `「${o.label}」を入力してください。` };
      continue;
    }
    if (o.type === 'select' && !o.choices.includes(raw)) return { ok: false, message: `「${o.label}」の選択肢が正しくありません。` };
    values.push({ label: o.label, value: raw.slice(0, 500) });
  }
  return { ok: true, values };
}

// 回答を備考の行にする（「項目名: 回答」）。
export const answerLines = (values: { label: string; value: string }[]) => values.map((v) => `${v.label}: ${v.value}`).join('\n');

// ---- 部屋ごとの男女の内訳（全予約で既定で聞く・プランで外せる。必須・男性＋女性＝その部屋の大人の人数）----
// フォームは部屋ごとに male_<i>（男性の人数）を選び、女性は人数から引いて決まる（female_<i> も送るが検証は合計で行う）。
export type RoomGender = { male: number; female: number };

export function resolveRoomGenders(
  adults: number[],
  get: (key: string) => string | null | undefined
): { ok: true; rooms: RoomGender[] } | { ok: false; message: string } {
  const rooms: RoomGender[] = [];
  for (const [i, a] of adults.entries()) {
    const where = adults.length > 1 ? `${i + 1}室目の` : '';
    const rawM = String(get(`male_${i}`) ?? '').trim();
    if (rawM === '') return { ok: false, message: `${where}男女の内訳（男性の人数）を選んでください。` };
    const male = Number(rawM);
    const rawF = String(get(`female_${i}`) ?? '').trim();
    const female = rawF === '' ? a - male : Number(rawF);
    if (!Number.isInteger(male) || !Number.isInteger(female) || male < 0 || female < 0 || male + female !== a) {
      return { ok: false, message: `${where}男女の内訳が人数（大人${a}名）と合いません。` };
    }
    rooms.push({ male, female });
  }
  return { ok: true, rooms };
}

export const genderText = (g: RoomGender) => `男性${g.male}名・女性${g.female}名`;
