<script lang="ts">
	// 客室ごとの入口QR（A6 POP「内線電話・館内情報」）の印刷（2026-11-20）。1 部屋 1 枚。
	import { enhance } from '$app/forms';
	import QrCode from '$lib/components/QrCode.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	let { data, form } = $props();

	// 印刷する部屋（既定は全室）
	let picked = $state<string[] | null>(null);
	const selected = $derived(picked ?? data.rooms.map((r) => r.roomId));
	const printRooms = $derived(data.rooms.filter((r) => selected.includes(r.roomId)));
	const toggle = (id: string) => {
		picked = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
	};
	// 施設のロゴ（男鹿は「山人 -oga-」、それ以外は山人の筆文字）
	const logo = $derived(data.slug === 'oga' ? { src: '/brand/yamado-oga-logo.svg', w: 138, h: 71 } : { src: '/brand/yamado-brush-mark.png', w: 256, h: 122 });
</script>

<svelte:head>
	<title>客室ごとの入口QR ｜ YAMADO</title>
	{@html `<style>@page { size: 105mm 148mm; margin: 0; }</style>`}
</svelte:head>

<div class="print-shell mx-auto max-w-3xl px-0 py-2 sm:px-4 sm:py-6">
	<div class="print-hide">
		<PageHeader title="客室ごとの入口QR" facility={data.facilityName} description="客室に置く A6 の POP（内線電話・館内情報）の印刷です。1 部屋 1 枚です。" />
	</div>
	<div class="print-hide mb-5 space-y-3 text-sm leading-relaxed">
		<p class="text-stone-600">
			QR には部屋ごとの鍵が入っています。読んだお客様は、<b>滞在コードを入れなくても「フロントを呼ぶ」が使え</b>、受電端末には部屋番号が出ます。食事時間・貸切風呂のご予約・Wi-Fi は、従来どおり館内図の 6 桁の滞在コードを入れると出ます。
		</p>
		<p class="text-stone-600">
			QR を撮られた・持ち出されたときは、その部屋の「発行し直す」を押してから POP を刷り直してください（古い QR は使えなくなります）。
		</p>
		{#if data.error}
			<p class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">{data.error}</p>
		{/if}
		{#if form?.reissueError}
			<p class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">{form.reissueError}</p>
		{/if}
		{#if data.rooms.length}
			<div class="rounded-xl border border-stone-200 bg-white p-3">
				<div class="mb-2 flex flex-wrap items-center gap-2">
					<span class="mr-auto text-stone-600">印刷する部屋：<b class="text-stone-800">{printRooms.length}</b> / {data.rooms.length} 室（用紙 A6）</span>
					<button type="button" class="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-50" onclick={() => (picked = data.rooms.map((r) => r.roomId))}>全室</button>
					<button type="button" class="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-50" onclick={() => (picked = [])}>解除</button>
					<button type="button" onclick={() => window.print()} disabled={!printRooms.length} class="rounded-lg bg-brand-800 px-4 py-1.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50">印刷する</button>
				</div>
				<ul class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
					{#each data.rooms as r (r.roomId)}
						<li class="flex items-center justify-between gap-2 rounded-lg border border-stone-200 px-2 py-1.5">
							<label class="flex min-w-0 items-center gap-2">
								<input type="checkbox" checked={selected.includes(r.roomId)} onchange={() => toggle(r.roomId)} />
								<span class="truncate">{r.roomNumber}{r.name && r.name !== r.roomNumber ? ` ${r.name}` : ''}</span>
							</label>
							<form method="POST" action="?/reissue" use:enhance={({ cancel }) => { if (!confirm(`${r.roomNumber} の QR を発行し直します。今置いてある POP の QR は使えなくなります。よろしいですか？`)) cancel(); }}>
								<input type="hidden" name="room" value={r.roomId} />
								<button class="shrink-0 text-xs text-stone-500 underline hover:text-stone-800">{form?.reissued === r.roomId ? '発行し直しました' : '発行し直す'}</button>
							</form>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>

	<div class="pops space-y-4">
		{#each printRooms as r (r.roomId)}
			<div class="pop mx-auto flex flex-col items-center justify-between border border-stone-200 bg-white text-center text-black shadow-md">
				<div class="w-full">
					<h2 class="title">内線電話・館内情報</h2>
					<p class="sub">Hotel &amp; Travel information</p>
				</div>
				<div class="qr"><QrCode value={r.qrUrl} px={190} label={`${r.roomNumber} の入口QRコード`} /></div>
				<p class="room">ROOM {r.roomNumber}</p>
				<img class="logo" src={logo.src} width={logo.w} height={logo.h} alt={data.facilityName} />
			</div>
		{/each}
	</div>
</div>

<style>
	.pop { width: 105mm; height: 148mm; padding: 13mm 8mm 9mm; }
	.title { font-size: 25pt; font-weight: 700; letter-spacing: 0.02em; line-height: 1.2; }
	.sub { margin-top: 5mm; font-size: 12.5pt; }
	.qr :global(svg) { width: 45mm; height: 45mm; }
	.room { font-size: 14pt; letter-spacing: 0.02em; }
	.logo { width: 23mm; height: auto; }
	@media screen and (max-width: 30rem) {
		.pop { zoom: 0.8; }
	}
	@media print {
		:global(body) { margin: 0; background: #fff !important; }
		:global(header), :global(nav), :global(aside), .print-hide { display: none !important; }
		.print-shell { padding: 0 !important; max-width: none !important; }
		.pops { margin: 0 !important; }
		.pops > :global(* + *) { margin-top: 0 !important; }
		.pop { border: 0; box-shadow: none; margin: 0; break-after: page; page-break-after: always; }
		.pop:last-child { break-after: auto; page-break-after: auto; }
	}
</style>
