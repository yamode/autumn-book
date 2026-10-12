<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { ALERT_STATUS, type AlertConditions } from '$lib/availability-alerts';
	import { addDays } from '$lib/format';
	let { data, form } = $props();
	const values = $derived((form && 'values' in form ? form.values as AlertConditions : null) ?? data.defaults);
	let facility = $state(untrack(() => values.facility));
	let room = $state(untrack(() => values.room));
	let plan = $state(untrack(() => values.plan));
	let busy = $state(false);
	const selected = $derived(data.facilities.find((f) => f.id === facility));
	$effect(() => {
		const v = values;
		facility = v?.facility ?? '';
		room = v?.room ?? '';
		plan = v?.plan ?? '';
	});
	const activeCount = $derived(data.alerts.filter((a) => a.status === 'active' || a.status === 'queued').length);
</script>

<svelte:head><title>空室通知 | マイページ</title></svelte:head>
<h2 class="text-xl text-brand-900">空室通知</h2>
<p class="mt-2 text-sm leading-7 text-stone-600">ご希望の宿泊日と条件を登録すると、条件に合う空室が見つかったときに会員登録のメールアドレスへお知らせします。</p>
<p class="mt-2 text-sm text-stone-500">約5分ごとに確認し、登録ごとに1回お知らせします。通知はお部屋の確保・予約を保証するものではありません。</p>

{#if form?.message}<p role="status" class="mt-4 rounded-lg p-3 text-sm {form.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}">{form.message}</p>{/if}
{#if !data.enabled}
	<p class="mt-6 rounded-xl bg-stone-100 p-5">空室通知は本番の会員ログインでご利用いただけます。この環境ではメールを送信しません。</p>
{:else if data.loadError}
	<p role="alert" class="mt-6 rounded-xl bg-red-50 p-5 text-red-700">空室通知を読み込めませんでした。時間をおいて画面を更新してください。</p>
{:else}
	<form method="POST" action="?/create" class="mt-6 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6" use:enhance={() => { busy = true; return async ({ update }) => { try { await update(); } finally { busy = false; } }; }}>
		<h3 class="font-semibold text-brand-900">新しい空室通知を登録</h3>
		<p class="mt-1 text-sm text-stone-500">登録中 {activeCount} / 10件 · 1室ごとに同じ人数・お部屋・プランの条件です。</p>
		<fieldset disabled={busy || activeCount >= 10} class="mt-4 grid gap-4 sm:grid-cols-2">
			<label class="text-sm">施設<select name="facility" required bind:value={facility} onchange={() => { room = ''; plan = ''; }} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5"><option value="">選択してください</option>{#each data.facilities as f}<option value={f.id}>{f.name}</option>{/each}</select></label>
			<label class="text-sm">チェックイン日<input name="checkin" type="date" required min={addDays(data.today, 1)} max={data.maxDate} value={values.checkin} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5" /></label>
			<label class="text-sm">泊数<input name="nights" type="number" required min="1" max="7" value={values.nights} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5" /></label>
			<label class="text-sm">大人の人数（1室あたり）<input name="adults" type="number" required min="1" max="6" value={values.adults} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5" /></label>
			<label class="text-sm">室数<input name="rooms" type="number" required min="1" max="4" value={values.rooms} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5" /></label>
			<label class="text-sm">ご予算（全室・全泊合計／税込）<input name="budget" type="number" min="1" max="10000000" step="1" placeholder="上限なし" value={values.budget} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5" /></label>
			<label class="text-sm">お部屋<select name="room" bind:value={room} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5"><option value="">指定なし</option>{#each selected?.rooms ?? [] as r}<option value={r.id}>{r.name}</option>{/each}</select></label>
			<label class="text-sm">宿泊プラン<select name="plan" bind:value={plan} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5"><option value="">指定なし</option>{#each selected?.plans ?? [] as p}<option value={p.id}>{p.name}</option>{/each}</select></label>
			<p class="text-xs leading-6 text-stone-500 sm:col-span-2">大人のみの条件に対応しています。予算はクーポン・ポイント利用前の宿泊料金です。宿泊日当日になると通知を終了します。空室情報の更新時刻によって、お知らせまで時間がかかる場合があります。</p>
			<label class="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" name="consent" value="yes" required class="mt-1" /><span>この条件の空室通知メールを受け取ることに同意します（メールマガジンの設定とは別です）。</span></label>
			<button type="submit" class="rounded-lg bg-brand-800 px-5 py-3 text-white disabled:opacity-50 sm:col-span-2">{busy ? '登録中…' : '空室通知を登録する'}</button>
		</fieldset>
	</form>
	<h3 class="mt-8 font-semibold text-brand-900">登録した空室通知</h3>
	{#if data.alerts.length === 0}<p class="mt-3 text-sm text-stone-500">空室通知はまだ登録されていません。</p>{/if}
	<div class="mt-3 space-y-3">
		{#each data.alerts as a (a.id)}
			{@const f = data.facilities.find((f) => f.id === a.facility_id)}
			<article class="rounded-xl border border-stone-200 bg-white p-5">
				<div class="flex flex-wrap items-center justify-between gap-2"><h4 class="font-semibold">{f?.name ?? '施設'}</h4><span class="rounded-full bg-stone-100 px-3 py-1 text-xs">{a.status === 'active' && a.checkin <= data.today ? '期限終了' : ALERT_STATUS[a.status]}</span></div>
				<p class="mt-2 text-sm">{a.checkin} から {a.nights}泊 · {a.room_count}室 · 大人1室あたり{a.adults}名</p>
				<p class="mt-1 text-sm text-stone-600">お部屋：{a.room_type_id ? f?.rooms.find((r) => r.id === a.room_type_id)?.name ?? '公開終了のお部屋' : '指定なし'} ／ プラン：{a.rate_plan_id ? f?.plans.find((p) => p.id === a.rate_plan_id)?.name ?? '公開終了のプラン' : '指定なし'}</p>
				<p class="mt-1 text-sm text-stone-600">予算：{a.max_total ? `${a.max_total.toLocaleString()}円まで（全室・全泊合計）` : '上限なし'}</p>
				{#if a.status === 'active' || a.status === 'queued'}<form method="POST" action="?/stop" use:enhance class="mt-3"><input type="hidden" name="id" value={a.id} /><button class="rounded-lg border border-stone-300 px-4 py-2 text-sm">通知を停止</button></form>{/if}
				{#if a.status === 'notified'}<p class="mt-3 text-xs text-stone-500">再度お知らせをご希望の場合は、新しい通知を登録してください。</p>{/if}
				{#if a.status === 'failed'}<p class="mt-3 text-xs text-red-700">メールを送信できませんでした。登録メールアドレスをご確認のうえ、再登録してください。</p>{/if}
			</article>
		{/each}
	</div>
{/if}
