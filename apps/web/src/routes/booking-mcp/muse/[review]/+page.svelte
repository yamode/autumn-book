<script lang="ts">
	import { TRANSPORT_OTHER } from '$lib/booking-standard-fields';
	import { enhance } from '$app/forms';
	const { data, form } = $props();
	const labels = { cash: '現金', card: 'クレジットカード', paypay: 'PayPay' };
	let transport = $state('');
	let sending = $state(false);
	const pickupRequired = $derived(transport === data.fields.pickup.when && data.fields.pickup.choices.length > 0);
	const yen = (amount: number) => amount.toLocaleString('ja-JP') + '円';
</script>

<svelte:head><title>現地払いの予約確認 | 山人Book</title></svelte:head>

<main class="mx-auto max-w-lg space-y-5 px-5 py-10">
	<img src="/brand/yamado-connector.png" alt="山人" width="56" height="56" class="rounded-lg" />
	<h1 class="text-2xl font-semibold">山人の現地払い予約</h1>
	{#if data.bookingCode}
		<p>予約が確定しました。Museに戻ると予約番号を確認できます。</p>
		<p class="text-xl font-semibold">予約番号 {data.bookingCode}</p>
		<a class="underline" href="/account/reservations">山人Bookの予約一覧</a>
	{:else if data.closed}
		<p>確認期限が切れました。Museで空室を検索し直してください。</p>
	{:else}
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border p-4">
			<dt>施設</dt><dd>{data.facility}</dd>
			<dt>プラン</dt><dd>{data.plan}</dd>
			<dt>客室</dt><dd>{data.room}</dd>
			<dt>宿泊日</dt><dd>{data.checkin}から{data.nights}泊</dd>
			<dt>人数</dt><dd>大人{data.adults}名・1室</dd>
			<dt>現地払い合計</dt><dd class="font-semibold">{yen(data.lodging + data.bathTax)}（入湯税 {yen(data.bathTax)}込み）</dd>
			<dt>取消条件</dt><dd class="whitespace-pre-line">{data.cancellation}</dd>
		</dl>
		{#if form?.message}<p role="alert" class="text-red-800">{form.message}</p>{/if}
		<form method="POST" class="space-y-3" use:enhance={() => {
			sending = true;
			return async ({ update }) => {
				try { await update({ reset: false }); }
				finally { sending = false; }
			};
		}}>
			<label class="block">現地でのお支払い方法
				<select name="onsiteMethod" required class="block rounded border p-2">
					<option value="">選択してください</option>
					{#each data.methods as method}<option value={method}>{labels[method]}</option>{/each}
				</select>
			</label>
			<label class="block">{data.fields.arrival.label}
				<select name="arrival" class="block rounded border p-2">
					<option value="">未定</option>
					{#each data.fields.arrival.choices as choice}<option value={choice}>{choice}</option>{/each}
				</select>
			</label>
			<label class="block">{data.fields.transport.label}
				<select name="transport" bind:value={transport} required={data.fields.transport.required} class="block rounded border p-2">
					<option value="">選択してください</option>
					{#each data.fields.transport.choices as choice}<option value={choice}>{choice}</option>{/each}
				</select>
			</label>
			{#if transport === TRANSPORT_OTHER}
				<label class="block">交通手段の詳細 <input name="transportOther" class="block rounded border p-2" maxlength="60" required /></label>
			{/if}
			{#if pickupRequired}
				<label class="block">{data.fields.pickup.label}
					<select name="pickup" required class="block rounded border p-2">
						<option value="">選択してください</option>
						{#each data.fields.pickup.choices as choice}<option value={choice}>{choice}</option>{/each}
					</select>
				</label>
			{/if}
			{#if data.askGender}
				<label class="block">男性の人数
					<select name="male" required class="block rounded border p-2">
						<option value="">選択してください</option>
						{#each Array.from({ length: data.adults + 1 }, (_, count) => count) as count}<option value={count}>男性{count}名・女性{data.adults - count}名</option>{/each}
					</select>
				</label>
			{/if}
			<label class="block"><input name="agreed" type="checkbox" value="yes" required /> 予約内容と<a href="/legal/yakkan" target="_blank" rel="noreferrer" class="underline">宿泊約款</a>を確認し、現地払いの予約に同意する</label>
			<button type="submit" disabled={sending} class="rounded-lg bg-brand-800 px-4 py-2 text-white">{sending ? '予約を確定しています…' : '現地払いで予約を確定する'}</button>
		</form>
	{/if}
</main>
