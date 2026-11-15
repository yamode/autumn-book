import { dev } from '$app/environment';
import { cancelPolicyLabel } from '@autumn-book/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answerLines, resolveRoomGenders } from '$lib/booking-questions';
import { resolveStandardFields } from '$lib/booking-standard-fields';
import { ONSITE_METHOD_NOTE, ONSITE_METHODS } from '$lib/direct-payment';
import { resolveStandardAnswers } from '$lib/server/booking-questions';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { STAY_FACILITIES } from '$lib/server/stay-calendar';
import { normalizeCancellationPolicy } from '$lib/server/supabase-data';
import type { bookingAccess } from './oauth';
import { searchBookingOffers, validCheckin } from './search';
import html from './onsite-card.html?raw';
import script from 'virtual:yamado-booking-ui';

const CARD_URI = 'ui://yamado/onsite-booking.html';
const CARD_MIME = 'text/html;profile=mcp-app';
const DEBUG = dev;
const uuid = z.string().uuid();
const receipt = z.object({ status: z.literal('confirmed'), bookingCode: z.string().min(1) });
const review = z.object({
	status: z.literal('review'), id: uuid, expiresAt: z.string(), contactName: z.string(), email: z.string(),
	lodging: z.number().int().positive(), bathTax: z.number().int().nonnegative(),
	planName: z.string(), roomName: z.string(), facilityName: z.string(),
	onsiteMethods: z.array(z.enum(ONSITE_METHODS)).nonempty(),
	policy: z.unknown(), fields: z.unknown(), form: z.object({ ask_gender: z.boolean() })
});

type Access = NonNullable<Awaited<ReturnType<typeof bookingAccess>>>;

function result(status: string, message: string, data: Record<string, unknown> = {}, meta?: Record<string, unknown>) {
	return {
		content: [{ type: 'text' as const, text: message }],
		structuredContent: { status, message, ...data },
		...(meta ? { _meta: meta } : {})
	};
}

export function registerOnsiteBooking(server: McpServer, origin: string, access: Access) {
	const db = partnerServiceClient()?.schema('book');
	if (!db) throw new Error('Booking MCP storage is unavailable');
	server.registerResource('yamado-onsite-review', CARD_URI, { mimeType: CARD_MIME }, () => ({
		contents: [{
			uri: CARD_URI, mimeType: CARD_MIME,
			text: html.replace('<!-- client -->', () => '<script>' + script.replace(/<\/script/gi, '<\\/script') + '</script>'),
			_meta: { ui: { csp: {}, prefersBorder: true } }
		}]
	}));
	server.registerTool('prepare_onsite_booking', {
		title: '現地払い予約の確認カードを開く',
		description: '利用者が選んだ現地払いプランについて、届いた検索結果のIDと同じ検索条件から確認カードを開きます。確定前に本人がカード上で条件を確認します。このツールでは在庫の確保や予約の確定は行いません。',
		inputSchema: {
			facility: z.enum(STAY_FACILITIES), planId: uuid, roomId: uuid,
			checkin: z.string().length(10).refine(validCheckin),
			nights: z.number().int().min(1).max(7), adults: z.number().int().min(1).max(6)
		},
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
		_meta: { ui: { resourceUri: CARD_URI } }
	}, async ({ planId, roomId, ...query }) => {
		try {
			const search = await searchBookingOffers(origin, query, access.viewer, true);
			const offer = search.facilities[0]?.offers.find((offer) => offer.planId === planId && offer.roomId === roomId);
			if (!offer) return result('unavailable', 'この候補は確認できません。空室を検索し直してください。');
			const bookingUrl = offer.bookingUrl;
			const secret = [...crypto.getRandomValues(new Uint8Array(32))].map((n) => n.toString(16).padStart(2, '0')).join('');
			const { data, error } = await db.rpc('prepare_mcp_onsite_booking', {
				p_user: access.userId, p_access_hash: access.accessHash, p_secret: secret,
				p_facility: search.facilities[0].id, p_plan: planId, p_room: roomId,
				p_checkin: query.checkin, p_nights: query.nights, p_adults: query.adults
			});
			if (error) throw error;
			const checked = review.safeParse(data);
			if (!checked.success) return result('book_required', 'この条件での予約は山人Bookでお手続きください。', { bookingUrl });
			const { id, expiresAt, contactName, email, policy, fields, form, ...details } = checked.data;
			const cancellation = normalizeCancellationPolicy(policy);
			const rules = [...cancellation.rules].filter(({ rate }) => rate > 0).sort((a, b) => b.days_before - a.days_before)
				.map(({ days_before, rate }) => `${days_before === 0 ? '当日' : `${days_before}日前から`}：宿泊料金の${Math.round(rate * 100)}％`);
			return result('review', 'お客様が確認カードで予約内容をご確認のうえ、確定してください。カードが表示されない場合は山人Bookでお手続きください。', { bookingUrl }, {
				review: {
					...details, ...query, id, secret, expiresAt, contactName, email, bookingUrl,
					termsUrl: origin + '/legal/yakkan',
					cancellation: [cancelPolicyLabel(cancellation, query.checkin), ...rules, cancellation.note].filter(Boolean).join('\n'),
					fields: resolveStandardFields(fields), askGender: form.ask_gender
				}
			});
		} catch {
			if (DEBUG) console.warn('[DBG booking-mcp] prepare review failed');
			return result('error', '確認カードを用意できませんでした。空室検索の予約リンクから山人Bookでお手続きください。');
		}
	});

	server.registerTool('confirm_onsite_booking', {
		title: '現地払いの宿泊予約を確定',
		description: '確認カードの同意と確定ボタンから、現地払いの予約を1件作成します。',
		inputSchema: {
			reviewId: uuid, secret: z.string().regex(/^[a-f0-9]{64}$/), agreed: z.literal(true),
			onsiteMethod: z.enum(ONSITE_METHODS), arrival: z.string().max(40),
			transport: z.string().max(40), transportOther: z.string().max(60), pickup: z.string().max(40),
			male: z.string().max(1)
		},
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
		_meta: { ui: { visibility: ['app'] } }
	}, async (input) => {
		try {
			const { data: row, error: lookupError } = await db.from('booking_mcp_reviews')
				.select('snapshot, adults, booking_code').eq('id', input.reviewId).eq('user_id', access.userId).maybeSingle();
			if (lookupError) throw lookupError;
			if (!row) return result('closed', '確認カードを開き直してください。');

			const { contactSignature: _signature, ...snapshot } = row.snapshot;
			const fields = resolveStandardFields(snapshot.fields);
			const answers = { onsitePayment: input.onsiteMethod, notes: '' };
			if (!row.booking_code) {
				if (!snapshot.onsiteMethods.includes(input.onsiteMethod)) return result('invalid', '現地でのお支払い方法を選び直してください。');
				if (input.arrival && !fields.arrival.choices.includes(input.arrival)) return result('invalid', '到着予定時刻を選び直してください。');
				const form = new FormData();
				form.set('transport', input.transport);
				form.set('transport_other', input.transportOther);
				form.set('pickup_time', input.pickup);
				const standard = resolveStandardAnswers(form, fields);
				if (!standard.ok) return result('invalid', standard.message);
				const genders = snapshot.form.ask_gender ? resolveRoomGenders([row.adults], (key) => key === 'male_0' ? input.male : null) : null;
				if (genders && !genders.ok) return result('invalid', '宿泊人数の内訳を選んでください。');
				Object.assign(answers, genders?.rooms[0], {
					arrival: input.arrival, requests: standard.values,
					notes: [ONSITE_METHOD_NOTE[input.onsiteMethod], answerLines(standard.values)].filter(Boolean).join(' ')
				});
			}
			const { data, error } = await db.rpc('confirm_mcp_onsite_booking', {
				p_user: access.userId, p_access_hash: access.accessHash, p_review: input.reviewId,
				p_secret: input.secret, p_validated_snapshot: snapshot, p_answers: answers, p_onsite_method: input.onsiteMethod
			});
			if (error) {
				if (['forbidden', 'review_expired', 'review_changed', 'onsite_not_allowed', 'not_sellable', 'min_stay_violation', 'plan_not_found', 'room_not_found'].includes(error.message) ||
					error.message.startsWith('sold_out:')) {
					return result('closed', '確認期限が切れたか、空室・料金・予約条件が変わりました。空室を検索し直してください。');
				}
				throw error;
			}
			const confirmed = receipt.parse(data);
			return result('confirmed', 'ご予約が確定しました。', {}, { bookingCode: confirmed.bookingCode });
		} catch {
			if (DEBUG) console.warn('[DBG booking-mcp] confirm review failed');
			return result('retry', '確定結果を取得できませんでした。同じ確認カードから再試行してください。');
		}
	});
}
