<script lang="ts">
	// Autumn Live（閲覧専用）。いまは入れることの確認用の空の画面。表示の中身は docs/prototypes/autumn-live/ の v13 を移す（docs/autumn-live.md §8）
	let { data } = $props();
	const kindLabel = $derived(data.kind === 'display' ? '表示専用の端末' : '業務 PC');
</script>

<svelte:head>
	<title>Autumn Live</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="live">
	<h1>Autumn Live</h1>
	<p>入場できました（{kindLabel}）。画面の中身はこれから載せます。</p>
</main>

<style>
	.live {
		min-height: 100vh;
		display: grid;
		place-content: center;
		gap: 12px;
		text-align: center;
		padding-inline: max(20px, env(safe-area-inset-left, 0px));
		background: linear-gradient(#060a19, #141c38);
		color: #ece8dc;
	}
	h1 {
		margin: 0;
		font-family: 'Shippori Mincho B1', serif;
		font-size: 32px;
		letter-spacing: 0.04em;
	}
	p {
		margin: 0;
		color: rgba(236, 232, 220, 0.66);
	}
</style>
