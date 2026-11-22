<script lang="ts">
	import { addDays, cancelPolicyLabel, cancellationRate, type CancellationPolicy } from '@autumn-book/core';
	import { todayJstIso } from '$lib/early-prepay';
	import { formatDate } from '$lib/format';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';

	let { policy, checkin }: { policy: CancellationPolicy; checkin: string } = $props();
	// すでにキャンセル料がかかる期間なら「○日まで無料」は意味が無いので、今日キャンセルしたときの率を出す（2026-11-22 指示）
	let rateNow = $derived(checkin ? cancellationRate(policy, checkin, todayJstIso()) : 0);
	// 日本語は従来どおり共通の文言（例: 1/24までキャンセル無料）。他の言語は訳文で出す（2026-11-22）
	let freeLabel = $derived.by(() => {
		if (getLocale() === 'ja') return cancelPolicyLabel(policy, checkin);
		const charged = [...policy.rules].filter((r) => r.rate > 0).sort((a, b) => b.days_before - a.days_before);
		if (charged.length === 0) return m.cancelrank_none();
		return m.booking_cancel_free_date({ date: formatDate(addDays(checkin, -(charged[0].days_before + 1))) });
	});
</script>

{#if rateNow > 0}
	<span class="text-stone-600">{m.booking_cancel_fee_period({ rate: String(Math.round(rateNow * 100)) })}</span>
{:else}
	{freeLabel}
{/if}
