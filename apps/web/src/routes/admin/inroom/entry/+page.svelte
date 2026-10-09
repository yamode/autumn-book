<script lang="ts">
	// 客室に常設する「客室案内の入口QR」の印刷（2026-10-09）。貸切風呂の客室POP（/admin/bath/pop）と同じ紙の形。
	import QrCode from '$lib/components/QrCode.svelte';
	let { data } = $props();
	const otherSize = $derived(data.size === 'A6' ? 'A7' : 'A6');
</script>

<svelte:head>
	<title>客室案内の入口QR ｜ YAMADO</title>
	{@html `<style>@page { size: ${data.size === 'A7' ? '74mm 105mm' : '105mm 148mm'}; margin: 0; }</style>`}
</svelte:head>

<div class="print-shell mx-auto max-w-3xl px-4 py-6">
	<div class="print-hide mb-5 flex flex-wrap items-center gap-3">
		<a href="/admin/inroom" class="text-sm text-stone-600 underline">← 客室案内へ</a>
		<h1 class="text-lg font-semibold">客室案内の入口QR（客室に常設）</h1>
	</div>
	<div class="print-hide mb-5 space-y-2 text-sm">
		<p class="text-stone-600">
			お客様・日付によらず同じQRです。客室に置いたままで使えます。読み取ったお客様が、チェックイン時にお渡しする6桁のコードを入れると、その方のその日の客室案内（食事時間・貸切風呂のご予約など）が開きます。
		</p>
		<p class="text-stone-600">
			コードが使えるのは <b>チェックイン日の 12:00 〜 チェックアウト日の 11:00</b> です。一度入れたスマートフォンは、次からコードなしで開きます。
		</p>
		<div class="flex flex-wrap items-center gap-2">
			<span>{data.facilityName}</span>
			<span class="ml-auto">用紙: {data.size}</span>
			<a href={`/admin/inroom/entry?size=${otherSize}`} class="rounded border px-3 py-2">{otherSize}に切り替え</a>
			<button type="button" onclick={() => window.print()} class="rounded bg-stone-800 px-4 py-2 text-white">印刷する</button>
		</div>
	</div>
	<div class="pop mx-auto flex flex-col items-center justify-between border border-stone-200 bg-white p-[8mm] text-center shadow-md" class:small={data.size === 'A7'}>
		<div class="w-full">
			<p class="text-[9px] font-semibold tracking-[0.22em] text-stone-500">YAMADO INFORMATION</p>
			<h2 class="mt-2 text-[18px] font-semibold tracking-[0.1em]">{data.facilityName}</h2>
			<p class="mt-2 text-[12px] font-medium">客室のご案内・貸切風呂のご予約</p>
			<p class="mt-0.5 text-[9px] tracking-[0.08em] text-stone-500">Room Guide / 客房指南</p>
		</div>
		<div class="qr my-3 bg-white p-1"><QrCode value={data.qrUrl} px={190} label="客室案内の入口QRコード" /></div>
		<div class="w-full">
			<p class="text-[10px] leading-relaxed">スマートフォンで読み取り、<br />チェックイン時にお渡しした<br />6桁のコードを入力してください。</p>
			<p class="mt-1.5 text-[8.5px] leading-snug text-stone-500">Scan and enter the 6-digit code<br />given at check-in.</p>
			<p class="mt-3 border-t border-stone-300 pt-2 text-[9px] text-stone-500">ご利用: チェックイン日 12:00 〜 チェックアウト日 11:00</p>
		</div>
	</div>
	<p class="print-hide mt-4 break-all text-center font-mono text-xs text-stone-500">{data.qrUrl}</p>
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
