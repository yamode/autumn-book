// 予約時に聞く項目（送迎希望・記念日・夕食時間など）。サーバ・画面共通の純関数。
//   ・施設ごとのテンプレート（book.booking_question_templates）か、プラン独自（book.plan_contents.questions）を、
//     プランの question_mode で選ぶ（autumn-shared 20261006073112）。
//   ・取引先予約では、プランの項目の後ろに取引先ごとの項目（rms_partners.booking_settings.options）を足して聞く。
//   ・回答は「項目名: 回答」の行にして PMS の予約備考に入れる。
export type BookingQuestionType = 'check' | 'select' | 'text';

export type BookingQuestion = {
  id: string;
  label: string;
  type: BookingQuestionType;
  choices: string[]; // type=select のときの選択肢
  required: boolean;
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
        required: o.required === true
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
  required: false
});

// 取引先予約で聞く項目: プランの項目 → 取引先ごとの項目。id に出どころの印を付けて重ならないようにする
// （フォームの name は opt_<id>。p- = プラン、x- = 取引先）。
export function mergePartnerQuestions(plan: BookingQuestion[], partner: BookingQuestion[]): BookingQuestion[] {
  return [...plan.map((q) => ({ ...q, id: `p-${q.id}` })), ...partner.map((q) => ({ ...q, id: `x-${q.id}` }))];
}

// フォームの回答（opt_<id>）を集める。
export function answersFromForm(fd: FormData, questions: BookingQuestion[]): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const q of questions) answers[q.id] = String(fd.get(`opt_${q.id}`) ?? '').trim();
  return answers;
}

// 回答を検証して {label, value} の並びにする。
export function resolveQuestionAnswers(
  questions: BookingQuestion[],
  answers: Record<string, string>
): { ok: true; values: { label: string; value: string }[] } | { ok: false; message: string } {
  const values: { label: string; value: string }[] = [];
  for (const o of questions) {
    const raw = String(answers[o.id] ?? '').trim();
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
