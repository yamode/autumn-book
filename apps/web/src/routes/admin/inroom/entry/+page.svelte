<script lang="ts">
	// 客室に常設する「客室案内の入口QR」の印刷（2026-10-09）。貸切風呂の客室POP（/admin/bath/pop）と同じ紙の形。
	import QrCode from '$lib/components/QrCode.svelte';
	import { downloadQrPng } from '$lib/qr-png';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	let { data } = $props();
	const otherSize = $derived(data.size === 'A6' ? 'A7' : 'A6');

	// QRコードだけを PNG で保存する（2026-10-10 指示。チラシ・館内掲示など別の版下に貼る用）
	function downloadPng() {
		downloadQrPng(data.qrUrl, `客室案内の入口QR_${data.facilityName}`);
	}
</script>

<svelte:head>
	<title>客室案内の入口QR ｜ YAMADO</title>
	{@html `<style>@page { size: ${data.size === 'A7' ? '74mm 105mm' : '105mm 148mm'}; margin: 0; }</style>`}
</svelte:head>

<div class="print-shell mx-auto max-w-3xl px-0 py-2 sm:px-4 sm:py-6">
	<!-- 画面の見出しと操作（印刷では出さない） -->
	<div class="print-hide">
		<PageHeader title="客室案内の入口QR" facility={data.facilityName} description="客室に常設する QR の印刷です。" />
	</div>
	<div class="print-hide mb-5 space-y-2 text-sm leading-relaxed">
		<p class="text-stone-600">
			お客様・日付によらず同じQRです。客室に置いたままで使えます。読み取ったお客様が、館内図に記載の6桁の滞在コードを入れると、その方のその日の客室案内（食事時間・貸切風呂のご予約など）が開きます。
		</p>
		<p class="text-stone-600">
			コードが使えるのは <b>チェックイン日の 9:00 〜 チェックアウト日の 11:00</b> です。一度入れたスマートフォンは、次からコードなしで開きます。
		</p>
		<div class="grid grid-cols-2 items-center gap-2 rounded-xl border border-stone-200 bg-white p-3 sm:flex sm:flex-wrap">
			<span class="col-span-2 text-stone-600 sm:col-span-1 sm:mr-auto">用紙: <span class="font-medium text-stone-800">{data.size}</span></span>
			<a href={`/admin/inroom/entry?size=${otherSize}`} class="rounded-lg border border-stone-300 px-3 py-2 text-center hover:bg-stone-50">{otherSize}に切り替え</a>
			<button type="button" onclick={downloadPng} class="rounded-lg border border-stone-300 px-3 py-2 hover:bg-stone-50">QRをPNGで保存</button>
			<button type="button" onclick={() => window.print()} class="col-span-2 rounded-lg bg-brand-800 px-4 py-2 font-medium text-white hover:bg-brand-700 sm:col-span-1">印刷する</button>
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
			<p class="text-[10px] leading-relaxed">スマートフォンで読み取り、<br />館内図に記載の<br />6桁の滞在コードを入力してください。</p>
			<p class="mt-1.5 text-[8.5px] leading-snug text-stone-500">Scan and enter the 6-digit stay code<br />shown on the floor map.</p>
			<p class="mt-3 border-t border-stone-300 pt-2 text-[9px] text-stone-500">ご利用: チェックイン日 9:00 〜 チェックアウト日 11:00</p>
		</div>
	</div>
	<p class="print-hide mt-4 break-all text-center font-mono text-xs text-stone-500">{data.qrUrl}</p>
</div>

<style>
	.pop { width: 105mm; height: 148mm; }
	.pop.small { width: 74mm; height: 105mm; padding: 5mm; }
	.pop.small :global(.qr svg) { width: 32mm; height: 32mm; }
	.pop:not(.small) :global(.qr svg) { width: 45mm; height: 45mm; }
	/* スマホの画面では紙の見本を縮めて横にはみ出さないようにする（印刷の大きさは変えない） */
	@media screen and (max-width: 30rem) {
		.pop:not(.small) { zoom: 0.8; }
	}
	@media print {
		:global(body) { margin: 0; background: white !important; }
		:global(header), :global(nav), :global(aside), .print-hide { display: none !important; }
		.print-shell { max-width: none; margin: 0; padding: 0; }
		.pop { box-shadow: none; border: 0; break-inside: avoid; }
	}
</style>
