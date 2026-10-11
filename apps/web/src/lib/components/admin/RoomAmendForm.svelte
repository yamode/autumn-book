<script lang="ts" module>
	import type { AmendRoomsQuoteRoom } from '$lib/multi-room';

	/** 管理画面の ?/quoteRoom の roomQuote のうち、画面で使う所（lib/server/supabase-data.ts の AmendRoomsQuote の一部） */
	export type AdminRoomQuote = {
		ok: boolean;
		amendRemaining: number;
		amendLimit: number;
		isNoop: boolean;
		pastDeadline: boolean;
		oldCharge: number;
		newCharge: number;
		newDiscount: number;
		diff: number;
		pointsRefund: number;
		inPenalty: boolean;
		available: boolean;
		prepaidOnline: boolean;
		liveRooms: number;
		rooms: AmendRoomsQuoteRoom[];
	};
	export type AdminAmendOptions = {
		roomTypes: { id: string; name: string; capacity: number }[];
		plans: { id: string; name: string; onsite: boolean; memberPage: boolean }[];
	};
</script>

<script lang="ts">
	// 管理画面: 予約詳細の部屋ごとの「部屋を変更」（部屋タイプ・プラン・人数・公式の複数室 M3・docs/official-multi-room.md §17.3.3・§18.5）。
	// 見積（?/quoteRoom）→ 理由（必須）・必要なら「キャンセル料がかかる期間・締切後でも変更する」（force）→ 確定（?/amendRoom・監査ログ amend_booking_rooms）。
	// 回数とオンライン決済済みは force でも越えない（DB が確かめる）。専用ページ経由の予約は専用料金で計算し直す（サーバが泊明細と特典を付ける）。
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { formatYen, formatDateLongJa } from '$lib/format';
	import { nightGroups, policyRulesOf } from '$lib/multi-room';

	let {
		room,
		options,
		memberPage,
		multiRoom,
		quote,
		error,
		onclose
	}: {
		room: { room_index: number; room_type_id?: string | null; rate_plan_id?: string | null; room_name: string | null; plan_name: string | null; adults: number; room_total: number };
		options: AdminAmendOptions;
		/** 専用ページ経由の予約（専用料金の無いプランは選べない） */
		memberPage: boolean;
		/** 2 室以上の予約（料金の明細に「N室目」を付ける） */
		multiRoom: boolean;
		/** この部屋の見積（?/quoteRoom の結果。別の部屋の見積なら null） */
		quote: AdminRoomQuote | null;
		/** 見積・確定の失敗の文言 */
		error: string | null;
		onclose: () => void;
	} = $props();

	// 初期値は今の部屋タイプ・プラン・人数（開いたときの props から一度だけ写す）
	let roomTypeId = $state(untrack(() => room.room_type_id ?? ''));
	let ratePlanId = $state(untrack(() => room.rate_plan_id ?? ''));
	let adults = $state(untrack(() => room.adults));
	let reason = $state('');
	let force = $state(false);
	let busy = $state(false);
	// 見積を出したときの選択（選び直したら見積を出し直すまで確定できない）
	let quotedKey = $state<string | null>(null);
	let key = $derived(`${roomTypeId}|${ratePlanId}|${adults}`);
	let fresh = $derived(!!quote && quotedKey === key);

	let roomType = $derived(options.roomTypes.find((t) => t.id === roomTypeId) ?? null);
	let overCapacity = $derived(!!roomType && roomType.capacity > 0 && adults > roomType.capacity);
	let q = $derived(fresh ? quote : null);
	let qRoom = $derived(q ? (q.rooms.find((r) => r.index === room.room_index) ?? null) : null);
	let groups = $derived(qRoom ? nightGroups([{ lines: qRoom.lines }]) : []);
	let policy = $derived(qRoom && qRoom.changed && qRoom.planId !== qRoom.oldPlanId ? policyRulesOf(qRoom.cancellationPolicy) : null);
	// force が要る（キャンセル料がかかる期間・締切後）
	let needsForce = $derived(!!q && (q.inPenalty || q.pastDeadline));
	// 確定できない理由（force で越えられないもの）
	let hardBlock = $derived(
		!q
			? null
			: q.isNoop
				? '部屋タイプ・プラン・人数が変わっていません。'
				: q.prepaidOnline
					? 'カードでお支払い済みのご予約は、お部屋・プラン・人数を変更できません。取消 → 取り直し（キャンセル料がかからない期間なら全額返金）でご案内ください。'
					: q.amendRemaining <= 0
						? `変更回数の上限（${q.amendLimit}回・日程の変更と共通）に達しています。`
						: !q.available
							? '変更後の部屋タイプに空きがありません（滞在期間のどこかが満室・販売停止）。'
							: !q.ok
								? 'このご予約は現在変更できません（チェックイン済みのお部屋があるなど）。'
								: null
	);
	let canConfirm = $derived(!!q && !hardBlock && (!needsForce || force) && reason.trim().length > 0 && !busy);

	const yen = (n: number) => formatYen(n);
	function planLabel(p: AdminAmendOptions['plans'][number]): string {
		if (!p.onsite) return `${p.name}（現地払い不可）`;
		if (memberPage && !p.memberPage) return `${p.name}（専用料金なし）`;
		return p.name;
	}
</script>

<div class="mt-2 rounded-lg border border-brand-200 bg-brand-50/40 p-3 text-sm">
	<div class="flex items-center justify-between gap-2">
		<p class="min-w-0 break-words font-medium text-stone-700">{room.room_index}室目を変更（今: {room.room_name ?? '—'} ／ {room.plan_name ?? '—'} ／ 大人{room.adults}名 ／ {yen(room.room_total)}）</p>
		<button type="button" onclick={onclose} class="shrink-0 text-xs text-stone-500 hover:underline">閉じる</button>
	</div>
	{#if memberPage}
		<p class="mt-1 text-xs text-amber-800">専用ページ経由のご予約です。料金は専用料金で計算し直し、プランが変わるときは専用特典も新しいプランのものに差し替えます。</p>
	{/if}

	<form
		method="POST"
		action="?/quoteRoom"
		use:enhance={({ action }) => {
			busy = true;
			const isQuote = action.search.includes('quoteRoom');
			const submittedKey = key;
			return async ({ result, update }) => {
				busy = false;
				if (isQuote && result.type === 'success') quotedKey = submittedKey;
				if (!isQuote && result.type === 'success') onclose();
				await update({ reset: false });
			};
		}}
		class="mt-3 space-y-3"
	>
		<input type="hidden" name="roomIndex" value={room.room_index} />
		<div class="grid gap-3 sm:grid-cols-3">
			<label class="block text-xs text-stone-500">
				部屋タイプ
				<select name="roomTypeId" bind:value={roomTypeId} class="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm">
					{#each options.roomTypes as t (t.id)}
						<option value={t.id}>{t.name}{t.capacity > 0 ? `（定員${t.capacity}名）` : ''}</option>
					{/each}
				</select>
			</label>
			<label class="block text-xs text-stone-500">
				プラン
				<select name="ratePlanId" bind:value={ratePlanId} class="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm">
					{#each options.plans as p (p.id)}
						<option value={p.id} disabled={p.id !== room.rate_plan_id && (!p.onsite || (memberPage && !p.memberPage))}>{planLabel(p)}</option>
					{/each}
				</select>
			</label>
			<label class="block text-xs text-stone-500">
				人数
				<select name="adults" bind:value={adults} class="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm">
					{#each [1, 2, 3, 4, 5, 6] as a (a)}
						<option value={a}>大人{a}名</option>
					{/each}
				</select>
			</label>
		</div>
		{#if overCapacity}
			<p class="text-xs text-red-600">この部屋タイプの定員（{roomType?.capacity}名）を超えています。</p>
		{/if}
		<div class="flex justify-end">
			<button type="submit" disabled={busy} class="rounded-md border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50">見積もる</button>
		</div>

		{#if error}
			<p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>
		{/if}

		{#if quote && !fresh}
			<p class="text-xs text-stone-500">選び直しました。「見積もる」を押して見積を出し直してください。</p>
		{/if}

		{#if q}
			<!-- 見積: この部屋の今 → 変更後・予約全体の今 → 変更後・差額・返還ポイント -->
			<div class="rounded-md border border-stone-200 bg-white p-3">
				<dl class="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
					{#if qRoom}
						<div class="flex justify-between gap-2"><dt class="text-stone-500">この部屋の宿泊料金</dt><dd class="tabular-nums">{yen(qRoom.oldTotal)} → <strong>{yen(qRoom.newTotal)}</strong></dd></div>
					{/if}
					<div class="flex justify-between gap-2"><dt class="text-stone-500">予約の請求額</dt><dd class="tabular-nums">{yen(q.oldCharge)} → <strong>{yen(q.newCharge)}</strong></dd></div>
					<div class="flex justify-between gap-2">
						<dt class="text-stone-500">差額</dt>
						<dd class="tabular-nums font-medium {q.diff > 0 ? 'text-red-600' : q.diff < 0 ? 'text-emerald-700' : 'text-stone-500'}">{q.diff > 0 ? '+' : ''}{yen(q.diff)}（現地精算）</dd>
					</div>
					{#if q.newDiscount > 0}<div class="flex justify-between gap-2"><dt class="text-stone-500">クーポン（全室で按分し直し）</dt><dd class="tabular-nums">−{yen(q.newDiscount)}</dd></div>{/if}
					{#if q.pointsRefund > 0}<div class="flex justify-between gap-2"><dt class="text-stone-500">ポイント返還</dt><dd class="tabular-nums text-emerald-700">{q.pointsRefund.toLocaleString('ja-JP')}pt</dd></div>{/if}
					<div class="flex justify-between gap-2"><dt class="text-stone-500">変更回数の残り</dt><dd>あと {q.amendRemaining} 回（上限 {q.amendLimit} 回）</dd></div>
				</dl>

				{#if groups.length > 0}
					<!-- 変更後の料金の明細（泊の見出し → 部屋の行） -->
					<div class="mt-3 space-y-1 border-t border-stone-100 pt-2 text-xs text-stone-600">
						<p class="font-medium text-stone-500">変更後の料金の明細</p>
						{#each groups as ng (ng.date)}
							<p class="font-medium text-stone-500">{ng.night}泊目: {formatDateLongJa(ng.date)}</p>
							{#each ng.rows as row (row.room)}
								<p class="flex justify-between pl-3"><span>{multiRoom ? `${room.room_index}室目　` : ''}1名様 {yen(row.unitPrice)} × {row.adults}名様</span><span class="tabular-nums">{yen(row.subtotal)}</span></p>
							{/each}
						{/each}
					</div>
				{/if}

				{#if policy}
					<div class="mt-3 border-t border-stone-100 pt-2 text-xs text-stone-600">
						<p class="font-medium text-stone-500">変更後のキャンセル規定（{policy.source === 'member_page' ? '専用ページの規定' : policy.source === 'rank' ? '会員グレードの規定' : '新しいプランの規定'}）</p>
						{#if policy.rules.length > 0}
							<p>{policy.rules.map((r) => `${r.days_before < 0 ? '不泊' : r.days_before === 0 ? '当日' : `${r.days_before}日前`} ${Math.round(r.rate * 100)}%`).join('・')}</p>
						{:else if policy.source !== 'rank'}
							<p>キャンセル料なし</p>
						{/if}
					</div>
				{/if}
			</div>

			{#if hardBlock}
				<p class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{hardBlock}</p>
			{:else}
				{#if needsForce}
					<p class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
						{q.pastDeadline ? '変更の受付期限（チェックイン当日 9:00）を過ぎています。' : 'キャンセル料がかかる期間です（お客さまの画面からは変更できません）。'}変更するときは下の「締切後・キャンセル料がかかる期間でも変更する」にチェックを入れてください。
					</p>
				{/if}
				<label class="block text-xs text-stone-500">
					変更の理由（必須・監査ログに記録）
					<input type="text" name="reason" bind:value={reason} maxlength="500" class="mt-1 block w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm" placeholder="例: お客さまから電話で人数の変更のご依頼" />
				</label>
				<label class="flex items-start gap-2 text-xs text-stone-600">
					<input type="checkbox" name="force" bind:checked={force} class="mt-0.5 h-4 w-4 shrink-0" />
					<span>締切後・キャンセル料がかかる期間でも変更する（回数の上限とカード払い済みは越えられません）</span>
				</label>
				<div class="flex justify-end">
					<button
						type="submit"
						formaction="?/amendRoom"
						disabled={!canConfirm}
						class="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 disabled:cursor-not-allowed disabled:bg-stone-300"
					>
						{busy ? '変更しています…' : 'この内容に変更する'}
					</button>
				</div>
			{/if}
		{/if}
	</form>
</div>
