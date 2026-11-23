// 出張シェフ・予約一覧（設計: hp-pchef docs/design.md 5章 2・5）。既定は仮予約と確定。
import type { PageServerLoad } from './$types';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { CHEF_FACILITY_ID, chefDb, chefErrorMessage, type ChefReservation } from '$lib/server/chef';

const FILTERS: Record<string, string[] | null> = {
	active: ['requested', 'confirmed'],
	requested: ['requested'],
	confirmed: ['confirmed'],
	paid: ['paid'],
	declined: ['declined'],
	cancelled: ['cancelled'],
	all: null
};

export type ChefListItem = Pick<
	ChefReservation,
	'id' | 'date' | 'start_time' | 'status' | 'name' | 'adults' | 'children' | 'infants' | 'style' | 'area' | 'payment_method' | 'amount_total' | 'created_at' | 'slot_id'
> & { chef_name: string };

export const load: PageServerLoad = async (event) => {
	const raw = event.url.searchParams.get('status') ?? 'active';
	const status = raw in FILTERS ? raw : 'active';
	const base = { status, items: [] as ChefListItem[], unavailable: null as string | null };
	if (!ADMIN_SUPABASE) return { ...base, unavailable: '出張シェフは Supabase 接続時のみ使えます。' };
	const db = chefDb(createSupabaseServerClient(event));
	let q = db
		.from('reservations')
		.select('id,date,start_time,status,name,adults,children,infants,style,area,payment_method,amount_total,created_at,slot_id,slots(chef_name)')
		.eq('facility_id', CHEF_FACILITY_ID);
	const states = FILTERS[status];
	if (states) q = q.in('status', states);
	// 対応中は利用日の近い順、それ以外（終わったもの）は新しい順
	q = status === 'active' || status === 'requested' || status === 'confirmed' ? q.order('date').order('created_at') : q.order('date', { ascending: false });
	const { data, error } = await q.limit(300);
	if (error) return { ...base, unavailable: chefErrorMessage(error.message) };
	const items = (data ?? []).map((row) => {
		const { slots, ...rest } = row as unknown as Record<string, unknown> & { slots: { chef_name: string } | null };
		return { ...rest, chef_name: slots?.chef_name ?? '' } as ChefListItem;
	});
	return { ...base, items };
};
