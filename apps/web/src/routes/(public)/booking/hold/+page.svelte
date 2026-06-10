<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Stepper from '$lib/components/Stepper.svelte';
	import HoldTimer from '$lib/components/HoldTimer.svelte';
	import PriceBreakdown from '$lib/components/PriceBreakdown.svelte';
	import CancelPolicyNote from '$lib/components/CancelPolicyNote.svelte';
	import { formatDateLongJa } from '$lib/format';
	import { invalidateAll } from '$app/navigation';

	let { data, form } = $props();

	let expiredNow = $state(false);
	let isCard = $derived(!data.expired && data.plan.paymentMethod === 'card');
	let steps = $derived(isCard ? ['プラン選択', 'お客様情報', 'お支払い', '完了'] : ['プラン選択', 'お客様情報', '完了']);
</script>

<svelte:head><title>ご予約 ｜ お客様情報</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8">
	{#if data.expired || expiredNow}
		<div class="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center">
			<p class="text-3xl">⌛</p>
			<h1 class="font-display mt-2 text-xl text-brand-900">確保時間が過ぎました</h1>
			<p class="mt-2 text-sm text-stone-600">お部屋の確保（20分）が終了しました。お手数ですが、もう一度プランからお選び直しください。</p>
			<a href="/search" class="mt-4 inline-block rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">宿を探す</a>
		</div>
	{:else}
		<Stepper {steps} current={1} />

		<div class="mt-6">
			<HoldTimer expiresAt={data.hold.expiresAt} onexpire={() => (expiredNow = true)} />
		</div>

		{#if form?.message}
			<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
		{/if}

		<div class="mt-6 grid gap-6 md:grid-cols-[1fr_320px]">
			<!-- 入力フォーム -->
			<div>
				{#if !data.member}
					<div class="mb-5 rounded-xl border border-accent-500/40 bg-amber-50/60 p-4 text-sm">
						<p class="font-medium text-brand-900">会員の方はログインすると入力を省けます</p>
						<div class="mt-2 flex gap-2">
							<a href="/auth/login?next={encodeURIComponent(page.url.pathname + page.url.search)}" class="rounded-md bg-brand-800 px-4 py-1.5 text-white hover:bg-brand-700">ログインして進む</a>
							<span class="self-center text-stone-500">または、このままゲストとしてご予約いただけます。</span>
						</div>
					</div>
				{/if}

				<form method="POST" action="?/submit" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
					<input type="hidden" name="holdId" value={data.hold.id} />
					<h2 class="font-display text-lg text-brand-900">お客様情報</h2>

					{#each [{ key: 'name', label: '氏名', ph: '山田 太郎', def: data.member?.name }, { key: 'kana', label: 'フリガナ', ph: 'ヤマダ タロウ', def: data.member?.kana }, { key: 'phone', label: '電話番号', ph: '090-0000-0000', def: data.member?.phone }, { key: 'email', label: 'メールアドレス', ph: 'mail@example.com', def: data.member?.email }] as field}
						<label class="block text-sm">
							<span class="text-stone-600">{field.label} <span class="text-red-500">*</span></span>
							<input
								name={field.key}
								value={form?.values?.[field.key as 'name'] ?? field.def ?? ''}
								placeholder={field.ph}
								class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.[field.key] ? 'border-red-400' : 'border-stone-300'}"
							/>
							{#if form?.errors?.[field.key]}
								<span class="text-xs text-red-600">{form.errors[field.key]}</span>
							{/if}
						</label>
					{/each}

					<div class="grid gap-4 sm:grid-cols-2">
						<label class="block text-sm">
							<span class="text-stone-600">到着予定時刻</span>
							<select name="arrival" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2">
								{#each ['15:00', '16:00', '17:00', '18:00 以降'] as t}
									<option>{t}</option>
								{/each}
							</select>
						</label>
						{#if data.facility.access.shuttle.available}
							<label class="flex items-end gap-2 pb-2 text-sm">
								<input type="checkbox" name="shuttle" class="h-4 w-4" />
								<span>送迎を希望する<span class="block text-xs text-stone-400">{data.facility.access.shuttle.note}</span></span>
							</label>
						{/if}
					</div>

					<label class="block text-sm">
						<span class="text-stone-600">ご要望・連絡事項（任意）</span>
						<textarea name="notes" rows="3" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder="記念日ケーキのメッセージ、アレルギー等"></textarea>
					</label>

					{#if data.member}
						<div class="rounded-lg bg-emerald-50 p-3 text-sm">
							<p class="font-medium text-emerald-800">ポイント利用（残高 {data.member.balance.toLocaleString()}pt ＋ 本予約で {data.member.earn.toLocaleString()}pt 付与予定）</p>
							<div class="mt-2 flex items-center gap-2">
								<input type="number" name="points" min="0" max={data.member.balance} value={data.hold.quote.pointsUsed} class="w-32 rounded-md border border-stone-300 px-3 py-1.5" />
								<span class="text-stone-500">pt を使う（1pt=1円・今すぐ使えます）</span>
							</div>
						</div>
					{/if}

					<button type="submit" class="w-full rounded-lg bg-accent-600 py-3 text-base font-medium text-white hover:bg-accent-500">
						{isCard ? 'お支払いへ進む' : '予約を確定する'}
					</button>
					{#if !isCard}
						<p class="text-center text-xs text-stone-400">お支払いはチェックアウト時に現地にて承ります。</p>
					{/if}
				</form>
			</div>

			<!-- 予約内容サマリ -->
			<aside class="h-fit rounded-2xl border border-stone-200 bg-white p-5">
				<h2 class="mb-3 font-medium text-brand-900">ご予約内容</h2>
				<img src={data.room.photos[0]?.url} alt="" class="mb-3 h-32 w-full rounded-lg object-cover" />
				<dl class="space-y-1.5 text-sm">
					<div class="flex justify-between"><dt class="text-stone-500">施設</dt><dd>{data.facility.name}</dd></div>
					<div class="flex justify-between"><dt class="text-stone-500">客室</dt><dd class="text-right">{data.room.name}</dd></div>
					<div class="flex justify-between"><dt class="text-stone-500">プラン</dt><dd class="max-w-[60%] text-right">{data.plan.name}</dd></div>
					<div class="flex justify-between"><dt class="text-stone-500">チェックイン</dt><dd>{formatDateLongJa(data.hold.checkin)}</dd></div>
					<div class="flex justify-between"><dt class="text-stone-500">泊数・人数</dt><dd>{data.hold.nights}泊・大人{data.hold.adults}名</dd></div>
				</dl>
				<div class="mt-4 border-t border-stone-200 pt-3">
					<PriceBreakdown quote={data.hold.quote} />
				</div>
				<p class="mt-3 rounded bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
					<CancelPolicyNote policy={data.plan.cancellationPolicy} checkin={data.hold.checkin} />
				</p>
			</aside>
		</div>
	{/if}
</div>
