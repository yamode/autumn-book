<script lang="ts" module>
	/** 部屋の変更の候補 1 件（見た目だけ。識別子は呼び出し側が href に入れる） */
	export type AmendRoomPickerItem = {
		/** 一覧の key（呼び出し側で一意に） */
		key: string;
		roomName: string;
		planName: string;
		/** この部屋の宿泊料金（今の日程・選んだ人数） */
		total: number;
		/** 残室（不明なら null） */
		remaining: number | null;
		/** 今の部屋と同じ部屋タイプ・プラン */
		current: boolean;
		selectable: boolean;
		blocked: 'payment' | 'sold_out' | 'capacity' | null;
		/** 選んだときの URL（GET で見積を出し直す） */
		href: string;
		/** 専用特典（専用ページだけ） */
		perks?: { title: string }[] | null;
	};
</script>

<script lang="ts">
	// 「このお部屋を変更」の候補の一覧（公式マイページ /account/reservations/[code]/amend/room/[index] と、
	// 特別会員の専用ページ /p/<token>/bookings/<予約番号>/amend/room/[index] で共用・docs/official-multi-room.md §17.3・§18.6）。
	// 候補を押すと href（GET）で見積を出し直す。選べない候補（現地払い不可・満室・定員超え）は理由を出して押せない。
	// /p は URL に言語が無いので、文言（paraglide）は日本語で出る。
	import { formatPrice } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	let { items, selectedKey = null }: { items: AmendRoomPickerItem[]; selectedKey?: string | null } = $props();

	function blockedLabel(b: AmendRoomPickerItem['blocked']): string {
		return b === 'payment' ? m.amend_room_blocked_payment() : b === 'capacity' ? m.amend_room_blocked_capacity() : m.amend_room_blocked_sold_out();
	}
	const perkTitles = (list: { title: string }[] | null | undefined) => (list ?? []).map((p) => p.title).filter(Boolean).join('／');
</script>

{#if items.length === 0}
	<p class="mt-3 text-sm text-stone-400">{m.amend_no_offers()}</p>
{:else}
	<ul class="mt-3 space-y-2">
		{#each items as o (o.key)}
			{@const sel = o.key === selectedKey}
			<li>
				{#if o.selectable}
					<a
						href={o.href}
						data-sveltekit-noscroll
						aria-current={sel ? 'true' : undefined}
						class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm {sel ? 'border-accent-400 bg-accent-50' : 'border-stone-200 hover:border-stone-300'}"
					>
						<span class="flex min-w-0 items-center gap-2">
							<span class="h-4 w-4 shrink-0 rounded-full border {sel ? 'border-[5px] border-accent-600' : 'border-stone-400'}" aria-hidden="true"></span>
							<span class="min-w-0">
								<span class="block break-words font-medium text-stone-800">
									{o.roomName || m.amend_room_fallback()}
									{#if o.current}<span class="ml-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal text-stone-600">{m.amend_room_badge_current()}</span>{/if}
								</span>
								<span class="block break-words text-xs text-stone-500">{o.planName || m.amend_plan_fallback()}{#if o.remaining != null}・{m.amend_remaining_rooms({ n: String(o.remaining) })}{/if}</span>
								{#if perkTitles(o.perks)}<span class="block break-words text-xs text-amber-800">{m.member_page_perks()}: {perkTitles(o.perks)}</span>{/if}
							</span>
						</span>
						<span class="shrink-0 text-right tabular-nums text-stone-700">{formatPrice(o.total)}</span>
					</a>
				{:else}
					<div class="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-400" aria-disabled="true">
						<span class="flex min-w-0 items-center gap-2">
							<span class="h-4 w-4 shrink-0 rounded-full border border-stone-300" aria-hidden="true"></span>
							<span class="min-w-0">
								<span class="block break-words font-medium">{o.roomName || m.amend_room_fallback()}</span>
								<span class="block break-words text-xs">{o.planName || m.amend_plan_fallback()}</span>
							</span>
						</span>
						<span class="shrink-0 text-right">
							<span class="block tabular-nums">{formatPrice(o.total)}</span>
							<span class="block text-xs text-red-600">{blockedLabel(o.blocked)}</span>
						</span>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
