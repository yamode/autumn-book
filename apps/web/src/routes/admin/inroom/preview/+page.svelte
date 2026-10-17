<script lang="ts">
	// 客室案内のプレビュー（2026-10-17 指示）。お客様のスマホと同じ幅の枠で、客室案内（/r）をこの画面の中に開く。
	// 開き方は2つ（preview/open が Cookie を切り替えて /r へ送る）:
	//   ・ご滞在中（見本）… PMS の「見本の館内図」と同じ見本の滞在。食事時間は見本・貸切風呂の予約は本番の台帳に入る
	//   ・コード入力前   … 入口QRを読んだだけの表示（館内案内のみ・滞在コードの入力欄）
	// この端末の客室案内の Cookie を切り替えるので、スタッフのスマホで実際の滞在を開いていた場合は入れ直しになる。
	import { NOTICE_READ_KEY } from '$lib/inroom-notice-read';
	import { PREVIEW_NOTICE_DEFAULT, PREVIEW_NOTICE_MAX_BODY, PREVIEW_NOTICE_MAX_TITLE, type PreviewMode } from '$lib/inroom-preview';
	import { enhance } from '$lib/enhance';

	let { data, form } = $props();

	type Mode = 'stay' | 'browse';
	let mode = $state<Mode>('stay');
	// iframe を開き直すための番号（同じモードで「最初から」を押したとき）
	let nonce = $state(0);

	// 見本（精算案内・お知らせ・湯量）は施設ごとに DB に保存する（+page.server.ts・2026-10-17 指示「表示先を一緒に」）。
	// 保存すると枠を開き直す。PMS の「見本の館内図」の QR・下の QR から開いても同じ見本が出る。
	const dp = $derived(data.demoPreview);
	let billMode = $state<'custom' | 'settings'>('settings');
	let billItems = $state(true);
	let billFront = $state(true);
	let billOnline = $state(true);
	let noticeMode = $state<PreviewMode>('settings');
	let noticeTitle = $state(PREVIEW_NOTICE_DEFAULT.title);
	let noticeBody = $state(PREVIEW_NOTICE_DEFAULT.body);
	let springMode = $state<PreviewMode>('settings');
	let springPercent = $state(30);
	// 保存済みの見本を欄に入れる（読み直し・施設の切り替えのたび）
	$effect(() => {
		billMode = dp.bill ? 'custom' : 'settings';
		billItems = dp.bill ? dp.bill.items : true;
		billFront = dp.bill ? dp.bill.front : true;
		billOnline = dp.bill ? dp.bill.online : true;
		noticeMode = dp.notice ? dp.notice.mode : 'settings';
		if (dp.notice?.mode === 'sample') {
			noticeTitle = dp.notice.title;
			noticeBody = dp.notice.body;
		}
		springMode = dp.spring ? dp.spring.mode : 'settings';
		if (dp.spring?.mode === 'sample') springPercent = dp.spring.percent;
	});
	let saving = $state(false);

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
	<h1 class="mt-1 text-lg font-semibold text-stone-800">📱 客室案内のプレビュー — {data.currentFacility.name}</h1>
	<p class="mt-1 text-xs text-stone-400">
		お客様のスマートフォンと同じ幅で、客室案内を開きます。館内案内・お知らせ・湯量・精算案内・メニューの表示を確かめられます。
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

		<!-- スマホで開く QR（見本の滞在の入口・PMS の見本の館内図と同じ滞在） -->
		<div class="rounded-lg border border-stone-200 bg-white px-3 py-3 text-center text-sm">
			<p class="text-xs font-medium text-stone-600">📷 スマホで開く（ご滞在中・見本）</p>
			{#if data.qr}
				<div class="mx-auto mt-2 w-40 [&>svg]:h-auto [&>svg]:w-full">{@html data.qr.svg}</div>
				<p class="mt-2 text-[11px] leading-relaxed text-stone-500">スマホのカメラで読むと、その端末で見本の客室案内が開きます（ログイン不要）。保存した見本が出ます。</p>
				<p class="mt-1 text-[11px] leading-relaxed text-amber-700">この QR は見本の滞在に入れる鍵です。社外の人に見せないでください。</p>
			{:else}
				<p class="mt-2 text-xs text-stone-500">{data.qrError}</p>
			{/if}
		</div>

		<!-- 見本の設定（施設ごとに保存・見本の滞在にだけ効く。本物のお客様には出ない） -->
		<form
			method="POST"
			action="?/save"
			class="space-y-3"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update();
					saving = false;
					nonce += 1;
				};
			}}
		>
			<div class="space-y-2 rounded-lg border border-stone-200 bg-white px-3 py-2.5">
				<p class="text-xs font-medium text-stone-500">💴 精算案内（見本）</p>
				<label class="flex items-center gap-2 text-xs">
					<input type="radio" name="billMode" bind:group={billMode} value="custom" class="h-3.5 w-3.5" />
					<span>選んだものを出す</span>
				</label>
				<div class="space-y-1 pl-5 text-xs {billMode === 'custom' ? '' : 'opacity-40'}">
					<label class="flex items-center gap-2"><input type="checkbox" name="bill" value="items" bind:checked={billItems} disabled={billMode !== 'custom'} class="h-3.5 w-3.5" />利用明細</label>
					<label class="flex items-center gap-2"><input type="checkbox" name="bill" value="front" bind:checked={billFront} disabled={billMode !== 'custom'} class="h-3.5 w-3.5" />フロントでの早め精算のご案内</label>
					<label class="flex items-center gap-2"><input type="checkbox" name="bill" value="online" bind:checked={billOnline} disabled={billMode !== 'custom'} class="h-3.5 w-3.5" />オンライン決済（Stripe）</label>
				</div>
				<label class="flex items-center gap-2 text-xs">
					<input type="radio" name="billMode" bind:group={billMode} value="settings" class="h-3.5 w-3.5" />
					<span>管理画面「<a href="/admin/inroom/billing" class="underline">精算案内</a>」の設定どおり</span>
				</label>
				<p class="text-[11px] leading-relaxed text-stone-400">
					明細は見本です。案内文は施設の設定を出します（空なら見本の文）。オンライン決済を出すと、<b>管理者だけ</b>は本番の Stripe で <b>¥100 のテスト決済</b>を試せます（実際に請求されます・PMS には入りません・自動では返金しないので Stripe の管理画面から手で返金）。スタッフには「お支払いはできません」と出ます。トップの「ご精算」カードから開けます。
				</p>
				<!-- 本番のテスト決済をこの端末で試せるか（できなければ理由）。スマホの QR から開いた端末は管理画面にログインしていないと出ない -->
				{#if data.testPaymentBlocker}
					<p class="rounded bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800">
						⚠ この端末では本番のテスト決済（¥100）を出せません：{data.testPaymentBlocker}
					</p>
				{:else}
					<p class="rounded bg-emerald-50 px-2 py-1.5 text-[11px] leading-relaxed text-emerald-800">
						✓ この端末では本番のテスト決済（¥100）を試せます（「オンライン決済」にチェック → 保存 → 枠の「ご精算」）。スマホの QR から開くときは、そのスマホでも管理画面に管理者としてログインしてください。
					</p>
				{/if}
			</div>

			<div class="space-y-2 rounded-lg border border-stone-200 bg-white px-3 py-2.5">
				<p class="text-xs font-medium text-stone-500">📣 全客室へのお知らせ（見本）</p>
				<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
					<label class="flex items-center gap-1.5"><input type="radio" name="noticeMode" bind:group={noticeMode} value="settings" class="h-3.5 w-3.5" />掲載中のとおり</label>
					<label class="flex items-center gap-1.5"><input type="radio" name="noticeMode" bind:group={noticeMode} value="sample" class="h-3.5 w-3.5" />見本を出す</label>
					<label class="flex items-center gap-1.5"><input type="radio" name="noticeMode" bind:group={noticeMode} value="none" class="h-3.5 w-3.5" />出さない</label>
				</div>
				{#if noticeMode === 'sample'}
					<input name="noticeTitle" bind:value={noticeTitle} maxlength={PREVIEW_NOTICE_MAX_TITLE} placeholder="見出し" class="w-full rounded border border-stone-300 px-2 py-1 text-xs" />
					<textarea name="noticeBody" bind:value={noticeBody} maxlength={PREVIEW_NOTICE_MAX_BODY} rows="4" placeholder="本文（太字・赤字・リンクも使えます）" class="w-full rounded border border-stone-300 px-2 py-1 text-xs"></textarea>
					<p class="text-[11px] leading-relaxed text-stone-400">内容を変えると、確認済みの端末にももう一度出ます。</p>
				{/if}
			</div>

			<div class="space-y-2 rounded-lg border border-stone-200 bg-white px-3 py-2.5">
				<p class="text-xs font-medium text-stone-500">♨️ 全館の湯量（見本）</p>
				<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
					<label class="flex items-center gap-1.5"><input type="radio" name="springMode" bind:group={springMode} value="settings" class="h-3.5 w-3.5" />設定どおり</label>
					<label class="flex items-center gap-1.5"><input type="radio" name="springMode" bind:group={springMode} value="sample" class="h-3.5 w-3.5" />見本の残量</label>
					<label class="flex items-center gap-1.5"><input type="radio" name="springMode" bind:group={springMode} value="none" class="h-3.5 w-3.5" />出さない</label>
				</div>
				{#if springMode === 'sample'}
					<label class="flex items-center gap-2 text-xs">
						<input type="range" name="springPercent" min="0" max="100" step="1" bind:value={springPercent} class="flex-1" />
						<span class="w-10 text-right tabular-nums">{springPercent}%</span>
					</label>
					<p class="text-[11px] leading-relaxed text-stone-400">言葉・色・「?」の説明は「♨️ 全館の湯量」の表現の設定を使います。</p>
				{/if}
			</div>

			<button type="submit" disabled={saving} class="w-full rounded-lg bg-brand-800 px-3 py-2 text-white hover:bg-brand-700 disabled:opacity-60">
				{saving ? '保存しています…' : '見本を保存して反映'}
			</button>
			{#if (form as { saved?: boolean } | null)?.saved}<p class="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">見本を保存しました（この施設の見本の滞在すべてに出ます）。</p>{/if}
			{#if (form as { message?: string } | null)?.message}<p class="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{(form as { message: string }).message}</p>{/if}
			<p class="text-[11px] leading-relaxed text-stone-400">
				見本は施設ごとに1つで、PMS の「見本の館内図」の QR・上の QR・この枠のどれで開いても同じに出ます。本物のお客様の客室案内には出ません。
			</p>
		</form>

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
