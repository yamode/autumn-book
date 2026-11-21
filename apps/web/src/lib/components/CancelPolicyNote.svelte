<script lang="ts">
	import { cancelPolicyLabel, cancellationRate, type CancellationPolicy } from '@autumn-book/core';
	import { todayJstIso } from '$lib/early-prepay';
	import * as m from '$lib/paraglide/messages';

	let { policy, checkin }: { policy: CancellationPolicy; checkin: string } = $props();
	// すでにキャンセル料がかかる期間なら「○日まで無料」は意味が無いので、今日キャンセルしたときの率を出す（2026-11-22 指示）
	let rateNow = $derived(checkin ? cancellationRate(policy, checkin, todayJstIso()) : 0);
</script>

{#if rateNow > 0}
	<span class="text-stone-600">{m.booking_cancel_fee_period({ rate: String(Math.round(rateNow * 100)) })}</span>
{:else}
	{cancelPolicyLabel(policy, checkin)}
{/if}
