<script lang="ts">
	import QrCode from '$lib/components/QrCode.svelte';
	let { data } = $props();
	const back = $derived(`/admin/bath${data.date ? `?date=${data.date}` : ''}`);
	const otherSize = $derived(data.size === 'A6' ? 'A7' : 'A6');
	const changeSize = $derived(`/admin/bath/pop?${new URLSearchParams({ stay: data.stay?.stay_id ?? '', ...(data.date ? { date: data.date } : {}), size: otherSize })}`);
</script>

<svelte:head>
	<title>客室インフォメーションPOP ｜ YAMADO</title>
	{@html `<style>@page { size: ${data.size === 'A7' ? '74mm 105mm' : '105mm 148mm'}; margin: 0; }</style>`}
</svelte:head>

<div class="print-shell mx-auto max-w-3xl px-4 py-6">
	<div class="print-hide mb-5 flex flex-wrap items-center gap-3">
		<a href={back} class="text-sm text-stone-600 underline">← 貸切風呂管理へ</a>
		<h1 class="text-lg font-semibold">客室用インフォメーションPOP</h1>
	</div>
	{#if data.error || !data.stay}
		<p class="rounded bg-rose-50 px-4 py-3 text-sm text-rose-800">{data.error}</p>
	{:else}
		<div class="print-hide mb-5 flex flex-wrap items-center gap-2 text-sm">
			<span>{data.stay.room_code}・{data.stay.guest_name}</span>
			<span class="ml-auto">用紙: {data.size}</span>
			<a href={changeSize} class="rounded border px-3 py-2">{otherSize}に切り替え</a>
			<button type="button" onclick={() => window.print()} class="rounded bg-stone-800 px-4 py-2 text-white">印刷する</button>
		</div>
		<div class="pop mx-auto flex flex-col items-center justify-between border border-stone-200 bg-white p-[8mm] text-center shadow-md" class:small={data.size === 'A7'}>
			<div class="w-full">
				<p class="text-[9px] font-semibold tracking-[0.22em] text-stone-500">YAMADO INFORMATION</p>
				<h2 class="mt-2 text-[18px] font-semibold tracking-[0.1em]">{data.facilityName}</h2>
				<p class="mt-2 text-[12px] font-medium">貸切風呂のご予約・客室のご案内</p>
			</div>
			<div class="qr my-3 bg-white p-1"><QrCode value={data.qrUrl} px={190} label="このお部屋の貸切風呂予約・客室案内QR" /></div>
			<div class="w-full">
				<p class="text-[10px] leading-relaxed">スマートフォンで読み取り、<br />ご希望の時間をお選びください。</p>
				<p class="mt-3 border-t border-stone-300 pt-2 text-[10px] font-semibold">{data.stay.room_code} · {data.stay.guest_name}</p>
				<p class="mt-1 text-[9px] text-stone-500">{data.stay.check_in_date} 15:00 〜 {data.stay.check_out_date} 11:00</p>
			</div>
		</div>
		<p class="print-hide mt-4 text-center text-xs text-stone-500">このQRは選択した滞在専用です。客室に置く紙としてお使いください。</p>
	{/if}
</div>

<style>
	.pop { width: 105mm; height: 148mm; }
	.pop.small { width: 74mm; height: 105mm; padding: 5mm; }
	.pop.small :global(.qr svg) { width: 32mm; height: 32mm; }
	.pop:not(.small) :global(.qr svg) { width: 45mm; height: 45mm; }
	@media print {
		:global(body) { margin: 0; background: white !important; }
		:global(header), :global(nav), :global(aside), .print-hide { display: none !important; }
		.print-shell { max-width: none; margin: 0; padding: 0; }
		.pop { box-shadow: none; border: 0; break-inside: avoid; }
	}
</style>
