<script lang="ts">
	// 客室案内のプレビュー（2026-10-17 指示）。お客様のスマホと同じ幅の枠で、客室案内（/r）をこの画面の中に開く。
	// 開き方は2つ（preview/open が Cookie を切り替えて /r へ送る）:
	//   ・ご滞在中（見本）… PMS の「見本の館内図」と同じ見本の滞在。食事時間は見本・貸切風呂の予約は本番の台帳に入る
	//   ・コード入力前   … 入口QRを読んだだけの表示（館内案内のみ・滞在コードの入力欄）
	// この端末の客室案内の Cookie を切り替えるので、スタッフのスマホで実際の滞在を開いていた場合は入れ直しになる。
	import { NOTICE_READ_KEY } from '$lib/inroom-notice-read';

	let { data } = $props();

	type Mode = 'stay' | 'browse';
	let mode = $state<Mode>('stay');
	// iframe を開き直すための番号（同じモードで「最初から」を押したとき）
	let nonce = $state(0);
	const src = $derived(`/admin/inroom/preview/open?mode=${mode}&n=${nonce}`);
	let message = $state('');

	function open(m: Mode) {
		mode = m;
		nonce += 1;
		message = '';
	}

	// プレビューで「確認しました」を押したお知らせを、この端末だけもう一度出す
	function resetNoticeRead() {
		try {
			localStorage.removeItem(NOTICE_READ_KEY);
			message = 'この端末のお知らせの既読を消しました。';
		} catch {
			message = '既読を消せませんでした（ブラウザの設定で保存が使えない状態です）。';
		}
		nonce += 1;
	}
</script>

<svelte:head><title>客室案内のプレビュー ｜ 管理画面</title></svelte:head>

<div class="mb-4">
	<a href="/admin/inroom" class="text-xs text-stone-500 hover:underline">← 館内案内・客室スリップ</a>
	<h1 class="mt-1 text-lg font-semibold text-stone-800">📱 客室案内のプレビュー — {data.currentFacility.name}</h1>
	<p class="mt-1 text-xs text-stone-400">
		お客様のスマートフォンと同じ幅で、客室案内を開きます。館内案内・お知らせ・湯量・メニューの表示を確かめられます。
	</p>
</div>

<div class="flex flex-col gap-6 lg:flex-row lg:items-start">
	<!-- 操作 -->
	<div class="space-y-4 text-sm lg:w-72 lg:shrink-0">
		<div class="space-y-2">
			<p class="text-xs font-medium text-stone-500">表示するお客様</p>
			<button
				type="button"
				onclick={() => open('stay')}
				class="w-full rounded-lg border px-3 py-2 text-left {mode === 'stay' ? 'border-brand-800 bg-brand-50 text-brand-900' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'}"
			>
				<span class="block font-medium">ご滞在中（見本）</span>
				<span class="block text-xs text-stone-500">見本の間・山人 太郎 様。食事時間は見本（夕食 18:00・朝食 08:00）</span>
			</button>
			<button
				type="button"
				onclick={() => open('browse')}
				class="w-full rounded-lg border px-3 py-2 text-left {mode === 'browse' ? 'border-brand-800 bg-brand-50 text-brand-900' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'}"
			>
				<span class="block font-medium">コード入力前（館内案内のみ）</span>
				<span class="block text-xs text-stone-500">客室の入口QRを読んだだけの表示</span>
			</button>
		</div>

		<div class="space-y-2">
			<button type="button" onclick={() => (nonce += 1)} class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-700 hover:bg-stone-50">↻ 最初から開き直す</button>
			<button type="button" onclick={resetNoticeRead} class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-700 hover:bg-stone-50">📣 お知らせをもう一度出す（既読を消す）</button>
			<a href={src} target="_blank" rel="noopener" class="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-center text-stone-700 hover:bg-stone-50">新しいタブで開く ↗</a>
			{#if message}<p class="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{message}</p>{/if}
		</div>

		<div class="space-y-1.5 rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
			<p>⚠ 見本から入れた<b>貸切風呂の予約は本番の枠を埋めます</b>（PMS の見本の館内図と同じ）。試したら取り消してください。</p>
			<p>この端末で開いていた客室案内（実際のご滞在）は、プレビューで切り替わります。</p>
			<p>プレビューで開いた分もアクセスログに「見本」として残ります。</p>
		</div>
	</div>

	<!-- スマホの枠 -->
	<div class="mx-auto shrink-0 lg:mx-0">
		<div class="rounded-[2.2rem] border-[10px] border-stone-800 bg-stone-800 shadow-xl">
			{#key src}
				<iframe
					{src}
					title="客室案内のプレビュー"
					class="block h-[720px] max-h-[75vh] w-[375px] max-w-[calc(100vw-3rem)] rounded-[1.6rem] bg-white"
				></iframe>
			{/key}
		</div>
		<p class="mt-2 text-center text-xs text-stone-400">幅 375px（iPhone と同じ）</p>
	</div>
</div>
