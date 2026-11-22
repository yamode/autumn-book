// 施設ナレッジ（docs/facility-knowledge.md）の、画面とサーバーで共通に使う定義。
// DB は book.facility_facts / book.facility_stories（autumn-shared 20261122064509_book_facility_knowledge.sql）。

export type Visibility = 'public' | 'press' | 'internal';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type StoryTopic = 'bath' | 'view' | 'meal' | 'experience' | 'location' | 'room' | 'history' | 'staff' | 'other';
/** 一覧に出す状態。AI に渡るのは verified だけ */
export type KnowledgeStatus = 'verified' | 'unverified' | 'expired' | 'upcoming';

export const VISIBILITY_LABEL: Record<Visibility, string> = {
	public: 'お客様向け',
	press: '取材・広報まで',
	internal: '社内のみ'
};
export const VISIBILITY_HINT: Record<Visibility, string> = {
	public: 'お問い合わせの回答・FAQ・HP にも使う',
	press: '取材の回答・プレスリリースには使うが、お客様への回答には使わない',
	internal: 'AI の生成には使わない'
};
export const SEASON_LABEL: Record<Season, string> = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
export const TOPIC_LABEL: Record<StoryTopic, string> = {
	bath: 'お風呂',
	view: '景色',
	meal: '料理',
	experience: '体験',
	location: '場所・立地',
	room: '客室',
	history: '歴史',
	staff: '人',
	other: 'その他'
};
export const STATUS_LABEL: Record<KnowledgeStatus, string> = {
	verified: '承認済み',
	unverified: '未承認',
	expired: '期限切れ',
	upcoming: '期間前'
};

/**
 * よく使う事実の項目。ここに無いキーも登録できる（英小文字・数字・_ を . でつなぐ）。
 * 料金・空室・客室数はプラン・PMS が正本なので、ここには置かない（設計書 §3.1）。
 */
export const FACT_KEYS: { key: string; label: string; group: string }[] = [
	{ key: 'basic.official_name', label: '正式名称', group: '基本' },
	{ key: 'basic.address', label: '住所', group: '基本' },
	{ key: 'basic.tel', label: '電話', group: '基本' },
	{ key: 'basic.url', label: '公式サイト', group: '基本' },
	{ key: 'basic.closed_days', label: '定休日', group: '基本' },
	{ key: 'stay.checkin', label: 'チェックイン', group: '滞在' },
	{ key: 'stay.checkout', label: 'チェックアウト', group: '滞在' },
	{ key: 'access.train', label: 'アクセス（電車）', group: 'アクセス' },
	{ key: 'access.car', label: 'アクセス（車）', group: 'アクセス' },
	{ key: 'access.pickup', label: '送迎', group: 'アクセス' },
	{ key: 'parking', label: '駐車場', group: 'アクセス' },
	{ key: 'spring.name', label: '温泉名', group: '温泉' },
	{ key: 'spring.quality', label: '泉質', group: '温泉' },
	{ key: 'spring.flow', label: '源泉の使い方（掛け流し・加温・加水）', group: '温泉' },
	{ key: 'spring.character', label: '湯の色・香り・肌ざわり', group: '温泉' },
	{ key: 'spring.effects', label: '効能', group: '温泉' },
	{ key: 'meal.dinner_style', label: '夕食の形式', group: '料理' },
	{ key: 'meal.dinner_place', label: '夕食の場所', group: '料理' },
	{ key: 'meal.breakfast', label: '朝食', group: '料理' },
	{ key: 'meal.chef', label: '料理長', group: '料理' }
];
const FACT_LABEL = new Map(FACT_KEYS.map((k) => [k.key, k.label]));
export function factLabel(key: string): string {
	return FACT_LABEL.get(key) ?? key;
}

export const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/** 承認・期間から、いま AI に渡るかどうかの状態を決める（DB の facility_knowledge_usable と同じ条件。today は日本時間の YYYY-MM-DD） */
export function knowledgeStatus(
	item: { verifiedAt: string | null; validFrom: string | null; validUntil: string | null },
	today: string
): KnowledgeStatus {
	if (item.validUntil && item.validUntil < today) return 'expired';
	if (item.validFrom && item.validFrom > today) return 'upcoming';
	return item.verifiedAt ? 'verified' : 'unverified';
}

/** 日本時間の今日（YYYY-MM-DD） */
export function tokyoToday(now = new Date()): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);
}

// ---- 写真の権利（段階6・book.photo_rights） ----
export const PHOTO_RIGHTS = ['own', 'licensed', 'unknown'] as const;
export type PhotoRights = (typeof PHOTO_RIGHTS)[number];
export const PHOTO_RIGHTS_LABEL: Record<PhotoRights, string> = { own: '自社で撮影', licensed: '使用の許諾あり', unknown: '不明' };
export const PHOTO_USAGES = ['web', 'press', 'print', 'ad'] as const;
export type PhotoUsage = (typeof PHOTO_USAGES)[number];
export const PHOTO_USAGE_LABEL: Record<PhotoUsage, string> = { web: '自社サイト・SNS', press: '取材・広報', print: '印刷物', ad: '広告' };
/** 人の写り込み（has_people と people_consent の組み合わせ） */
export type PhotoPeople = 'unchecked' | 'none' | 'consented' | 'no_consent';
export const PHOTO_PEOPLE_LABEL: Record<PhotoPeople, string> = {
	unchecked: '未確認',
	none: '人は写っていない',
	consented: '写っている（許可あり）',
	no_consent: '写っている（許可なし）'
};
/** 一覧の状態。press_ok は DB の book.photo_press_ok と同じ条件 */
export type PhotoStatus = 'press_ok' | 'checked' | 'unchecked';
export const PHOTO_STATUS_LABEL: Record<PhotoStatus, string> = { press_ok: '取材に出せる', checked: '確認済み（取材は不可）', unchecked: '未確認' };
export function photoStatus(r: { rights: PhotoRights; usageScope: readonly string[]; hasPeople: boolean | null; peopleConsent: boolean | null }): PhotoStatus {
	if (r.rights === 'unknown' || r.hasPeople === null) return 'unchecked';
	if (r.usageScope.includes('press') && (r.hasPeople === false || r.peopleConsent === true)) return 'press_ok';
	return 'checked';
}
