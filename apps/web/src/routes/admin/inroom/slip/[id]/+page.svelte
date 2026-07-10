<script lang="ts">
	// 印刷専用スリップ（A6 カード風）。チェックイン時にゲストへお渡しする。
	// QR（/r/c/<token> の絶対URL）＋8桁コード＋3言語の案内。印刷時は管理画面の枠と操作ボタンを隠す。
	let { data } = $props();

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString('ja-JP', {
			timeZone: 'Asia/Tokyo',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<svelte:head><title>客室スリップ ｜ {data.token.roomCode}</title></svelte:head>

<div class="mx-auto max-w-md">
	<!-- 操作バー（印刷時は非表示） -->
	<div class="no-print mb-4 flex items-center justify-between">
		<a href="/admin/inroom?all=1" class="text-sm text-stone-400 hover:text-stone-600">← 一覧へ戻る</a>
		<button
			type="button"
			onclick={() => window.print()}
			class="rounded-md bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-700"
		>🖨 印刷する</button>
	</div>

	<!-- スリップ本体（A6 相当） -->
	<div class="slip-card mx-auto rounded-2xl border border-stone-300 bg-white p-6 text-center">
		<p class="font-display text-brand-900">YAMADO</p>
		<p class="text-xs text-stone-400">客室のご案内 ／ In-Room Guide ／ 客房資訊</p>

		<div class="my-4 border-y border-dashed border-stone-200 py-3">
			<p class="text-sm text-stone-500">お部屋 / Room</p>
			<p class="font-display text-2xl text-brand-900">{data.token.roomCode}</p>
			{#if data.token.guestName}
				<p class="mt-1 text-sm text-stone-500">{data.token.guestName} 様</p>
			{/if}
		</div>

		<!-- QR（自己生成 SVG・安全） -->
		<div class="qr mx-auto flex justify-center">
			{@html data.qrSvg}
		</div>

		<p class="mt-3 text-sm leading-relaxed text-stone-600">
			お手元のスマートフォンでQRを読み取ってください<br />
			<span class="text-stone-400">Scan the QR code with your phone ／ 請用手機掃描</span>
		</p>

		<!-- 手入力コード -->
		<div class="mt-4 rounded-xl bg-stone-50 py-3">
			<p class="text-xs text-stone-500">QRが読み取れない場合 / Enter code manually</p>
			<p class="mt-1 text-xs text-stone-500">{data.manualUrl}</p>
			<p class="font-mono text-3xl font-bold tracking-[0.35em] text-brand-900">{data.token.shortCode}</p>
		</div>

		<p class="mt-4 text-xs text-stone-400">
			ご利用は {fmtDate(data.token.validTo)} のチェックアウトまで
		</p>
	</div>
</div>

<style>
	/* QR SVG をカード幅に馴染ませる（自己生成 SVG） */
	.qr :global(svg) {
		width: 168px;
		height: 168px;
	}

	.slip-card {
		width: 105mm;
		min-height: 148mm;
	}

	@media print {
		/* 管理画面の枠（サイドバー・ヘッダー・メンテ帯）と操作ボタンを隠す */
		:global(aside),
		:global(header),
		.no-print {
			display: none !important;
		}
		:global(body) {
			background: #fff;
		}
		.slip-card {
			border: 1px solid #999;
			box-shadow: none;
			margin: 0;
		}
	}
</style>
