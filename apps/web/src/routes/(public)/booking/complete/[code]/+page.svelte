<script lang="ts">
	import Stepper from '$lib/components/Stepper.svelte';
	import { formatYen, formatDateLongJa } from '$lib/format';

	let { data } = $props();
	let b = $derived(data.booking);
	let isCard = $derived(b.payment === 'card');
</script>

<svelte:head><title>ご予約完了 ｜ {data.facility.name}</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-10">
	<Stepper steps={isCard ? ['プラン選択', 'お客様情報', 'お支払い', '完了'] : ['プラン選択', 'お客様情報', '完了']} current={isCard ? 3 : 2} />

	<div class="mt-8 rounded-2xl border border-stone-200 bg-white p-8 text-center">
		<p class="text-4xl text-emerald-600">✔</p>
		<h1 class="font-display mt-3 text-2xl text-brand-900">ご予約が確定しました</h1>
		<p class="mt-2 text-sm text-stone-500">予約番号</p>
		<p class="text-2xl font-bold tracking-wider text-brand-900">{b.code}</p>
		<p class="mt-3 text-sm text-stone-600">確認メールを <strong>{b.guest.email}</strong> 宛にお送りしました。</p>

		<dl class="mx-auto mt-6 max-w-md space-y-1.5 rounded-xl bg-stone-50 p-4 text-left text-sm">
			<div class="flex justify-between"><dt class="text-stone-500">施設</dt><dd>{data.facility.name}</dd></div>
			<div class="flex justify-between"><dt class="text-stone-500">チェックイン</dt><dd>{formatDateLongJa(b.checkin)} {data.facility.checkinTime}〜</dd></div>
			<div class="flex justify-between"><dt class="text-stone-500">客室・泊数</dt><dd>{data.room.name}・{b.nights}泊</dd></div>
			<div class="flex justify-between"><dt class="text-stone-500">ご宿泊者</dt><dd>{b.guest.name} 様（大人{b.adults}名）</dd></div>
			<div class="flex justify-between border-t border-stone-200 pt-1.5 font-medium">
				<dt>{isCard ? 'お支払い済み' : '現地でのお支払い'}</dt>
				<dd>{formatYen(b.total - b.pointsUsed)}</dd>
			</div>
			{#if b.pointsEarned > 0}
				<div class="flex justify-between text-emerald-700"><dt>付与予定ポイント</dt><dd>+{b.pointsEarned.toLocaleString()}pt</dd></div>
			{/if}
		</dl>

		<div class="mt-6 flex flex-wrap justify-center gap-3">
			<a href="data:text/calendar," download="{b.code}.ics" class="rounded-lg border border-stone-300 px-5 py-2 text-sm hover:bg-stone-50">📅 カレンダーに追加</a>
			{#if data.isMember}
				<a href="/account" class="rounded-lg bg-brand-800 px-5 py-2 text-sm text-white hover:bg-brand-700">マイページで確認</a>
			{/if}
		</div>

		{#if !data.isMember}
			<div class="mt-8 rounded-xl bg-amber-50 p-4 text-sm">
				<p class="font-medium text-brand-900">会員登録すると、本予約に {Math.floor(b.total / 110).toLocaleString()}pt が付きます</p>
				<p class="mt-1 text-xs text-stone-500">入力済みの情報を引き継いで30秒で登録できます。ポイントは次回のご予約ですぐ使えます。</p>
				<a href="/auth/register?email={encodeURIComponent(b.guest.email)}&name={encodeURIComponent(b.guest.name)}" class="mt-3 inline-block rounded-lg bg-accent-600 px-5 py-2 text-white hover:bg-accent-500">30秒で会員登録</a>
			</div>
		{/if}

		<!-- クロスセル枠（P6: オプション予約 §15.2 をここに接続） -->
		<div class="mt-6 rounded-xl border border-stone-200 p-4 text-left text-sm text-stone-500">
			<p class="font-medium text-stone-600">ご滞在をもっと楽しむ（準備中）</p>
			<p class="mt-1 text-xs">貸切風呂・記念日ケーキなどのオプション予約は、近日マイページからお申し込みいただけるようになります。</p>
		</div>
	</div>
</div>
