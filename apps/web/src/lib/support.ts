// 会員サポート（support@yamado.app・ヘルプページ /help・管理画面 /admin/support）の共通部品。
// 設計: docs/member-support.md。DB: autumn-shared 20261121224620_book_member_support.sql。
// 画面（お客様側・管理画面）とサーバの両方から使う純関数だけを置く（サーバ専用は lib/server/member-support.ts）。

/** 窓口のアドレス（返信の From・Reply-To） */
export const SUPPORT_EMAIL = 'support@yamado.app';
/** 返信メールの差出人名 */
export const SUPPORT_FROM_NAME = 'YAMADO サポート';
/** ヘルプページ（会員向けメールの「お問い合わせ先」に載せる） */
export const SUPPORT_HELP_URL = 'https://book.yamado.app/help';
/**
 * 会員向けメールの末尾に足す「お問い合わせ先」の 1 行。
 * mailEnabled（SUPPORT_MAIL_ENABLED='true'＝support@ の受信が動いている）のときだけアドレスを載せ、そうでなければヘルプページだけ
 */
export function supportContactLine(mailEnabled: boolean): string {
	return mailEnabled ? `お問い合わせ: ${SUPPORT_EMAIL}（${SUPPORT_HELP_URL}）` : `お問い合わせ: ヘルプページのフォーム（${SUPPORT_HELP_URL}）`;
}

/** 件名・名前などの 1 行の値: 改行などの制御文字を空白にし、続く空白を 1 つにまとめる（メールのヘッダに改行を入れさせない） */
export function oneLine(value: string | null | undefined): string {
	return String(value ?? '')
		.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** お問い合わせの種類（book.support_tickets.category / support_faqs.category） */
export const SUPPORT_CATEGORIES = ['login', 'legacy', 'booking', 'points', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** 管理画面での表示名（お客様側は paraglide の support_category_*） */
export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
	login: 'ログイン・会員登録',
	legacy: '旧会員の移行',
	booking: 'ご予約',
	points: 'ポイント・会員ランク',
	other: 'その他'
};

export const isSupportCategory = (v: unknown): v is SupportCategory =>
	typeof v === 'string' && (SUPPORT_CATEGORIES as readonly string[]).includes(v);

export const supportCategoryLabel = (v: string | null | undefined) =>
	isSupportCategory(v) ? SUPPORT_CATEGORY_LABELS[v] : v || 'その他';

/** 状態（open 対応中 / waiting お客様の返事待ち / closed 完了） */
export const SUPPORT_STATUSES = ['open', 'waiting', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
	open: '対応中',
	waiting: '返事待ち',
	closed: '完了'
};
export const isSupportStatus = (v: unknown): v is SupportStatus =>
	typeof v === 'string' && (SUPPORT_STATUSES as readonly string[]).includes(v);

/** 件名の問い合わせ番号（DB の book._support_code_in と同じ取り出し方） */
export function supportCodeIn(subject: string | null | undefined): string | null {
	const hit = /\[(YS-[A-Za-z0-9]{6})\]/.exec(subject ?? '');
	return hit ? hit[1].toUpperCase() : null;
}

/**
 * 宿の返信の件名: 「Re: <件名> [YS-XXXXXX]」。
 * 件名がすでに Re: / RE: / 返信: で始まるなら Re: を重ねない。番号がすでに入っていれば足さない。件名が空なら「お問い合わせ」。
 */
export function supportReplySubject(subject: string | null | undefined, code: string): string {
	let s = oneLine(subject);
	// 古い番号（別の問い合わせのもの）が残っていたら外して、この問い合わせの番号を付け直す
	const existing = supportCodeIn(s);
	if (existing && existing !== code.toUpperCase()) s = s.replace(/\s*\[YS-[A-Za-z0-9]{6}\]\s*/gi, ' ').trim();
	if (!s) s = 'お問い合わせ';
	if (!/^(re|ｒｅ)\s*[:：]/i.test(s)) s = `Re: ${s}`;
	return supportCodeIn(s) ? s : `${s} [${code}]`;
}

/** 受付の控えメールの件名 */
export const supportAckSubject = (code: string) => `【YAMADO】お問い合わせを受け付けました [${code}]`;

/**
 * 本文を「本文」と「引用（前のメールの写し）」に分ける（画面で引用を折りたたむため・保存はそのまま）。
 * 引用の始まり: 「>」で始まる行、「On … wrote:」、「20xx/xx/xx … :」「… のメッセージ:」「-----Original Message-----」など。
 * 始まりの行から後ろを全部引用とみなす（返信の下に前のメールが付く形が大半のため）。
 */
export function splitQuoted(body: string): { main: string; quoted: string } {
	const lines = (body ?? '').replace(/\r\n?/g, '\n').split('\n');
	const isStart = (l: string) =>
		/^\s*>/.test(l) ||
		/^\s*On .+wrote:\s*$/i.test(l) ||
		/^\s*-{2,}\s*(Original Message|元のメッセージ|Forwarded message)/i.test(l) ||
		/^\s*\d{4}[/年.-]\d{1,2}[/月.-]\d{1,2}.*(wrote|書きました|のメッセージ)\s*[:：]?\s*$/.test(l) ||
		/(さんは書きました|のメッセージ)\s*[:：]\s*$/.test(l);
	// 「…:」で終わり、次の行が「>」で始まる行（Gmail の「2026年11月22日(日) 10:00 名前 <addr>:」など）も引用の見出し
	const isHeader = (l: string, i: number) => /[:：]\s*$/.test(l) && /^\s*>/.test(lines[i + 1] ?? '');
	const idx = lines.findIndex((l, i) => isHeader(l, i) || isStart(l));
	if (idx <= 0) {
		// 先頭から引用（本文が無い）なら全部を本文として見せる
		return { main: lines.join('\n').trim(), quoted: '' };
	}
	return { main: lines.slice(0, idx).join('\n').trim(), quoted: lines.slice(idx).join('\n').trim() };
}

/** デモ（DATA_SOURCE=demo）のよくある質問。DB の初期データ（migration）と同じ内容 */
export type SupportFaq = { id: string; category: string; question: string; answer: string };
export const DEMO_SUPPORT_FAQS: SupportFaq[] = [
	{ id: 'demo-1', category: 'login', question: 'ログインの確認コードが届きません', answer: '迷惑メールのフォルダをご確認ください。携帯電話のメールをお使いの場合は、yamado.app からのメールを受け取れるよう設定してください。数分たっても届かないときは、もう一度コードを送ってください。' },
	{ id: 'demo-2', category: 'login', question: 'パスワードを忘れました', answer: 'ログイン画面でメールアドレスを入力し、届く確認コードでログインできます。ログイン後、マイページのプロフィールから新しいパスワードを設定できます。' },
	{ id: 'demo-3', category: 'login', question: '登録したメールアドレスを変えたい', answer: 'マイページのプロフィールから変更できます。新しいアドレスに届く確認コードを入力すると変更が完了します。' },
	{ id: 'demo-4', category: 'legacy', question: '以前の予約サイトの会員でした。新しい会員になるには？', answer: 'ログイン画面の「旧会員の方（会員移行）」から、以前ご登録のメールアドレスを入力してください。届くメールのリンクから、お手続きいただけます。これまでの公式サイト・お電話でのご宿泊は、新しい会員ランクに反映します。' },
	{ id: 'demo-5', category: 'legacy', question: '会員移行の案内メールが届きません', answer: '以前の予約サイトにご登録のメールアドレスと違うアドレスを入力されたかもしれません。迷惑メールのフォルダもご確認ください。それでも届かないときは、このページの下のフォームからお問い合わせください。' },
	{ id: 'demo-6', category: 'booking', question: '予約の確認・変更・取消はどこでできますか', answer: '会員の方はマイページの「予約」から、確認・変更・取消ができます。会員でない方は「ご予約の確認」から、予約番号とメールアドレスで確認できます。' },
	{ id: 'demo-7', category: 'booking', question: '予約サイト（旅行会社など）で予約した分はマイページに出ますか', answer: '旅行会社・予約サイト経由のご予約は、マイページには表示されません。変更・取消はご予約されたサイトでお手続きください。' },
	{ id: 'demo-8', category: 'points', question: 'ポイントはいつ付きますか', answer: 'ご宿泊後、チェックアウトの翌日以降に付きます。マイページの「ポイント」で確認できます。' },
	{ id: 'demo-9', category: 'points', question: '会員ランクはどう決まりますか', answer: '公式サイトとお電話でのご宿泊の回数・泊数で決まります。旅行会社・予約サイト経由のご宿泊は数えません。' },
	{ id: 'demo-10', category: 'other', question: '退会したい', answer: 'マイページのプロフィールから退会できます。退会すると、ポイントと会員ランクは消えます。' }
];

/** よくある質問をカテゴリの順（SUPPORT_CATEGORIES の順・知らないカテゴリは最後）にまとめる */
export function groupFaqs<T extends { category: string }>(faqs: readonly T[]): { category: string; items: T[] }[] {
	const order = (c: string) => {
		const i = (SUPPORT_CATEGORIES as readonly string[]).indexOf(c);
		return i < 0 ? SUPPORT_CATEGORIES.length : i;
	};
	const map = new Map<string, T[]>();
	for (const f of faqs) {
		const list = map.get(f.category) ?? [];
		list.push(f);
		map.set(f.category, list);
	}
	return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0])).map(([category, items]) => ({ category, items }));
}

/** 送信中（結果の記録が無い）の返信を送り直せるまでの時間。早すぎる再送で二重に届くのを避ける */
export const RESEND_SENDING_AFTER_MS = 5 * 60 * 1000;

/**
 * 返信を「再送」できるか: 送れなかった（failed）ものはいつでも、送信中（sending）のものは作成から 5 分たってから。送信済みは不可。
 * sending は送信の途中で落ちたなど「届いているかもしれない」ので、画面で確かめてから送る
 */
export function canResendReply(msg: { send_status: string | null; created_at: string }, now: number = Date.now()): boolean {
	if (msg.send_status === 'failed') return true;
	if (msg.send_status !== 'sending') return false;
	const created = Date.parse(msg.created_at);
	return Number.isFinite(created) && now - created >= RESEND_SENDING_AFTER_MS;
}
