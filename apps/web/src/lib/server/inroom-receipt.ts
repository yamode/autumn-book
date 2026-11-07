// 客室案内のオンライン決済の領収書（2026-11-07）。台帳（book.inroom_payments）から1枚分を組み立て、PDF にして
// ダウンロード・メール送信する。お客様の滞在（Cookie の滞在トークン）に紐づく決済だけ出せる。
import { partnerServiceClient } from './partners/admin-client';
import { loadInvoiceIssuer, contentDisposition, DEFAULT_ISSUER_NAME } from './partners/invoices';
import { renderHtmlPdf } from './partners/invoice-pdf';
import { sendHtmlEmail } from './mailer';
import { FACILITY_UUID, reverseFacilityUuid } from './supabase-data';
import { facilities } from './store';
import {
	RECEIPT_PROVISO,
	inroomReceiptNo,
	normalizeAddressee,
	receiptFileName,
	renderInroomReceiptHtml,
	type InroomReceiptDoc
} from '$lib/inroom-receipt';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 施設の住所・TEL（請求書の施設見出しと同じ値）
const FACILITY_CONTACT: Record<string, { address: string; tel: string }> = {
	'f-nishiwaga': { address: '〒029-5514 岩手県和賀郡西和賀町湯川52-71-10', tel: '0197-82-2222' },
	'f-oga': { address: '〒010-0531 秋田県男鹿市船川港台島字鵜ノ崎62-29', tel: '0185-47-7776' }
};

type PaymentRow = {
	id: string;
	facility_id: string;
	token_id: string | null;
	room_code: string | null;
	guest_name: string | null;
	stay_id: string | null;
	amount: number;
	status: string;
	paid_at: string | null;
};

function db() {
	const c = partnerServiceClient();
	if (!c) throw new Error('unavailable');
	return c;
}

const RECEIPT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * この滞在で領収書を出せる決済を探す。id を渡せばその決済、無ければ最新の決済。
 * 他の滞在の決済・未決済・全額返金済みは null（領収書は出さない）。
 */
export async function findReceiptPayment(tokenId: string, paymentId: string | null): Promise<PaymentRow | null> {
	if (paymentId && !RECEIPT_ID_RE.test(paymentId)) return null;
	let q = db()
		.schema('book')
		.from('inroom_payments')
		.select('id, facility_id, token_id, stay_id, room_code, guest_name, amount, status, paid_at')
		.eq('token_id', tokenId)
		.in('status', ['paid', 'partially_refunded'])
		.not('paid_at', 'is', null);
	if (paymentId) q = q.eq('id', paymentId);
	const { data, error } = await q.order('paid_at', { ascending: false }).limit(1);
	if (error || !data?.length) return null;
	return data[0] as PaymentRow;
}

/** 決済確定直後に、Stripe の決済番号から台帳 ID を引く（領収書ボタンに渡す） */
export async function paymentIdOfIntent(tokenId: string, intentId: string): Promise<string | null> {
	if (!/^pi_[A-Za-z0-9]+$/.test(intentId)) return null;
	const { data } = await db().schema('book').from('inroom_payments').select('id').eq('payment_intent_id', intentId).eq('token_id', tokenId).maybeSingle();
	return (data as { id?: string } | null)?.id ?? null;
}

/**
 * 領収書の宛名の既定（2026-11-07 指示）。PMS の顧客マスタ（core.guests）の「領収書名義」(receipt_address) があればそれ、
 * 無ければ顧客のフルネーム（姓 名。無ければ氏名・法人名）。顧客は PMS の請求書と同じ決め方
 * （予約グループの代表者 → 無ければ滞在の顧客）。引けなければ null（呼び出し側が滞在コードのお名前に落とす）。
 */
export async function guestReceiptAddressee(stayId: string | null): Promise<string | null> {
	if (!stayId) return null;
	try {
		const c = db();
		const { data: stay } = await c.schema('core').from('stays').select('guest_id, stay_group_id').eq('id', stayId).maybeSingle();
		const st = stay as { guest_id?: string | null; stay_group_id?: string | null } | null;
		if (!st) return null;
		let guestId = st.guest_id ?? null;
		if (st.stay_group_id) {
			const { data: grp } = await c.schema('pms').from('stay_groups').select('representative_guest_id').eq('id', st.stay_group_id).maybeSingle();
			guestId = (grp as { representative_guest_id?: string | null } | null)?.representative_guest_id ?? guestId;
		}
		if (!guestId) return null;
		const { data: g } = await c
			.schema('core')
			.from('guests')
			.select('name, family_name, given_name, corporate_name, receipt_address')
			.eq('id', guestId)
			.maybeSingle();
		const r = g as { name?: string | null; family_name?: string | null; given_name?: string | null; corporate_name?: string | null; receipt_address?: string | null } | null;
		if (!r) return null;
		return (
			r.receipt_address?.trim() ||
			[r.family_name, r.given_name].filter(Boolean).join(' ').trim() ||
			r.name?.trim() ||
			r.corporate_name?.trim() ||
			null
		);
	} catch {
		return null;
	}
}

export async function buildReceiptDoc(p: PaymentRow, addresseeInput: string | null): Promise<InroomReceiptDoc> {
	const issuer = await loadInvoiceIssuer(db(), TENANT_ID).catch(() => null);
	const bookFacility = reverseFacilityUuid(p.facility_id) ?? p.facility_id;
	const contact = FACILITY_CONTACT[bookFacility];
	const facilityName = facilities.find((f) => (FACILITY_UUID[f.id] ?? f.id) === p.facility_id)?.name ?? '';
	const paidAt = p.paid_at ?? new Date().toISOString();
	return {
		receiptNo: inroomReceiptNo(p.id, paidAt),
		addressee: normalizeAddressee(addresseeInput) || normalizeAddressee(await guestReceiptAddressee(p.stay_id)) || normalizeAddressee(p.guest_name),
		amount: p.amount,
		paidAt,
		proviso: RECEIPT_PROVISO,
		facilityName,
		room: p.room_code,
		issuerName: issuer?.issuerName ?? DEFAULT_ISSUER_NAME,
		issuerAddress: contact?.address ?? issuer?.issuerAddress ?? '',
		issuerTel: contact?.tel ?? issuer?.issuerTel ?? '',
		registrationNumber: issuer?.registrationNumber ?? ''
	};
}

/** 領収書の PDF。作れなければ null（Browser Rendering 未設定・失敗） */
export function renderReceiptPdf(doc: InroomReceiptDoc): Promise<Uint8Array | null> {
	return renderHtmlPdf(renderInroomReceiptHtml(doc), doc.receiptNo, { timeoutMs: 30_000 });
}

export function receiptPdfResponse(doc: InroomReceiptDoc, pdf: Uint8Array): Response {
	return new Response(new Uint8Array(pdf), {
		headers: {
			'content-type': 'application/pdf',
			'content-length': String(pdf.byteLength),
			'content-disposition': contentDisposition('attachment', receiptFileName(doc)),
			'cache-control': 'no-store'
		}
	});
}

export type SendReceiptResult = 'sent' | 'invalid_email' | 'pdf_failed' | 'send_failed';

/** 領収書の PDF をメールで送る */
export async function sendReceiptEmail(doc: InroomReceiptDoc, emailRaw: string): Promise<SendReceiptResult> {
	const email = emailRaw.trim();
	if (!EMAIL_RE.test(email) || email.length > 200) return 'invalid_email';
	const pdf = await renderReceiptPdf(doc);
	if (!pdf) return 'pdf_failed';
	const from = doc.facilityName ? `${doc.facilityName}` : doc.issuerName;
	const subject = `【${from}】領収書（${doc.receiptNo}）`;
	const text = [
		doc.addressee ? `${doc.addressee} 様` : 'お客様',
		'',
		'客室案内でのオンライン決済の領収書をお送りします（PDF を添付しています）。',
		'',
		`領収書番号: ${doc.receiptNo}`,
		`金額: ¥${doc.amount.toLocaleString('ja-JP')}（税込）`,
		'',
		`${from}`,
		'',
		'※ このメールは自動で送っています。お心当たりが無い場合は破棄してください。'
	].join('\n');
	const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
	const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#1c1917">${text
		.split('\n')
		.map((l) => (l ? `<p style="margin:0">${esc(l)}</p>` : '<p style="margin:0">&nbsp;</p>'))
		.join('')}</div>`;
	const r = await sendHtmlEmail({
		to: [email],
		subject,
		text,
		html,
		fromName: from,
		attachments: [{ filename: receiptFileName(doc), type: 'application/pdf', content: pdf }]
	});
	return r.sent ? 'sent' : 'send_failed';
}
