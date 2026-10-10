<script lang="ts">
	// 予約かごのバー（公式の複数室予約・docs/official-multi-room.md §8.1・M1）。
	//   画面下に固定。「N室・大人M名・合計 ¥」「内訳」「予約へ進む」。内訳は下から出るシート（部屋を外す・かごを空にする）。
	//   「予約へ進む」はかごの施設のプラン詳細の ?/hold に rooms JSON を送り、全室を一括で仮押さえする（成功は予約入力へ）。
	//   失敗（満室・回数制限・支払方法）は理由をバーの上に出し、かごはそのまま残す。
	//   4 室入っているときはバーの上に「1 回のご予約は 4 室まで…」を出す。
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { cartGroups, cartIsFull, cartRoomsPayload, cartSummary, MAX_ROOMS_PER_BOOKING, type CartItem } from '$lib/multi-room';
	import { formatDateLong, formatPrice } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	let {
		items = $bindable(),
		message = $bindable(''),
		currentFacilityId,
		back,
		via,
		turnstileToken,
		turnstileReset = () => {}
	}: {
		items: CartItem[];
		/** バーの上に出す案内（追加したとき・止めたときの理由）。空なら出さない */
		message?: string;
		currentFacilityId: string;
		/** 予約入力の「選び直す」で戻る先（このページ） */
		back: string;
		via: string;
		turnstileToken: () => string | undefined;
		/** 失敗のあとに Turnstile のトークンを取り直す（1回限りのトークンを使い回して2回目が必ず失敗しないように） */
		turnstileReset?: () => void;
	} = $props();

	let open = $state(false);
	let busy = $state(false);
	let summary = $derived(cartSummary(items));
	let groups = $derived(cartGroups(items));
	let full = $derived(cartIsFull(items));
	let first = $derived(items[0]);
	let action = $derived(first ? `/${first.brandSlug}/${first.facilitySlug}/plans/${first.planSlug}?/hold` : '');
	let fullNotice = $derived(m.cart_full_notice({ max: String(MAX_ROOMS_PER_BOOKING), next: String(MAX_ROOMS_PER_BOOKING + 1) }));

	function remove(key: string) {
		items = items.filter((c) => c.key !== key);
		message = '';
		if (items.length === 0) open = false;
	}
	function clear() {
		items = [];
		message = '';
		open = false;
	}

	// 送信: 別ページ（かごの施設のプラン詳細）の action なので、失敗の結果は自分でバーに出す（form には入らない）
	const submit: SubmitFunction = ({ formData }) => {
		const token = turnstileToken();
		if (token) formData.set('cf-turnstile-response', token);
		busy = true;
		message = '';
		return async ({ result }) => {
			busy = false;
			if (result.type !== 'redirect') turnstileReset();
			if (result.type === 'redirect') {
				await goto(result.location);
				return;
			}
			if (result.type === 'failure') {
				const d = (result.data ?? {}) as { message?: string; soldOut?: { roomName: string }[] };
				const names = (d.soldOut ?? []).map((s) => s.roomName).filter(Boolean);
				message = names.length ? m.cart_sold_out({ rooms: [...new Set(names)].join('・') }) : (d.message ?? m.pay_el_failed());
				return;
			}
			message = m.pay_el_failed();
		};
	};
</script>

{#if items.length > 0 && first}
	<div class="fixed inset-x-0 bottom-0 z-50 border-t border-stone-200 bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.10)] backdrop-blur">
		<div class="mx-auto max-w-5xl px-4 py-2.5">
			{#if full}
				<p class="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">{fullNotice}</p>
			{/if}
			{#if message && !(full && message === fullNotice)}
				<p class="mb-2 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-700" role="status">{message}</p>
			{/if}
			{#if first.facilityId !== currentFacilityId && first.facilityName}
				<p class="mb-1 text-xs text-stone-500">{m.cart_other_page({ facility: first.facilityName })}</p>
			{/if}

			{#if open}
				<!-- 内訳（下から出るシート）: 部屋を外す・かごを空にする -->
				<div class="mb-2 max-h-[50vh] overflow-y-auto rounded-xl border border-stone-200 bg-white p-3 text-sm">
					<div class="flex items-center justify-between">
						<p class="font-medium text-brand-900">{m.cart_heading()}</p>
						<button type="button" onclick={() => (open = false)} class="text-xs text-stone-500 hover:underline">{m.cart_close()}</button>
					</div>
					<p class="mt-0.5 text-xs text-stone-500">{m.cart_bar_stay({ date: formatDateLong(first.checkin), nights: String(first.nights) })}</p>
					<ul class="mt-2 divide-y divide-stone-100">
						{#each groups as g (g.keys[0])}
							<li class="flex items-start justify-between gap-2 py-2">
								<div class="min-w-0">
									<p class="text-stone-800">
										{m.cart_room_line({ room: g.item.roomName, plan: g.item.planName, adults: String(g.item.adults) })}
										{#if g.count > 1}<span class="ml-1 font-medium">×{g.count}</span>{/if}
									</p>
									<p class="text-xs tabular-nums text-stone-500">{formatPrice(g.item.total * g.count)}</p>
								</div>
								<!-- 同じ部屋を複数入れていれば 1 室ずつ外す -->
								<button type="button" onclick={() => remove(g.keys[g.keys.length - 1])} class="shrink-0 rounded-md border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50">{m.cart_remove()}</button>
							</li>
						{/each}
					</ul>
					<button type="button" onclick={clear} class="mt-1 text-xs text-red-600 hover:underline">{m.cart_clear()}</button>
				</div>
			{/if}

			<div class="flex items-center gap-2">
				<button type="button" onclick={() => (open = !open)} class="min-w-0 flex-1 text-left leading-tight" aria-expanded={open}>
					<p class="truncate text-sm font-bold text-brand-900">
						{m.cart_bar_summary({ rooms: String(summary.rooms), adults: String(summary.adults), total: formatPrice(summary.total) })}
					</p>
					<p class="text-[11px] text-accent-600 underline underline-offset-2">{m.cart_bar_detail()}</p>
				</button>
				<form method="POST" {action} use:enhance={submit} class="shrink-0">
					<input type="hidden" name="rooms" value={JSON.stringify(cartRoomsPayload(items))} />
					<input type="hidden" name="checkin" value={first.checkin} />
					<input type="hidden" name="nights" value={first.nights} />
					<input type="hidden" name="back" value={back} />
					<input type="hidden" name="via" value={via} />
					<button type="submit" disabled={busy} class="rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-500 disabled:opacity-50">
						{m.cart_bar_proceed()}
					</button>
				</form>
			</div>
		</div>
	</div>
{/if}
