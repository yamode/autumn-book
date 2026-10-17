<script lang="ts">
	// 貸切風呂: 予約フォームの中身の編集 ＋ QR コードのテスト。
	//
	// 未入力の欄はアプリの既定文言がそのまま出るので、**空のまま保存しても画面は壊れない**。
	// 写真の追加・削除・並べ替えは押した時点で保存する（持ち帰って消えるのを防ぐ）。
	import { enhance } from '$lib/enhance';
	import { page } from '$app/stores';
	import QrCode from '$lib/components/QrCode.svelte';
	import AdminIcon from '$lib/components/admin/AdminIcon.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import type { BathContent, BathContentKey } from '$lib/private-bath-content';

	let { data, form } = $props();

	const LANG_LABEL: Record<string, string> = { ja: '日本語', en: 'English', 'zh-TW': '繁體中文' };

	let lang = $state<string>('ja');
	const current = $derived<BathContent>(data.contents[lang] ?? { fields: {}, images: [] });
	const imagesJson = $derived(JSON.stringify(current.images));

	// QR の宛先は管理画面と同じオリジン。本番で開けばそのまま本番の URL になる。
	const qrUrl = $derived(form?.qr ? `${$page.url.origin}/r/c/${form.qr.token}` : '');

	// 料金設定。保存し直して data が変わったら画面の選択も追従させる。
	let paid = $state(false);
	let priceInput = $state('');
	let freeSet = $state<string[]>([]);
	$effect.pre(() => {
		paid = data.pricing.price > 0;
		priceInput = data.pricing.price > 0 ? String(data.pricing.price) : '';
		freeSet = [...data.pricing.freeChannels];
	});
	const channelGroups = $derived([
		{ title: '公式サイト・自社', opts: data.channelOptions.filter((c) => c.own) },
		{ title: 'OTA・旅行会社ほか', opts: data.channelOptions.filter((c) => !c.own) }
	]);
	const PAID_CHOICES = [
		{ v: false, label: '無料' },
		{ v: true, label: '有料' }
	];
	const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

	const dateHref = (d: string) => {
		const p = new URLSearchParams($page.url.search);
		if (d) p.set('date', d);
		else p.delete('date');
		return `?${p.toString()}`;
	};
</script>

<svelte:head><title>貸切風呂 ｜ 山人管理</title></svelte:head>

<div class="max-w-4xl">
	<PageHeader title="貸切風呂" facility={data.facilityName} description="客室案内の貸切風呂の予約フォームに出す文章・写真の編集と、実際のご予約の QR コードのテストです。" />

	{#if !data.live}
		<p class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
			この環境は実データに繋がっていないため、保存できません（本番でお試しください）。
		</p>
	{:else if data.loadError}
		<p class="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{data.loadError}</p>
	{/if}

	{#if form?.error}
		<p class="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{form.error}</p>
	{:else if form?.saved}
		<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
			{LANG_LABEL[form.saved] ?? form.saved} を保存しました。
		</p>
	{/if}

	<!-- ============ 料金 ============ -->
	<section class="mb-5 rounded-xl border border-stone-200 bg-white">
		<header class="border-b border-stone-200 px-4 py-3">
			<h2 class="flex items-center gap-2 text-sm font-semibold text-stone-800"><AdminIcon name="receipt" class="h-4 w-4 shrink-0 text-stone-500" />料金</h2>
			<p class="mt-1 text-xs text-stone-500">
				有料のときは予約フォームに料金が出て、予約が入ると PMS のその部屋の請求書に「貸切風呂」の明細が自動で入ります（1枠ごと・税込・税10%）。取り消すと明細も外れます。
			</p>
		</header>

		{#if data.pricingError || form?.pricingError}
			<p class="mx-4 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{form?.pricingError ?? data.pricingError}</p>
		{:else if form?.pricingSaved}
			<p class="mx-4 mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
				料金を保存しました。{form.demo ? '（デモ環境のため、この画面の中だけの保存です）' : 'これから入る予約に効きます（入っている予約の金額は変わりません）。'}
			</p>
		{/if}

		<form method="POST" action="?/savePricing" use:enhance class="space-y-4 px-4 py-4">
			<fieldset>
				<legend class="text-sm font-medium text-stone-700">{data.facilityName} の貸切風呂は</legend>
				<div class="mt-2 flex flex-wrap gap-2">
					{#each PAID_CHOICES as { v, label } (label)}
						<label class="flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 text-sm sm:flex-none {paid === v ? 'border-brand-700 bg-brand-50 font-medium text-brand-900' : 'border-stone-300 text-stone-600 hover:bg-stone-50'}">
							<input type="radio" name="paid" value={v ? '1' : '0'} checked={paid === v} onchange={() => (paid = v)} class="sr-only" />
							{label}
						</label>
					{/each}
				</div>
			</fieldset>

			{#if paid}
				<label class="block">
					<span class="text-sm font-medium text-stone-700">1枠の料金（税込）</span>
					<span class="mt-1 flex items-center gap-2">
						<input name="price" inputmode="numeric" bind:value={priceInput} placeholder="2200" class="w-36 rounded-md border border-stone-300 px-3 py-2 text-right text-sm" />
						<span class="text-sm text-stone-600">円</span>
					</span>
				</label>

				<fieldset>
					<legend class="text-sm font-medium text-stone-700">この予約経路のお客様は無料にする</legend>
					<p class="text-xs text-stone-400">チェックした経路の予約は 0円 で予約でき、明細も入りません。経路の分からない予約も無料として扱います。</p>
					{#each channelGroups as g (g.title)}
						<p class="mt-3 text-xs font-medium text-stone-500">{g.title}</p>
						<div class="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
							{#each g.opts as c (c.code)}
								<label class="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-stone-50">
									<input type="checkbox" name="freeChannel" value={c.code} bind:group={freeSet} class="h-4 w-4 rounded border-stone-300" />
									{c.name}
								</label>
							{/each}
						</div>
					{/each}
				</fieldset>
			{:else}
				<!-- 無料の施設でも経路の選択は持ち越す（有料に戻したときに選び直さないため） -->
				{#each freeSet as c (c)}<input type="hidden" name="freeChannel" value={c} />{/each}
				<p class="text-sm text-stone-500">どの経路のお客様も無料です。予約フォームには「無料」と出て、明細は入りません。</p>
			{/if}

			<div class="flex flex-wrap items-center gap-3">
				<button type="submit" class="w-full rounded-lg bg-brand-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 sm:w-auto">料金を保存</button>
				<span class="text-xs text-stone-500">
					いまの設定: {data.pricing.price > 0 ? `有料 ${yen(data.pricing.price)}／枠（無料の経路 ${data.pricing.freeChannels.length}件）` : '無料'}
				</span>
			</div>
		</form>
	</section>

	<!-- ============ 予約フォームの中身 ============ -->
	<section class="rounded-xl border border-stone-200 bg-white">
		<header class="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-3">
			<h2 class="flex items-center gap-2 text-sm font-semibold text-stone-800"><AdminIcon name="bath" class="h-4 w-4 shrink-0 text-stone-500" />予約フォームの文章・写真</h2>
			<!-- 言語の切り替え（スマホでは見出しの下に1行で） -->
			<div class="flex w-full gap-1 sm:ml-auto sm:w-auto">
				{#each data.langs as l (l)}
					<button
						type="button"
						class="min-h-9 flex-1 rounded-lg px-3 py-1 text-sm sm:flex-none {lang === l
							? 'bg-stone-800 text-white'
							: 'border border-stone-300 text-stone-600 hover:bg-stone-50'}"
						onclick={() => (lang = l)}>{LANG_LABEL[l] ?? l}</button>
				{/each}
			</div>
		</header>

		<form method="POST" action="?/save" use:enhance class="space-y-4 px-4 py-4">
			<input type="hidden" name="lang" value={lang} />
			<input type="hidden" name="imagesJson" value={imagesJson} />

			{#each data.fields as f (f.key)}
				<label class="block">
					<span class="text-sm font-medium text-stone-700">{f.label}</span>
					<span class="block text-xs text-stone-400 sm:ml-2 sm:inline">{f.hint}</span>
					<textarea
						name={`f_${f.key}`}
						rows={f.key === 'lead' || f.key === 'notice' ? 3 : 2}
						class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
						placeholder="未入力なら既定の文言が出ます"
						value={current.fields[f.key as BathContentKey] ?? ''}></textarea>
				</label>
			{/each}

			<button
				type="submit"
				disabled={!data.live}
				class="w-full rounded-lg bg-brand-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:bg-stone-200 disabled:text-stone-400 sm:w-auto">
				{LANG_LABEL[lang] ?? lang} を保存
			</button>
		</form>

		<!-- 写真 -->
		<div class="border-t border-stone-200 px-4 py-4">
			<h3 class="text-sm font-semibold text-stone-800">写真<span class="ml-1 font-normal text-stone-500">（最大12枚・上から順に出ます）</span></h3>

			{#if current.images.length}
				<ul class="mt-3 space-y-2">
					{#each current.images as img, i (img.url)}
						<li class="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 px-2 py-2">
							<img src={img.url} alt={img.caption || '貸切風呂の写真'} class="h-16 w-24 rounded object-cover" />
							<span class="min-w-0 flex-1 truncate text-sm text-stone-600">{img.caption || '（説明なし）'}</span>
							<!-- 並べ替え・削除（スマホでは写真の下に回る） -->
							<div class="ml-auto flex gap-1">
							{#each [['up', '↑'], ['down', '↓'], ['remove', '削除']] as [op, label] (op)}
								<form method="POST" action="?/editPhoto" use:enhance>
									<input type="hidden" name="lang" value={lang} />
									<input type="hidden" name="imagesJson" value={imagesJson} />
									<input type="hidden" name="op" value={op} />
									<input type="hidden" name="index" value={i} />
									{#each data.fields as f (f.key)}
										<input type="hidden" name={`f_${f.key}`} value={current.fields[f.key as BathContentKey] ?? ''} />
									{/each}
									<button
										type="submit"
										disabled={!data.live}
										class="min-h-9 min-w-9 rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50 disabled:opacity-40"
										>{label}</button>
								</form>
							{/each}
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-2 text-sm text-stone-400">まだ写真はありません。</p>
			{/if}

			<form
				method="POST"
				action="?/addPhoto" data-reset
				enctype="multipart/form-data"
				use:enhance
				class="mt-3 flex flex-wrap items-center gap-2">
				<input type="hidden" name="lang" value={lang} />
				<input type="hidden" name="imagesJson" value={imagesJson} />
				{#each data.fields as f (f.key)}
					<input type="hidden" name={`f_${f.key}`} value={current.fields[f.key as BathContentKey] ?? ''} />
				{/each}
				<input type="file" name="photo" accept="image/*" class="w-full text-sm file:mr-2 file:rounded-md file:border file:border-stone-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:text-stone-700 sm:w-auto" />
				<input
					type="text"
					name="caption"
					placeholder="説明（任意）"
					class="min-w-0 flex-1 rounded-md border border-stone-300 px-2 py-2 text-sm sm:flex-none sm:py-1.5" />
				<button
					type="submit"
					disabled={!data.live || current.images.length >= 12}
					class="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50 disabled:opacity-40">写真を追加</button>
			</form>
		</div>
	</section>

	<!-- ============ QR コードのテスト ============ -->
	<section class="mt-5 rounded-xl border border-stone-200 bg-white">
		<header class="border-b border-stone-200 px-4 py-3">
			<h2 class="flex items-center gap-2 text-sm font-semibold text-stone-800"><AdminIcon name="qr" class="h-4 w-4 shrink-0 text-stone-500" />QR コードのテスト</h2>
			<p class="mt-1 text-xs text-stone-500">
				実際のご予約の QR を出します。スマホで読むと、そのお部屋として予約フォームまで通せます。<br />
				同じご予約なら何度押しても同じ QR です（館内図を刷り直しても紙が生き続けるのと同じ仕組み）。
			</p>
		</header>

		<div class="px-4 py-4">
			<form method="GET" class="flex flex-wrap items-center gap-2">
				<label class="text-sm text-stone-600">
					日付
					<input
						type="date"
						name="date"
						value={data.date ?? ''}
						class="ml-1 rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
				</label>
				<button type="submit" class="min-h-9 rounded-lg border border-stone-300 px-3 py-1 text-sm hover:bg-stone-50">この日の予約を出す</button>
				{#if data.date}
					<a href={dateHref('')} class="text-sm text-stone-500 underline">今日に戻す</a>
				{/if}
			</form>

			{#if data.staysError}
				<p class="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-800">{data.staysError}</p>
			{:else if !data.stays.length}
				<p class="mt-3 text-sm text-stone-400">この日にご滞在のお客様はいません。</p>
			{:else}
				<ul class="mt-3 divide-y divide-stone-100">
					{#each data.stays as s (s.stay_id)}
						<li class="flex flex-wrap items-center gap-3 py-2 text-sm">
							<span class="min-w-16 font-medium">{s.room_code}</span>
							<span class="text-stone-600">{s.guest_name}</span>
							<span class="text-xs text-stone-400">{s.check_in_date}〜{s.check_out_date}</span>
							{#if s.token}
								<span class="inline-flex items-center rounded-full bg-stone-50 px-2 py-0.5 text-[11px] font-medium text-stone-500 ring-1 ring-stone-200 ring-inset">発行済み</span>
							{/if}
							<form method="POST" action="?/issueQr" use:enhance class="ml-auto">
								<input type="hidden" name="stayId" value={s.stay_id} />
								<input type="hidden" name="roomCode" value={s.room_code} />
								<input type="hidden" name="guestName" value={s.guest_name} />
								<input type="hidden" name="checkOutDate" value={s.check_out_date} />
								<button
									type="submit"
									disabled={!data.live}
									class="min-h-9 rounded-lg border border-stone-300 px-3 py-1 text-xs hover:bg-stone-50 disabled:opacity-40"
									>QR を出す</button>
							</form>
							<a href={`/admin/bath/pop?${new URLSearchParams({ stay: s.stay_id, ...(data.date ? { date: data.date } : {}), size: 'A6' })}`} class="inline-flex min-h-9 items-center rounded-lg border border-stone-300 px-3 py-1 text-xs text-stone-700 hover:bg-stone-50">客室POP</a>
						</li>
					{/each}
				</ul>
			{/if}

			{#if form?.qr}
				<div class="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
					<div class="flex flex-wrap items-start gap-4">
						<QrCode value={qrUrl} px={180} label="貸切風呂の予約フォームへの QR コード" />
						<div class="min-w-0 flex-1 text-sm">
							<p class="font-medium">{form.qr.roomCode}</p>
							<p class="mt-1 break-all text-xs text-stone-500">{qrUrl}</p>
							<p class="mt-2 text-stone-600">
								滞在コード <span class="font-mono text-base tracking-widest">{form.qr.short_code}</span>
							</p>
							<p class="mt-2 text-xs text-stone-400">
								QR を読むと httpOnly Cookie に交換され、URL からトークンは消えます。
							</p>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</section>
</div>
