import { redirect } from '@sveltejs/kit';
import { localizeHref } from '$lib/paraglide/runtime';
import { ensureStayCookie, resolvePrecheckin } from '$lib/server/precheckin';
import { ciGoPath, ciGoTarget } from '$lib/precheckin-p3';
import type { RequestHandler } from './$types';

// 事前チェックインから客室案内（/r）・貸切風呂（/r/bath）へ（P3・docs/pre-checkin.md §6）。
// ?to=bath | inroom。回答済み・チェックイン日 12:00 より前なら滞在トークンを Cookie（ab_stay）に入れてから移る。
// 受け取れないとき（期限後・未回答など）もそのまま移る: 既に Cookie のある端末はそのまま開け、無ければ
// 各画面の 6 桁コード入力になる（客室スリップのコード）。
export const GET: RequestHandler = async (event) => {
	const to = ciGoTarget(event.url.searchParams.get('to'));
	const r = await resolvePrecheckin(event);
	if ('ctx' in r) await ensureStayCookie(event.cookies, r.token);
	redirect(303, localizeHref(ciGoPath(to)));
};
