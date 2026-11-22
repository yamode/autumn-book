// 施設ナレッジの外部向け API（GET /api/knowledge/{facility}）の中身。docs/facility-knowledge.md 段階5。
// taskul-social のプレスリリース AI など、ほかのアプリがサーバー側から読む。鍵（KNOWLEDGE_API_KEY）で守る。
// 返すのは承認済み・日本時間で期間内・公開範囲が scope の内側（public / press）だけ。internal（社内のみ）は決して返さない。
import { FACT_KEYS, SEASON_LABEL, TOPIC_LABEL, factLabel, tokyoToday, type Season, type StoryTopic } from '$lib/facility-knowledge';
import { FACILITY_UUID } from '$lib/server/supabase-data';

export type KnowledgeScope = 'public' | 'press';

/** API の施設名。taskul-social のプレスリリースの掲載先タグ（yamado / oga）でも引けるようにする */
export const KNOWLEDGE_FACILITIES: Record<string, { uuid: string; slug: string; name: string }> = {
	nishiwaga: { uuid: FACILITY_UUID['f-nishiwaga'], slug: 'nishiwaga', name: '山人-yamado-' },
	yamado: { uuid: FACILITY_UUID['f-nishiwaga'], slug: 'nishiwaga', name: '山人-yamado-' },
	oga: { uuid: FACILITY_UUID['f-oga'], slug: 'oga', name: '山人-oga-' }
};
export function knowledgeFacility(slug: string) {
	return Object.prototype.hasOwnProperty.call(KNOWLEDGE_FACILITIES, slug) ? KNOWLEDGE_FACILITIES[slug] : null;
}
export function parseScope(v: string | null): KnowledgeScope | null {
	if (v == null || v === '' || v === 'press') return 'press';
	if (v === 'public') return 'public';
	return null; // internal などは受け付けない
}

/** book.facility_knowledge_usable の1行 */
export type UsableRow = {
	kind: 'fact' | 'story';
	id: string;
	topic: string;
	title: string | null;
	body: string;
	visibility: string;
	valid_from: string | null;
	valid_until: string | null;
	verified_at: string | null;
};

const ORDER = new Map(FACT_KEYS.map((k, i) => [k.key, i]));

/** DB の行を API の形にする。念のためここでも scope の外・未承認を落とす */
export function shapeKnowledge(
	facility: { slug: string; name: string },
	scope: KnowledgeScope,
	rows: UsableRow[],
	seasonsById: Record<string, string[]>,
	now = new Date()
) {
	const allowed = scope === 'public' ? ['public'] : ['public', 'press'];
	const ok = rows.filter((r) => allowed.includes(r.visibility) && !!r.verified_at && r.body?.trim());
	const facts = ok
		.filter((r) => r.kind === 'fact')
		.sort((a, b) => (ORDER.get(a.topic) ?? 999) - (ORDER.get(b.topic) ?? 999) || a.topic.localeCompare(b.topic))
		.map((r) => ({
			key: r.topic,
			label: factLabel(r.topic),
			value: r.body.trim(),
			visibility: r.visibility,
			...(r.valid_until ? { valid_until: r.valid_until } : {})
		}));
	const stories = ok
		.filter((r) => r.kind === 'story')
		.map((r) => {
			const seasons = (seasonsById[r.id] ?? []).filter((s): s is Season => s in SEASON_LABEL);
			return {
				topic: r.topic,
				topic_label: TOPIC_LABEL[r.topic as StoryTopic] ?? r.topic,
				title: r.title ?? '',
				body: r.body.trim(),
				visibility: r.visibility,
				...(seasons.length ? { seasons, seasons_label: seasons.map((s) => SEASON_LABEL[s]).join('・') } : {}),
				...(r.valid_until ? { valid_until: r.valid_until } : {})
			};
		});
	return {
		facility: { slug: facility.slug, name: facility.name },
		scope,
		as_of: tokyoToday(now),
		generated_at: now.toISOString(),
		facts,
		stories,
		note:
			'施設が承認した現在の施設情報です（日本時間 as_of 時点で有効なものだけ）。料金・空室は含みません。' +
			(scope === 'press' ? ' visibility が press のものは取材・広報向けで、お客様への個別の回答には使わないでください。' : '')
	};
}
