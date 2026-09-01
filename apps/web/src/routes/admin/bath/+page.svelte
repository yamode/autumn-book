<script lang="ts">
	// 貸切風呂: 予約フォームの中身の編集 ＋ QR コードのテスト。
	//
	// 未入力の欄はアプリの既定文言がそのまま出るので、**空のまま保存しても画面は壊れない**。
	// 写真の追加・削除・並べ替えは押した時点で保存する（持ち帰って消えるのを防ぐ）。
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import QrCode from '$lib/components/QrCode.svelte';
	import type { BathContent, BathContentKey } from '$lib/private-bath-content';

	let { data, form } = $props();

	const LANG_LABEL: Record<string, string> = { ja: '日本語', en: 'English', 'zh-TW': '繁體中文' };

	let lang = $state<string>('ja');
	const current = $derived<BathContent>(data.contents[lang] ?? { fields: {}, images: [] });
	const imagesJson = $derived(JSON.stringify(current.images));

	// QR の宛先は管理画面と同じオリジン。本番で開けばそのまま本番の URL になる。
	const qrUrl = $derived(form?.qr ? `${$page.url.origin}/r/c/${form.qr.token}` : '');

	const dateHref = (d: string) => {
		const p = new URLSearchParams($page.url.search);
		if (d) p.set('date', d);
		else p.delete('date');
		return `?${p.toString()}`;
	};
</script>

<svelte:head><title>貸切風呂 | 管理</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-6">
	<h1 class="text-xl font-semibold">貸切風呂　<span class="text-sm font-normal text-stone-500">{data.facilityName}</span></h1>

	{#if !data.live}
		<p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
			この環境は実データに繋がっていないため、保存できません（本番でお試しください）。
		</p>
	{:else if data.loadError}
		<p class="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{data.loadError}</p>
	{/if}

	{#if form?.error}
		<p class="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{form.error}</p>
	{:else if form?.saved}
		<p class="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
			{LANG_LABEL[form.saved] ?? form.saved} を保存しました。
		</p>
	{/if}

	<!-- ============ 予約フォームの中身 ============ -->
	<section class="mt-6 rounded-lg border bg-white">
		<header class="flex flex-wrap items-center gap-2 border-b px-4 py-2">
			<h2 class="font-medium">予約フォームの文章・写真</h2>
			<div class="ml-auto flex gap-1">
				{#each data.langs as l (l)}
					<button
						type="button"
						class="rounded px-2 py-1 text-sm {lang === l
							? 'bg-stone-800 text-white'
							: 'border text-stone-600 hover:bg-stone-50'}"
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
					<span class="ml-2 text-xs text-stone-400">{f.hint}</span>
					<textarea
						name={`f_${f.key}`}
						rows={f.key === 'lead' || f.key === 'notice' ? 3 : 2}
						class="mt-1 w-full rounded border border-stone-300 px-3 py-2 text-sm"
						placeholder="未入力なら既定の文言が出ます"
						value={current.fields[f.key as BathContentKey] ?? ''}></textarea>
				</label>
			{/each}

			<button
				type="submit"
				disabled={!data.live}
				class="rounded bg-stone-800 px-4 py-2 text-sm text-white disabled:bg-stone-200 disabled:text-stone-400">
				{LANG_LABEL[lang] ?? lang} を保存
			</button>
		</form>

		<!-- 写真 -->
		<div class="border-t px-4 py-4">
			<h3 class="text-sm font-medium text-stone-700">写真（最大12枚・上から順に出ます）</h3>

			{#if current.images.length}
				<ul class="mt-3 space-y-2">
					{#each current.images as img, i (img.url)}
						<li class="flex items-center gap-3 rounded border px-2 py-2">
							<img src={img.url} alt={img.caption || '貸切風呂の写真'} class="h-16 w-24 rounded object-cover" />
							<span class="min-w-0 flex-1 truncate text-sm text-stone-600">{img.caption || '（説明なし）'}</span>
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
										class="rounded border px-2 py-1 text-xs text-stone-600 hover:bg-stone-50 disabled:opacity-40"
										>{label}</button>
								</form>
							{/each}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-2 text-sm text-stone-400">まだ写真はありません。</p>
			{/if}

			<form
				method="POST"
				action="?/addPhoto"
				enctype="multipart/form-data"
				use:enhance
				class="mt-3 flex flex-wrap items-center gap-2">
				<input type="hidden" name="lang" value={lang} />
				<input type="hidden" name="imagesJson" value={imagesJson} />
				{#each data.fields as f (f.key)}
					<input type="hidden" name={`f_${f.key}`} value={current.fields[f.key as BathContentKey] ?? ''} />
				{/each}
				<input type="file" name="photo" accept="image/*" class="text-sm" />
				<input
					type="text"
					name="caption"
					placeholder="説明（任意）"
					class="rounded border border-stone-300 px-2 py-1 text-sm" />
				<button
					type="submit"
					disabled={!data.live || current.images.length >= 12}
					class="rounded border px-3 py-1 text-sm hover:bg-stone-50 disabled:opacity-40">写真を追加</button>
			</form>
		</div>
	</section>

	<!-- ============ QR コードのテスト ============ -->
	<section class="mt-6 rounded-lg border bg-white">
		<header class="border-b px-4 py-2">
			<h2 class="font-medium">QR コードのテスト</h2>
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
						class="ml-1 rounded border border-stone-300 px-2 py-1 text-sm" />
				</label>
				<button type="submit" class="rounded border px-3 py-1 text-sm hover:bg-stone-50">この日の予約を出す</button>
				{#if data.date}
					<a href={dateHref('')} class="text-sm text-stone-500 underline">今日に戻す</a>
				{/if}
			</form>

			{#if data.staysError}
				<p class="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-800">{data.staysError}</p>
			{:else if !data.stays.length}
				<p class="mt-3 text-sm text-stone-400">この日にご滞在のお客様はいません。</p>
			{:else}
				<ul class="mt-3 divide-y">
					{#each data.stays as s (s.stay_id)}
						<li class="flex flex-wrap items-center gap-3 py-2 text-sm">
							<span class="min-w-16 font-medium">{s.room_code}</span>
							<span class="text-stone-600">{s.guest_name}</span>
							<span class="text-xs text-stone-400">{s.check_in_date}〜{s.check_out_date}</span>
							{#if s.token}
								<span class="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">発行済み</span>
							{/if}
							<form method="POST" action="?/issueQr" use:enhance class="ml-auto">
								<input type="hidden" name="stayId" value={s.stay_id} />
								<input type="hidden" name="roomCode" value={s.room_code} />
								<input type="hidden" name="guestName" value={s.guest_name} />
								<input type="hidden" name="checkOutDate" value={s.check_out_date} />
								<button
									type="submit"
									disabled={!data.live}
									class="rounded border px-3 py-1 text-xs hover:bg-stone-50 disabled:opacity-40"
									>QR を出す</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}

			{#if form?.qr}
				<div class="mt-4 rounded-lg border bg-stone-50 p-4">
					<div class="flex flex-wrap items-start gap-4">
						<QrCode value={qrUrl} px={180} label="貸切風呂の予約フォームへの QR コード" />
						<div class="min-w-0 flex-1 text-sm">
							<p class="font-medium">{form.qr.roomCode}</p>
							<p class="mt-1 break-all text-xs text-stone-500">{qrUrl}</p>
							<p class="mt-2 text-stone-600">
								手入力コード <span class="font-mono text-base tracking-widest">{form.qr.short_code}</span>
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
