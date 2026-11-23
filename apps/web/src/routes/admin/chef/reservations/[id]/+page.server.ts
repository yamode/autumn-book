// 出張シェフ・予約詳細（設計: hp-pchef docs/design.md 5章 2〜4）。
// 操作は chef.admin_reservation_action（revision で競合を検知）。確定・お断り・取消のあとはお客さまへメールを送り、
// 送れなかったら画面に警告を出す（操作自体は成功のまま）。
// - confirm：オンライン決済で期限（利用日の3日前）を過ぎていると DB が pay_deadline_passed を返す。画面でも前もって注意を出す。
// - to_onsite：仮予約・確定のオンライン決済を現地払いに切り替える。確定済みならお客さまにメールし、決済画面を閉じる。
// - cancel：支払い前（confirmed）で決済画面（stripe_session_id）があれば Stripe で閉じる（失敗は警告だけ）。
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { CHEF_FACILITY_ID, chefDb, chefErrorMessage, closeChefCheckout, sendChefMail, type ChefEvent, type ChefReservation } from '$lib/server/chef';
import { chefCancelFee, chefPayDeadlinePassed } from '$lib/chef';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async (event) => {
	if (!ADMIN_SUPABASE) return { unavailable: '出張シェフは Supabase 接続時のみ使えます。', item: null, events: [] as ChefEvent[], chefName: '', cancelGuide: null, payDeadlinePassed: false };
	if (!UUID.test(event.params.id)) error(404, '予約が見つかりません。');
	const db = chefDb(createSupabaseServerClient(event));
	const { data, error: e } = await db.from('reservations').select('*, slots(chef_name)').eq('id', event.params.id).maybeSingle();
	if (e) return { unavailable: chefErrorMessage(e.message), item: null, events: [] as ChefEvent[], chefName: '', cancelGuide: null, payDeadlinePassed: false };
	if (!data || data.facility_id !== CHEF_FACILITY_ID) error(404, '予約が見つかりません。');
	const { slots, ...item } = data as ChefReservation & { slots: { chef_name: string } | null };
	const { data: events } = await db.from('events').select('*').eq('reservation_id', item.id).order('created_at', { ascending: false });
	return {
		unavailable: null,
		item: item as ChefReservation,
		chefName: slots?.chef_name ?? '',
		events: (events ?? []) as ChefEvent[],
		// 取消のキャンセル料の目安（利用日までの日数で 0／25／50／100%）
		cancelGuide: chefCancelFee(item.amount_total, item.date),
		// オンライン決済の期限（利用日の3日前）を過ぎたか。過ぎていれば確定できない（DB も pay_deadline_passed で止める）
		payDeadlinePassed: chefPayDeadlinePassed(item)
	};
};

export const actions: Actions = {
	default: async (event) => {
		if (!ADMIN_SUPABASE) return fail(503, { message: '出張シェフは Supabase 接続時のみ使えます。' });
		if (!['admin', 'staff'].includes(event.locals.user?.role ?? '')) return fail(403, { message: 'スタッフとしてログインしてください。' });
		if (!UUID.test(event.params.id)) return fail(404, { message: '予約が見つかりません。' });
		const form = await event.request.formData();
		const action = String(form.get('action') ?? '');
		const revision = Number(form.get('revision'));
		const reason = String(form.get('reason') ?? '').trim();
		const note = String(form.get('staff_note') ?? '');
		if (!['confirm', 'decline', 'cancel', 'onsite_paid', 'to_onsite', 'note'].includes(action) || !Number.isInteger(revision)) return fail(400, { message: '入力を確かめてください。' });
		if ((action === 'decline' || action === 'cancel') && !reason) return fail(400, { action, message: '理由を入力してください。', reason });
		if (reason.length > 1000) return fail(400, { action, message: '理由は1,000文字以内で入力してください。', reason });
		if (note.length > 2000) return fail(400, { action, message: '社内メモは2,000文字以内で入力してください。' });

		let cancelFee: number | null = null;
		if (action === 'cancel') {
			const raw = String(form.get('cancel_fee') ?? '').replace(/[,，円\s]/g, '');
			cancelFee = Number(raw);
			if (raw === '' || !Number.isInteger(cancelFee) || cancelFee < 0) return fail(400, { action, message: 'キャンセル料は0以上の整数（円）で入力してください。', reason });
		}

		const db = chefDb(createSupabaseServerClient(event));
		// 操作前の状態（取消・現地払いへの切り替えのあとに決済画面を閉じるか・メールを送るかの判断に使う）。
		// revision が送られてきたものと同じときだけ、RPC が成功した＝この状態から操作した、と言える
		const { data: current } = await db.from('reservations').select('facility_id,amount_total,status,revision,stripe_session_id').eq('id', event.params.id).maybeSingle();
		if (!current || current.facility_id !== CHEF_FACILITY_ID) return fail(404, { message: '予約が見つかりません。' });
		if (cancelFee !== null && cancelFee > current.amount_total) return fail(400, { action, message: 'キャンセル料が予約の金額を超えています。', reason });

		const { data, error: e } = await db.rpc('admin_reservation_action', {
			p_id: event.params.id,
			p_revision: revision,
			p_action: action,
			p_reason: reason,
			p_cancel_fee: cancelFee,
			// 社内メモはメモの保存のときだけ渡す（ほかの操作では null＝そのまま）
			p_note: action === 'note' ? note : null
		});
		if (e) return fail(e.message.includes('conflict') ? 409 : 400, { action, message: chefErrorMessage(e.message), reason });

		const done: Record<string, string> = {
			confirm: '確定しました。',
			decline: 'お断りしました。枠はまた空きました。',
			cancel: '取り消しました。枠はまた空きました。',
			onsite_paid: '現地での受領を記録しました。',
			to_onsite: 'お支払い方法を当日現地払いに切り替えました。',
			note: '社内メモを保存しました。'
		};
		const after = data as ChefReservation;
		const wasConfirmed = current.revision === revision && current.status === 'confirmed';
		const warnings: string[] = [];
		// 支払い前の決済画面を閉じる（取消・確定済みの現地払いへの切り替え）。開いたままだと後から払えてしまう
		if ((action === 'cancel' || action === 'to_onsite') && wasConfirmed && current.stripe_session_id) {
			const w = await closeChefCheckout({ id: after.id, stripe_session_id: current.stripe_session_id as string });
			if (w) warnings.push(w);
		}
		let mailed = false;
		// 仮予約の現地払いへの切り替えはメールしない（確定のメールで現地払いと伝わる）
		if (action === 'confirm' || action === 'decline' || action === 'cancel' || (action === 'to_onsite' && wasConfirmed)) {
			const w = await sendChefMail(action, after);
			if (w) warnings.push(w);
			else mailed = true;
		}
		return { ok: true, action, message: done[action] + (mailed ? ' お客さまにメールを送りました。' : ''), warning: warnings.length ? warnings.join('\n') : null };
	}
};
