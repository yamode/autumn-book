// 事前チェックインの「宿への通知」の純関数（DB に触らない・単体テスト: precheckin-notify.test.ts）。
//
// お客様が回答を完了した（② お食事の時間を送信した）とき・あとから直したときに、施設の代表メールへ送る通知メールの中身と、
// 管理画面の通知設定（book.admin_precheckin_notify の戻り）の整形。
// DB: autumn-shared 20261115012421_book_precheckin_review_notify.sql
//   - book.precheckin_notify_begin(p_token) … 確認待ちにして、メールを送るか（mail）・宛先（to）・中身を返す
//   - book.admin_precheckin_notify(p_facility) / book.admin_precheckin_save_notify(p_facility, p_email, p_enabled)
import type { PcAnswers, PcMealType } from '$lib/precheckin';

export type PcNotifyKind = 'answered' | 'updated';

/** 通知メールに入れるもの（precheckin_notify_begin の戻りから作る） */
export type PrecheckinNotifyMailInput = {
	kind: PcNotifyKind;
	facilityName: string;
	guestName: string;
	bookingCode: string | null;
	checkIn: string;
	nights: number;
	answers: PcAnswers;
	/** Book の管理画面の詳細（/admin/precheckin/<stay_id>…） */
	adminUrl: string;
};

/** precheckin_notify_begin の戻り（使う分だけ） */
export type PrecheckinNotifyBegin = {
	ok: boolean;
	notified: boolean;
	kind: PcNotifyKind;
	mail: boolean;
	to: string | null;
	stayId: string | null;
	facilityId: string | null;
	facilityName: string;
	facilitySlug: string | null;
	guestName: string;
	bookingCode: string | null;
	checkIn: string;
	checkOut: string;
	nights: number;
	answers: PcAnswers;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** precheckin_notify_begin の戻り（jsonb）を整える。形が違えば ok:false */
export function normalizeNotifyBegin(data: unknown): PrecheckinNotifyBegin {
	const r = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
	const answers = (r.answers && typeof r.answers === 'object' ? r.answers : {}) as PcAnswers;
	return {
		ok: r.ok === true,
		notified: r.notified === true,
		kind: r.kind === 'updated' ? 'updated' : 'answered',
		mail: r.mail === true,
		to: str(r.to) || null,
		stayId: str(r.stay_id) || null,
		facilityId: str(r.facility_id) || null,
		facilityName: str(r.facility_name),
		facilitySlug: str(r.facility_slug) || null,
		guestName: str(r.guest_name),
		bookingCode: str(r.booking_code) || null,
		checkIn: str(r.check_in).slice(0, 10),
		checkOut: str(r.check_out).slice(0, 10),
		nights: Number(r.nights) || 1,
		answers
	};
}

/** 管理画面の通知設定。email = 上書きの宛先（空なら default_email = 施設の代表アドレスへ送る） */
export type PrecheckinNotifySettings = { email: string | null; enabled: boolean; defaultEmail: string | null };

export function normalizeNotifySettings(data: unknown): PrecheckinNotifySettings {
	const r = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
	return { email: str(r.email) || null, enabled: r.enabled !== false, defaultEmail: str(r.default_email) || null };
}

/** 宛先の形（DB の admin_precheckin_save_notify と同じ規則。空欄は「代表アドレスへ」なので通す） */
export function isNotifyEmail(s: string): boolean {
	const v = s.trim();
	return v === '' || (v.length <= 254 && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v));
}

// ---------------------------------------------------------------- メールの中身

const esc = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

function parts(d: string): { y: number; m: number; day: number; dow: number } | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
	if (!m) return null;
	const [y, mo, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
	return { y, m: mo, day, dow: new Date(Date.UTC(y, mo - 1, day)).getUTCDay() };
}
/** 2026-11-20 → 11/20 */
export const md = (d: string) => {
	const p = parts(d);
	return p ? `${p.m}/${p.day}` : d;
};
/** 2026-11-20 → 11/20（金） */
const mdDow = (d: string) => {
	const p = parts(d);
	return p ? `${p.m}/${p.day}（${DOW_JA[p.dow]}）` : d;
};
/** 2026-11-20 → 2026年11月20日（金） */
const dateJa = (d: string) => {
	const p = parts(d);
	return p ? `${p.y}年${p.m}月${p.day}日（${DOW_JA[p.dow]}）` : d;
};

const MEAL_LABEL: Record<PcMealType, string> = { dinner: '夕食', breakfast: '朝食' };

/** 件名（初回の回答／あとからの修正） */
export function precheckinNotifySubject(kind: PcNotifyKind, guestName: string, checkIn: string): string {
	const name = guestName.trim() || 'お客様';
	return kind === 'updated'
		? `【事前チェックイン・修正】${name} 様（${md(checkIn)}ご到着）の内容が変更されました`
		: `【事前チェックイン】${name} 様（${md(checkIn)}ご到着）の回答が届きました`;
}

/** お客様が直した・入れた欄（値のあるものだけ・この順） */
export function changedFields(a: PcAnswers): { label: string; value: string }[] {
	const c = a.contact ?? {};
	const g = a.guest ?? {};
	const out: { label: string; value: string }[] = [];
	const add = (label: string, v: unknown) => {
		const s = str(v);
		if (s) out.push({ label, value: s });
	};
	// 姓・名に分けた欄があればそれを出す（無ければ、つなげた氏名）
	if (str(c.family_name) || str(c.given_name)) {
		add('氏名（姓）', c.family_name);
		add('氏名（名）', c.given_name);
	} else add('氏名', c.name);
	if (str(c.family_name_kana) || str(c.given_name_kana)) {
		add('フリガナ（セイ）', c.family_name_kana);
		add('フリガナ（メイ）', c.given_name_kana);
	} else add('フリガナ', c.name_kana);
	add('電話', c.phone);
	add('メール', c.email);
	add('郵便番号', g.zip);
	add('住所', g.address);
	add('生年月日', g.birthdate);
	add('領収書宛名', g.receipt_name);
	return out;
}

/** 食事の時間（日付・夕食→朝食の順。複数室で同じ時間は 1 行にまとめる） */
export function mealLines(a: PcAnswers): string[] {
	const rows = (a.meals ?? [])
		.filter((m) => m && m.time && (m.type === 'dinner' || m.type === 'breakfast'))
		.map((m) => ({ key: `${m.date}|${m.type === 'dinner' ? 0 : 1}|${m.time}`, line: `${mdDow(m.date)} ${MEAL_LABEL[m.type]} ${m.time}` }))
		.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
	return [...new Set(rows.map((r) => r.line))];
}

export function buildPrecheckinNotifyMail(i: PrecheckinNotifyMailInput): { subject: string; text: string; html: string } {
	const a = i.answers ?? {};
	const subject = precheckinNotifySubject(i.kind, i.guestName, i.checkIn);
	const name = i.guestName.trim() || 'お客様';
	const lead =
		i.kind === 'updated'
			? 'お客様が事前チェックインの内容を変更しました。'
			: 'お客様から事前チェックインの回答が届きました。';
	const fields = changedFields(a);
	const meals = mealLines(a);
	const questions = (a.questions ?? []).filter((q) => q && (str(q.question) || str(q.answer)));
	const note = str(a.note);
	const arrival = str(a.arrival_time);

	const summary: [string, string][] = [
		['施設', i.facilityName],
		['お客様', `${name} 様`],
		...(i.bookingCode ? ([['予約番号', i.bookingCode]] as [string, string][]) : []),
		['ご宿泊', `${dateJa(i.checkIn)} から ${i.nights}泊`],
		['到着予定時刻', arrival || '（未入力）']
	];
	const footer = 'PMS の予約詳細で内容を確認し、顧客情報へ反映してください。';

	// ---- テキスト
	const t: string[] = [lead, '', ...summary.map(([k, v]) => `${k}: ${v}`), ''];
	t.push('■ お客様が直した・入れた欄');
	t.push(...(fields.length ? fields.map((f) => `${f.label}: ${f.value}`) : ['（変更なし）']), '');
	t.push('■ 食事の時間');
	t.push(...(meals.length ? meals : ['（なし）']), '');
	if (questions.length) {
		t.push('■ 宿からの質問');
		for (const q of questions) t.push(`Q. ${str(q.question)}`, `A. ${str(q.answer) || '（未回答）'}`);
		t.push('');
	}
	t.push('■ 備考');
	t.push(note || '（なし）', '');
	t.push(footer, i.adminUrl);
	const text = t.join('\n');

	// ---- HTML（値はすべてエスケープ）
	const th = 'text-align:left;padding:4px 12px 4px 0;color:#78716c;font-weight:normal;white-space:nowrap;vertical-align:top';
	const td = 'padding:4px 0;white-space:pre-wrap;word-break:break-all';
	const table = (rows: [string, string][]) =>
		`<table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><th style="${th}">${esc(k)}</th><td style="${td}">${esc(v)}</td></tr>`).join('')}</table>`;
	const h2 = (s: string) => `<h3 style="margin:20px 0 6px;font-size:14px;border-bottom:1px solid #e7e5e4;padding-bottom:4px">${esc(s)}</h3>`;
	const empty = (s: string) => `<p style="margin:4px 0;color:#a8a29e">${esc(s)}</p>`;
	const html = [
		'<div style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#1c1917;max-width:600px">',
		`<p style="margin:0 0 12px;font-weight:bold">${esc(lead)}</p>`,
		table(summary),
		h2('お客様が直した・入れた欄'),
		fields.length ? table(fields.map((f) => [f.label, f.value])) : empty('（変更なし）'),
		h2('食事の時間'),
		meals.length ? meals.map((l) => `<p style="margin:2px 0">${esc(l)}</p>`).join('') : empty('（なし）'),
		questions.length
			? h2('宿からの質問') +
				questions
					.map((q) => `<p style="margin:6px 0 0;color:#57534e">Q. ${esc(str(q.question))}</p><p style="margin:0 0 6px;white-space:pre-wrap">A. ${esc(str(q.answer) || '（未回答）')}</p>`)
					.join('')
			: '',
		h2('備考'),
		note ? `<p style="margin:4px 0;white-space:pre-wrap">${esc(note)}</p>` : empty('（なし）'),
		`<p style="margin:24px 0 8px">${esc(footer)}</p>`,
		`<p style="margin:0"><a href="${esc(i.adminUrl)}" style="display:inline-block;background:#1c1917;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">管理画面で回答を見る</a></p>`,
		`<p style="font-size:12px;color:#78716c;word-break:break-all">${esc(i.adminUrl)}</p>`,
		'</div>'
	].join('');
	return { subject, text, html };
}

/** 管理画面の詳細の URL（施設は ?facility=<core.facilities.id> で指定。詳細の画面がその施設に切り替える） */
export function precheckinAdminUrl(origin: string, stayId: string, facilityId: string | null): string {
	return `${origin}/admin/precheckin/${encodeURIComponent(stayId)}${facilityId ? `?facility=${encodeURIComponent(facilityId)}` : ''}`;
}
