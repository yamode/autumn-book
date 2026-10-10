<script lang="ts">
	// 管理画面の取引先詳細「団体予約」の節（docs/partner-group-booking.md §5.3・§8.3・§14.4）。
	// 旅行会社（kind='agent'）のときだけ親が出す。設定は共通の予約設定（booking_settings の group*）で、
	// 親の「共通の設定を保存」（?/saveCommon の hidden booking＝JSON）でそのまま保存される。入力欄に name は付けない。
	import { groupPaymentChoices } from '$lib/partner-group';
	import type { PartnerBookingSettings } from '$lib/partner-booking';

	let { booking = $bindable(), inputClass }: { booking: PartnerBookingSettings; inputClass: string } = $props();

	// 選択肢は1行に1つ。入力中は空行もそのまま持ち、欄を離れたときに空行・重複を除く（保存時はサーバでも正規化）
	const linesOf = (text: string) => text.replace(/\r\n/g, '\n').split('\n');
	const tidy = (list: string[]) => [...new Set(list.map((s) => s.trim()).filter(Boolean))].slice(0, 12);
	const groupPayments = $derived(groupPaymentChoices(booking));
</script>

<div>
	<h3 class="mb-1.5 mt-1 border-t border-stone-300 pt-4 text-[15px] font-bold text-stone-800">団体予約 <span class="text-xs font-normal text-stone-500">（旅行会社のみ・照会 → 宿が回答 → 取引先が承諾で予約）</span></h3>
	<label class="flex cursor-pointer items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 sm:max-w-md">
		<input type="checkbox" bind:checked={booking.groupInquiryEnabled} class="peer sr-only" />
		<span class={`relative h-6 w-11 shrink-0 rounded-full transition ${booking.groupInquiryEnabled ? 'bg-emerald-500' : 'bg-stone-300'} peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600`}>
			<span class={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${booking.groupInquiryEnabled ? 'left-[22px]' : 'left-0.5'}`}></span>
		</span>
		<span class="text-sm">
			<span class="font-medium">団体予約を使う</span>
			<span class={`ml-1.5 rounded px-1.5 py-0.5 text-xs font-bold ${booking.groupInquiryEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{booking.groupInquiryEnabled ? 'オン' : 'オフ'}</span>
			<span class="mt-0.5 block text-[11px] text-stone-500">オンにすると取引先ページのメニューに「団体予約」が出ます（既定はオフ）</span>
		</span>
	</label>
	{#if booking.groupInquiryEnabled && groupPayments.length === 0}
		<p class="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-900">団体予約には「後払い（月締め請求）」か自由入力の支払方法（例: ペイメントリング）が必要です。上の「支払方法と請求条件」で足してください（オンライン決済は団体では使いません）。</p>
	{:else if booking.groupInquiryEnabled}
		<p class="mt-2 text-[11px] text-stone-500">団体で選べる支払方法: {groupPayments.map((p) => p.label).join('・')}（オンライン決済は除く）</p>
	{/if}

	{#if booking.groupInquiryEnabled}
		<div class="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
			<label class="block">
				<span class="mb-0.5 block text-xs text-stone-500">1件の最大室数</span>
				<input type="number" min="1" max="100" bind:value={booking.groupMaxRooms} class={inputClass} />
			</label>
			<label class="block">
				<span class="mb-0.5 block text-xs text-stone-500">1件の最大泊数</span>
				<input type="number" min="1" max="30" bind:value={booking.groupMaxNights} class={inputClass} />
			</label>
			<label class="block">
				<span class="mb-0.5 block text-xs text-stone-500">一度に送れる件数</span>
				<input type="number" min="1" max="50" bind:value={booking.groupMaxBatch} class={inputClass} />
			</label>
			<label class="block">
				<span class="mb-0.5 block text-xs text-stone-500">照会の締切</span>
				<select bind:value={booking.groupLeadDays} class={inputClass}>
					{#each [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90] as d (d)}<option value={d}>{d === 0 ? '当日' : `${d}日前`}</option>{/each}
				</select>
			</label>
			<label class="block">
				<span class="mb-0.5 block text-xs text-stone-500">回答の有効期限の既定</span>
				<select bind:value={booking.groupAnswerDays} class={inputClass}>
					{#each [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60] as d (d)}<option value={d}>{d}日後まで</option>{/each}
				</select>
			</label>
		</div>
		<p class="mt-1 text-[11px] text-stone-500">締切の時刻は「受付ルールの既定」の締切の時刻（{booking.cutoffHour}時）と同じです。最大室数の既定は 30 室（個人予約の最大室数とは別）。</p>
		<div class="mt-3 grid gap-3 sm:grid-cols-2">
			<label class="block">
				<span class="mb-0.5 block text-xs text-stone-500">交通機関の選択肢（1行に1つ・最大12件。「その他」の自由記入は常に出ます）</span>
				<textarea
					rows="5"
					value={booking.groupTransportChoices.join('\n')}
					oninput={(e) => (booking.groupTransportChoices = linesOf(e.currentTarget.value))}
					onblur={() => (booking.groupTransportChoices = tidy(booking.groupTransportChoices))}
					class={inputClass}
				></textarea>
			</label>
			<label class="block">
				<span class="mb-0.5 block text-xs text-stone-500">夕食開始時間の選択肢（1行に1つ・最大12件。「その他」の自由記入は常に出ます）</span>
				<textarea
					rows="5"
					value={booking.groupDinnerTimeChoices.join('\n')}
					oninput={(e) => (booking.groupDinnerTimeChoices = linesOf(e.currentTarget.value))}
					onblur={() => (booking.groupDinnerTimeChoices = tidy(booking.groupDinnerTimeChoices))}
					class={inputClass}
				></textarea>
			</label>
		</div>
	{/if}
</div>
