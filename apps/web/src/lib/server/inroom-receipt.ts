import { recordReceiptDelivery } from './inroom-receipt-tracking';
// 客室案内のオンライン決済の領収書（2026-11-07）。台帳（book.inroom_payments）から1枚分を組み立て、PDF にして
// ダウンロード・メール送信する。お客様の滞在（Cookie の滞在トークン）に紐づく決済だけ出せる。
import { partnerServiceClient } from './partners/admin-client';
import { loadInvoiceIssuer, contentDisposition, DEFAULT_ISSUER_NAME } from './partners/invoices';
import { renderHtmlPdf } from './partners/invoice-pdf';
import { sendHtmlEmail } from './mailer';
import { FACILITY_UUID, reverseFacilityUuid } from './supabase-data';
import { facilities } from './store';
import { retrievePaymentIntent } from './stripe';
import {
	RECEIPT_PROVISO,
	inroomReceiptNo,
	foldBathTax,
	normalizeAddressee,
	receiptFileName,
	renderInroomReceiptHtml,
	type InroomReceiptDoc,
	type ReceiptStatement,
	type ReceiptStatementBill
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
	payment_intent_id: string | null;
	allocations: Array<{ bill_id?: string }> | null;
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
		.select('id, facility_id, token_id, stay_id, payment_intent_id, allocations, room_code, guest_name, amount, status, paid_at')
		.eq('token_id', tokenId)
		.in('status', ['paid', 'partially_refunded'])
		.not('paid_at', 'is', null);
	if (paymentId) q = q.eq('id', paymentId);
	const { data, error } = await q.order('paid_at', { ascending: false }).limit(1);
	if (error || !data?.length) return null;
	return data[0] as PaymentRow;
}

/** 台帳 ID から決済を引く（決済確定時の自動送信用。滞在の確認は呼び出し側で済んでいる） */
async function findPaymentById(id: string): Promise<PaymentRow | null> {
	const { data, error } = await db()
		.schema('book')
		.from('inroom_payments')
		.select('id, facility_id, token_id, stay_id, payment_intent_id, allocations, room_code, guest_name, amount, status, paid_at')
		.eq('id', id)
		.maybeSingle();
	return error || !data ? null : (data as PaymentRow);
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

/** 決済画面で入れた宛名の既定（顧客マスタの領収書名義 → フルネーム → 滞在コードのお名前）。滞在トークンの滞在から引く */
export async function defaultAddresseeForToken(tokenId: string, tokenGuestName?: string | null): Promise<string> {
	try {
		const { data } = await db().schema('book').from('stay_access_tokens').select('stay_id').eq('id', tokenId).maybeSingle();
		const fromMaster = await guestReceiptAddressee((data as { stay_id?: string | null } | null)?.stay_id ?? null);
		return normalizeAddressee(fromMaster) || normalizeAddressee(tokenGuestName);
	} catch {
		return normalizeAddressee(tokenGuestName);
	}
}

/**
 * 宛名の決め方: 画面の指定（addresseeInput）→ 決済画面で入れた宛名（PaymentIntent の metadata receipt_name）→
 * 顧客マスタの領収書名義／フルネーム → 滞在コードのお名前。
 */
/**
 * 2ページ目のご利用明細。今回の決済の充当先の請求書（allocations）の明細と、お支払い済みの内訳を PMS（pms.bill_items / bill_payments）から引く。
 * 入湯税は PMS の請求書と同じく1行に畳む。引けなければ null（1ページ目だけ出す）。
 */
export async function loadReceiptStatement(p: PaymentRow): Promise<ReceiptStatement | null> {
	try {
		const billIds = [...new Set((p.allocations ?? []).map((a) => a.bill_id).filter((v): v is string => !!v && RECEIPT_ID_RE.test(v)))];
		if (!billIds.length) return null;
		const pms = db().schema('pms');
		const [billsRes, itemsRes, paysRes, methodsRes] = await Promise.all([
			pms.from('bills').select('id, bill_no').in('id', billIds),
			pms.from('bill_items').select('bill_id, effective_date, item_name, quantity, unit_price, sort_order, created_at').in('bill_id', billIds).order('effective_date', { ascending: true, nullsFirst: false }).order('sort_order', { ascending: true }).order('created_at', { ascending: true }).limit(2000),
			pms.from('bill_payments').select('bill_id, payment_method_id, amount, payment_date, note, source, created_at').in('bill_id', billIds).order('payment_date', { ascending: true }).order('created_at', { ascending: true }).limit(500),
			pms.from('payment_methods').select('id, name').eq('facility_id', p.facility_id).limit(200)
		]);
		if (billsRes.error || itemsRes.error) return null;
		const billNo = new Map(((billsRes.data ?? []) as Array<{ id: string; bill_no: number | null }>).map((b) => [b.id, b.bill_no]));
		const methodName = new Map(((methodsRes.data ?? []) as Array<{ id: string; name: string }>).map((m) => [m.id, m.name]));
		const out: ReceiptStatementBill[] = [];
		let from: string | null = null;
		let to: string | null = null;
		for (const id of billIds) {
			const raw = ((itemsRes.data ?? []) as Array<{ bill_id: string; effective_date: string | null; item_name: string; quantity: number; unit_price: number }>)
				.filter((i) => i.bill_id === id)
				.map((i) => ({
					date: i.effective_date,
					name: i.item_name,
					unitPrice: Number(i.unit_price ?? 0),
					quantity: Number(i.quantity ?? 0),
					amount: Math.round(Number(i.unit_price ?? 0) * Number(i.quantity ?? 0))
				}));
			for (const i of raw) {
				if (i.date && (!from || i.date < from)) from = i.date;
				if (i.date && (!to || i.date > to)) to = i.date;
			}
			const { items, bathTax } = foldBathTax(raw);
			const total = items.reduce((a, i) => a + i.amount, 0) + (bathTax?.amount ?? 0);
			const payments = ((paysRes.data ?? []) as Array<{ bill_id: string; payment_method_id: string | null; amount: number; payment_date: string | null; note: string | null; source: string | null }>)
				// 機械の穴埋めの現地入金（[自動]）はお客様の支払ではないので出さない（客室案内の明細と同じ）
				.filter((x) => x.bill_id === id && !((x.note ?? '').startsWith('[自動]') && x.source !== 'book_inroom'))
				.map((x) => ({
					date: x.payment_date,
					method: x.source === 'book_inroom' ? '客室内オンライン決済' : (x.payment_method_id ? (methodName.get(x.payment_method_id) ?? '') : ''),
					amount: Number(x.amount ?? 0)
				}));
			out.push({ billNo: billNo.get(id) ?? null, items, bathTax, total, payments });
		}
		return { stayFrom: from, stayTo: to, bills: out };
	} catch {
		return null;
	}
}

export async function buildReceiptDoc(p: PaymentRow, addresseeInput: string | null): Promise<InroomReceiptDoc> {
	let entered = normalizeAddressee(addresseeInput);
	if (!entered && p.payment_intent_id) {
		entered = normalizeAddressee((await retrievePaymentIntent(p.payment_intent_id).catch(() => null))?.metadata?.receipt_name);
	}
	const issuer = await loadInvoiceIssuer(db(), TENANT_ID).catch(() => null);
	const bookFacility = reverseFacilityUuid(p.facility_id) ?? p.facility_id;
	const contact = FACILITY_CONTACT[bookFacility];
	const facilityName = facilities.find((f) => (FACILITY_UUID[f.id] ?? f.id) === p.facility_id)?.name ?? '';
	const paidAt = p.paid_at ?? new Date().toISOString();
	const statement = await loadReceiptStatement(p);
	return {
		statement,
		receiptNo: inroomReceiptNo(p.id, paidAt),
		addressee: entered || normalizeAddressee(await guestReceiptAddressee(p.stay_id)) || normalizeAddressee(p.guest_name),
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

/**
 * 決済が確定したとき、お客様がメールアドレスを入れていれば宛名入りの領収書 PDF を自動で送る（2026-11-07 指示）。
 * 失敗しても決済は止めない（ログに残すだけ。お客様は完了画面のダウンロードボタンからも取れる）。
 */
export async function autoSendInroomReceipt(paymentId: string, email: string, name: string): Promise<void> {
	try {
		const p = await findPaymentById(paymentId);
		if (!p || !['paid', 'partially_refunded'].includes(p.status)) return;
		const doc = await buildReceiptDoc(p, name);
		const r = await sendReceiptEmail(doc, email);
		if (r === 'sent') await recordReceiptDelivery(paymentId, 'email');
		if (r !== 'sent') console.warn('[inroom-receipt] 領収書メールを送れませんでした', r, paymentId);
	} catch (e) {
		console.error('[inroom-receipt] 自動送信に失敗', e instanceof Error ? e.message : e);
	}
}
