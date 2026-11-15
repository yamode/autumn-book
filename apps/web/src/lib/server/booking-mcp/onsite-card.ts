import { App } from '@modelcontextprotocol/ext-apps';
import { TRANSPORT_OTHER, type StandardFieldTexts } from '$lib/booking-standard-fields';
import type { OnsiteMethod } from '$lib/direct-payment';

interface Review {
	id: string;
	secret: string;
	expiresAt: string;
	facilityName: string;
	planName: string;
	roomName: string;
	checkin: string;
	nights: number;
	adults: number;
	lodging: number;
	bathTax: number;
	contactName: string;
	email: string;
	onsiteMethods: OnsiteMethod[];
	cancellation: string;
	fields: StandardFieldTexts;
	askGender: boolean;
	bookingUrl: string;
	termsUrl: string;
}

const METHODS: Record<OnsiteMethod, string> = { cash: '現金', card: 'クレジットカード', paypay: 'PayPay' };
const app = new App({ name: 'YAMADO', version: '1.0.0' });
const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const status = node('status');
const form = node<HTMLFormElement>('booking');
const confirm = node<HTMLButtonElement>('confirm');
const select = (name: string) => form.elements.namedItem(name) as HTMLSelectElement;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
const jpy = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });
const dateTime = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
let review: Review | undefined;
let sending = false;

function link(id: string, url: string) {
	const link = node<HTMLAnchorElement>(id);
	link.href = url;
	link.onclick = (event) => {
		event.preventDefault();
		void app.openLink({ url }).catch(() => { status.textContent = 'リンクを開けませんでした。'; });
	};
}

function options(name: string, values: readonly string[], blank: string, labels?: Record<string, string>) {
	select(name).replaceChildren(new Option(blank, ''), ...values.map((value) => new Option(labels?.[value] ?? value, value)));
}

function updateFields() {
	if (!review) return;
	const transport = select('transport').value;
	const pickup = select('pickup');
	pickup.required = transport === review.fields.pickup.when && review.fields.pickup.choices.length > 0;
	pickup.hidden = !pickup.required;
	const other = field('transportOther');
	other.required = transport === TRANSPORT_OTHER;
	other.hidden = !other.required;
	const male = select('male').value;
	node('gender').textContent = review.askGender && male ? `女性 ${review.adults - Number(male)}名` : '';
}

function showReview(data: Review) {
	review = data;
	const checkout = new Date(data.checkin + 'T00:00:00Z');
	checkout.setUTCDate(checkout.getUTCDate() + data.nights);
	const details = node('details');
	details.replaceChildren();
	for (const [label, value] of [
		['施設', data.facilityName], ['プラン', data.planName], ['客室', data.roomName],
		['宿泊日', `${data.checkin} ～ ${checkout.toISOString().slice(0, 10)}（${data.nights}泊）`],
		['人数', `大人${data.adults}名・1室`], ['宿泊料金', jpy.format(data.lodging)],
		['入湯税', jpy.format(data.bathTax)], ['現地でのお支払い合計', jpy.format(data.lodging + data.bathTax)],
		['予約者', data.contactName], ['確認メール', data.email]
	]) {
		const name = document.createElement('dt');
		name.textContent = label;
		const description = document.createElement('dd');
		description.textContent = value;
		details.append(name, description);
	}
	node('policy').textContent = data.cancellation;
	node('deadline').textContent = `確認期限 ${dateTime.format(new Date(data.expiresAt))}（日本時間）`;
	link('terms', data.termsUrl);
	link('bookLink', data.bookingUrl);
	node('book').hidden = false;
	form.reset();
	options('onsiteMethod', data.onsiteMethods, '選択してください', METHODS);
	for (const name of ['arrival', 'transport', 'pickup'] as const) {
		options(name, data.fields[name].choices, name === 'arrival' ? '未定' : '選択してください');
		node(name + 'Label').textContent = data.fields[name].label;
	}
	select('transport').required = data.fields.transport.required === true;
	options('male', Array.from({ length: data.adults + 1 }, (_, i) => String(i)), '選択してください');
	select('male').hidden = !data.askGender;
	select('male').required = data.askGender;
	updateFields();
	node('summary').hidden = false;
	status.textContent = '宿泊内容をご確認ください。食事の配慮やポイント・クーポンの利用をご希望の場合は山人Bookでお手続きください。';
}

app.ontoolresult = (result) => {
	const data = result._meta?.review as Review | undefined;
	if (data && !review) {
		showReview(data);
	} else if (!review) {
		const fallback = result.structuredContent as { message?: string; bookingUrl?: string } | undefined;
		status.textContent = String(fallback?.message ?? '確認カードを読み込めませんでした。');
		if (typeof fallback?.bookingUrl === 'string') {
			link('bookLink', fallback.bookingUrl);
			node('book').hidden = false;
		}
	}
};

form.onchange = updateFields;
form.onsubmit = async (event) => {
	event.preventDefault();
	if (!event.isTrusted || !review || sending || !field('agreed').checked) return;
	sending = true;
	confirm.disabled = true;
	node('book').hidden = true;
	status.textContent = '山人Bookで予約を確定しています…';
	try {
		const result = await app.callServerTool({
			name: 'confirm_onsite_booking',
			arguments: {
				reviewId: review.id, secret: review.secret, agreed: true, onsiteMethod: select('onsiteMethod').value,
				arrival: select('arrival').value, transport: select('transport').value,
				transportOther: field('transportOther').hidden ? '' : field('transportOther').value,
				pickup: select('pickup').hidden ? '' : select('pickup').value, male: select('male').value
			}
		});
		const outcome = result.structuredContent as { status: string; message: string } | undefined;
		if (!outcome) throw new Error('Missing YAMADO booking status');
		status.textContent = String(outcome.message);
		if (outcome.status === 'confirmed') {
			if (typeof result._meta?.bookingCode !== 'string') throw new Error('Missing YAMADO booking code');
			const receipt = node('receipt');
			receipt.textContent = `予約番号 ${result._meta.bookingCode}`;
			receipt.hidden = false;
			form.hidden = true;
		} else if (outcome.status === 'closed') {
			form.hidden = true;
			node('book').hidden = false;
		} else if (outcome.status === 'invalid') {
			node('book').hidden = false;
		}
	} catch {
		status.textContent = '確定結果を取得できませんでした。同じボタンでもう一度お試しください。';
	} finally {
		sending = false;
		confirm.disabled = false;
	}
};

void app.connect().catch(() => {
	status.textContent = '確認カードに接続できませんでした。空室検索の予約リンクから山人Bookでお手続きください。';
});
