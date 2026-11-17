<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { ALERT_STATUS } from '$lib/availability-alerts';

	let { data, form } = $props();
	let showPast = $state(false);
	const visible = $derived(data.alerts.filter((alert) => (alert.checkin < data.today) === showPast));
</script>

<svelte:head><title>空室通知 | マイページ</title></svelte:head>
<h2 class="text-xl text-brand-900">空室通知</h2>
<p class="mt-2 text-sm text-stone-600">新しい空室通知は、日付を指定した空室検索で空きのないお部屋から登録できます。</p>

{#if form?.message}<p role="status" class="mt-4 rounded-lg p-3 text-sm {form.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}">{form.message}</p>{/if}
{#if !data.enabled}
	<p class="mt-6 rounded-xl bg-stone-100 p-5">空室通知は本番の会員ログインでご利用いただけます。この環境ではメールを送信しません。</p>
{:else if data.loadError}
	<p role="alert" class="mt-6 rounded-xl bg-red-50 p-5 text-red-700">空室通知を読み込めませんでした。時間をおいて画面を更新してください。</p>
{:else}
	<div class="mt-5 flex gap-2" role="group" aria-label="宿泊日で絞り込む">
		<button type="button" onclick={() => (showPast = false)} aria-pressed={!showPast} class="min-h-11 rounded-lg px-4 text-sm {showPast ? 'border border-stone-300' : 'bg-brand-800 text-white'}">今後の日付</button>
		<button type="button" onclick={() => (showPast = true)} aria-pressed={showPast} class="min-h-11 rounded-lg px-4 text-sm {showPast ? 'bg-brand-800 text-white' : 'border border-stone-300'}">過去の日付</button>
	</div>
	{#if visible.length === 0}<p class="mt-4 text-sm text-stone-500">{showPast ? '過去の日付の空室通知はありません。' : '今後の日付の空室通知はありません。'}</p>{/if}
	<div class="mt-3 space-y-3">
		{#each visible as a (a.id)}
			{@const f = data.facilities.find((f) => f.id === a.facility_id)}
			<article class="rounded-xl border border-stone-200 bg-white p-5">
				<div class="flex flex-wrap items-center justify-between gap-2"><h4 class="font-semibold">{f?.name ?? '施設'}</h4><span class="rounded-full bg-stone-100 px-3 py-1 text-xs">{a.status === 'active' && a.checkin <= data.today ? '期限終了' : ALERT_STATUS[a.status]}</span></div>
				<p class="mt-2 text-sm">{a.checkin} から {a.nights}泊 · {a.room_count}室 · 大人1室あたり{a.adults}名</p>
				<p class="mt-1 text-sm text-stone-600">お部屋：{a.room_type_id ? f?.rooms.find((r) => r.id === a.room_type_id)?.name ?? '公開終了のお部屋' : '指定なし'} ／ プラン：{a.rate_plan_id ? f?.plans.find((p) => p.id === a.rate_plan_id)?.name ?? '公開終了のプラン' : '指定なし'}</p>
				<p class="mt-1 text-sm text-stone-600">予算：{a.max_total ? `${a.max_total.toLocaleString()}円まで（全室・全泊合計）` : '上限なし'}</p>
				<form method="POST" action="?/remove" use:enhance class="mt-3"><input type="hidden" name="id" value={a.id} /><button class="min-h-11 rounded-lg border border-stone-300 px-4 text-sm">削除</button></form>
				{#if a.status === 'notified'}<p class="mt-3 text-xs text-stone-500">再度お知らせをご希望の場合は、新しい通知を登録してください。</p>{/if}
				{#if a.status === 'failed'}<p class="mt-3 text-xs text-red-700">メールを送信できませんでした。登録メールアドレスをご確認のうえ、再登録してください。</p>{/if}
			</article>
		{/each}
	</div>
{/if}
