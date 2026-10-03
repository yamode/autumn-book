// 取引先専用ページのプラン紹介に出す「キャンセルポリシー」「お子様について」（2026-10-03・サーバ・画面共通の純関数）。
//
// 元データは RPC rms_partner_plan_terms（autumn-shared 20261003050209）。
// - キャンセル規定: プラン個別（booking.rate_plans.cancellation_policy）が空なら施設の既定（core.cancellation_policies）。
// - お子様: 施設の設定（book.facility_child_policies・管理画面「お子様の受け入れ」）があれば全プラン共通でそれを出す。
//           未設定なら rms の区分コード（子供不可）から決める。

export type TermsRow = { label: string; value: string };
export type PlanTerms = { cancellation: TermsRow[]; cancellationNote: string; children: TermsRow[]; childrenNote: string };

type Rule = { days_before: number; rate_percent: number };
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function normalizeRules(raw: unknown): Rule[] {
  // 配列（日数別料率）か {rules: [...]} のどちらでも受ける
  const list = Array.isArray(raw) ? raw : arr(obj(raw).rules);
  return list
    .map(obj)
    .map((r) => ({ days_before: Math.round(Number(r.days_before)), rate_percent: Math.round(Number(r.rate_percent)) }))
    .filter((r) => Number.isFinite(r.days_before) && r.days_before >= 0 && Number.isFinite(r.rate_percent) && r.rate_percent >= 0);
}

const dayLabel = (d: number) => (d === 0 ? '当日から' : d === 1 ? '前日から' : `${d}日前から`);

// 日数の多い順に「N日前から 10%」。0% の段（無料期間）は出さない。不泊は最後に。
export function cancellationRows(rules: Rule[], noShowPercent: number | null): TermsRow[] {
  const rows = [...rules]
    .sort((a, b) => b.days_before - a.days_before)
    .filter((r) => r.rate_percent > 0)
    .map((r) => ({ label: dayLabel(r.days_before), value: `${r.rate_percent}%` }));
  if (noShowPercent != null && noShowPercent > 0) rows.push({ label: '不泊', value: `${noShowPercent}%` });
  return rows;
}

// 区分コード → 表に出す行と案内文。知らないコードは何も出さない（誤った案内をしない）。
export function childrenTerms(code: string): { rows: TermsRow[]; note: string } {
  if (code === '子供不可') {
    return {
      rows: [
        { label: '小学生', value: '受入不可' },
        { label: '幼児', value: '受入不可' },
        { label: '添い寝', value: '不可' }
      ],
      note: 'このプランは大人のみのご利用です。'
    };
  }
  return { rows: [], note: '' };
}

// 施設のお子様設定（行は区分と内容。どちらか空の行は落とす）。行も補足も無ければ null（＝未設定）。
export function normalizeChildPolicy(raw: unknown): { rows: TermsRow[]; note: string } | null {
  const o = obj(raw);
  const rows = arr(o.rows)
    .map(obj)
    .map((r) => ({ label: str(r.label).slice(0, 60), value: str(r.value).slice(0, 200) }))
    .filter((r) => r.label && r.value)
    .slice(0, 20);
  const note = str(o.note).slice(0, 1000);
  return rows.length || note ? { rows, note } : null;
}

// RPC の結果から、プラン（コード＋表示名）ごとの表示内容を作る。キーは `${planCode}■${planLabel}`。
export function buildPlanTerms(raw: unknown): Map<string, PlanTerms> {
  const data = obj(raw);
  const def = obj(data.default_cancellation);
  const defRules = normalizeRules(def.rules);
  const defNoShow = def.no_show_rate_percent == null ? null : Number(def.no_show_rate_percent);
  const facilityChildren = normalizeChildPolicy(data.child_policy);
  const out = new Map<string, PlanTerms>();
  for (const p of arr(data.plans).map(obj)) {
    const own = normalizeRules(p.cancellation_policy);
    const rules = own.length ? own : defRules;
    const children = facilityChildren ?? childrenTerms(str(p.child_policy_code));
    out.set(`${str(p.plan_code)}■${str(p.plan_label)}`, {
      cancellation: cancellationRows(rules, own.length ? null : defNoShow),
      cancellationNote: own.length ? '' : str(def.body),
      children: children.rows,
      childrenNote: children.note
    });
  }
  return out;
}
