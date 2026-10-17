<script lang="ts">
	// 客室案内の精算案内（2026-10-17 指示）。施設の既定・滞在ごとの上書き・最近のオンライン決済。
	import { untrack } from 'svelte';
	import { enhance } from '$lib/enhance';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import AdminIcon from '$lib/components/admin/AdminIcon.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import { INROOM_PAYMENT_STATUS } from '$lib/inroom-bill';

	// 状態のバッジ（2026-10-17 モダン化・状態カードと同じ色）
	const BADGE = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset';
	const TONE = {
		on: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
		off: 'bg-stone-50 text-stone-500 ring-stone-200',
		warn: 'bg-amber-50 text-amber-800 ring-amber-200',
		danger: 'bg-red-50 text-red-700 ring-red-200'
	} as const;
	const paymentTone = (status: string) =>
		status === 'paid' ? TONE.on : status === 'refund_failed' || status === 'mismatch' ? TONE.danger : TONE.off;

	let { data, form } = $props();

	// 施設の既定（入力中の値）。施設を切り替えたとき・保存して読み直したときは、読んだ値に合わせる
	const init = untrack(() => data.settings);
	let items = $state(init.flags.items);
	let front = $state(init.flags.front);
	let online = $state(init.flags.online);
	let note = $state(init.note.ja);
	let noteEn = $state(init.note.en);
	let noteZh = $state(init.note.zh);
	$effect.pre(() => {
		const s = data.settings;
		items = s.flags.items;
		front = s.flags.front;
		online = s.flags.online;
		note = s.note.ja;
		noteEn = s.note.en;
		noteZh = s.note.zh;
	});

	const yen = (n: number | null) => (n == null ? '—' : `¥${Math.round(n).toLocaleString('ja-JP')}`);
	const fmtDateTime = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
	const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
	const stayNow = (s: { validFrom: string }) => new Date(s.validFrom).getTime() <= Date.now();
	const ovValue = (v: boolean | null) => (v === true ? 'on' : v === false ? 'off' : '');
	const KINDS = [
		{ key: 'items', label: '明細' },
		{ key: 'front', label: 'フロント案内' },
		{ key: 'online', label: 'オンライン決済' }
	] as const;
</script>

<svelte:head><title>客室案内の精算案内 ｜ 管理画面</title></svelte:head>

<PageHeader
	title="精算案内"
	facility={data.currentFacility.name}
	description="客室案内（お客様のスマホ）のトップに「ご精算」を出し、利用明細・フロントでの早め精算のご案内・オンライン決済（Stripe）を見せます。"
/>
<p class="-mt-3 mb-4 max-w-3xl text-xs leading-relaxed text-stone-500">
	明細と残額は PMS の請求書から読みます（入金済みを差し引いた残り。<code>[自動]</code> の現地入金行は差し引きません）。
	オンライン決済が通ると、PMS の請求書に「オンライン決済(stripe)」の入金行が自動で入り（PMS の画面では「オンライン決済（アプリ）」と表示）、施設の共有ID のメールアドレスにお知らせが届きます。
</p>

{#if data.live}
	<!-- 決済のお知らせの宛先（施設の共有ID・Book のスタッフ権限のアカウント） -->
	<p class="mb-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-relaxed break-words text-stone-600">
		<span class="font-medium text-stone-700">決済のお知らせ先：</span>{#if data.notifyTo.length}{data.notifyTo.join('、')}（この施設の共有ID）{:else}<span class="text-amber-700">見つかりません。ユーザー管理で、この施設に割り当てたスタッフ（共有ID）のアカウントを用意してください</span>{/if}
	</p>
{/if}
{#if data.loadError}
	<div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">⚠ {data.loadError}</div>
{/if}
{#if form?.message}
	<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
{/if}
{#if !data.live}
	<p class="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600">デモの表示です（DATA_SOURCE=demo）。明細は見本で、オンライン決済はできません。</p>
{:else if !data.paymentReady}
	<p class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
		⚠ この環境ではオンライン決済を使えません（Stripe の鍵か SUPABASE_SERVICE_ROLE_KEY が未設定）。出す設定にしても、お客様には「フロントでご精算ください」と出ます。
	</p>
{/if}

<!-- ============ 施設の既定 ============ -->
<section class="mb-5 rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
	<h2 class="flex items-center gap-2 text-sm font-semibold text-stone-800">
		<AdminIcon name="settings" class="h-4 w-4 text-stone-500" />施設の既定
	</h2>
	<p class="mt-1 text-xs text-stone-500">すべての滞在に使う設定です。滞在ごとに変えたいときは、下の一覧で上書きします。</p>
	{#if form?.settingsSaved}<p class="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">保存しました。</p>{/if}
	<form method="POST" action="?/saveSettings" use:enhance class="mt-4 space-y-4">
		<input type="hidden" name="facilityId" value={data.currentFacility.id} />
		<fieldset class="grid gap-2 text-sm sm:flex sm:flex-wrap sm:gap-x-6" disabled={!data.isAdmin}>
			<label class="flex min-h-10 items-center gap-2.5 rounded-lg border border-stone-200 px-3 sm:min-h-0 sm:border-0 sm:px-0"><input type="checkbox" name="items" bind:checked={items} class="h-4 w-4" /> 利用明細を出す</label>
			<label class="flex min-h-10 items-center gap-2.5 rounded-lg border border-stone-200 px-3 sm:min-h-0 sm:border-0 sm:px-0"><input type="checkbox" name="front" bind:checked={front} class="h-4 w-4" /> フロントでの早め精算のご案内を出す</label>
			<label class="flex min-h-10 items-center gap-2.5 rounded-lg border border-stone-200 px-3 sm:min-h-0 sm:border-0 sm:px-0"><input type="checkbox" name="online" bind:checked={online} class="h-4 w-4" /> オンライン決済（Stripe）を出す</label>
		</fieldset>
		<div>
			<p class="text-xs font-medium text-stone-600">フロントでのご案内（日本語・必須）</p>
			<p class="text-[11px] text-stone-400">例: チェックアウトの混雑を避けるため、前日の夜までにフロントでのご精算をおすすめしています。</p>
			<div class="mt-1"><MarkdownEditor bind:value={note} name="note" rows={5} /></div>
		</div>
		<details class="rounded-lg border border-stone-200 px-3 py-2" open={!!(noteEn || noteZh)}>
			<summary class="cursor-pointer py-1 text-xs font-medium text-stone-600">英語・繁体字（空なら日本語を出します）</summary>
			<label class="mt-2 block text-xs text-stone-500">英語
				<textarea name="noteEn" bind:value={noteEn} rows="3" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"></textarea>
			</label>
			<label class="mt-2 block text-xs text-stone-500">繁体字
				<textarea name="noteZh" bind:value={noteZh} rows="3" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"></textarea>
			</label>
		</details>
		{#if data.isAdmin}
			<button class="w-full rounded-lg bg-brand-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 sm:w-auto">施設の既定を保存</button>
		{:else}
			<p class="text-xs text-stone-400">施設の既定は管理者だけが変えられます。</p>
		{/if}
	</form>
</section>

<!-- ============ 滞在ごとの上書き ============ -->
<!-- スマホ（lg 未満）では1滞在＝1枚のカード。lg 以上は表と同じ並び（見出しの行を出す） -->
<section class="mb-5 rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
	<h2 class="flex items-center gap-2 text-sm font-semibold text-stone-800">
		<AdminIcon name="calendar" class="h-4 w-4 text-stone-500" />滞在ごとの出し分け
	</h2>
	<p class="mt-1 text-xs text-stone-500">
		ご滞在中・これからの滞在コードです。「既定」はそのまま施設の既定を使います。残額は今の PMS の請求書から数えた額です（連泊は全泊・1つの請求書をまとめている予約はその請求書全体）。
	</p>
	{#if data.stays.length === 0}
		<p class="mt-3 rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-400">有効な滞在コードはありません。</p>
	{:else}
		<div class="mt-4">
			<div class="hidden border-b border-stone-200 pb-2 text-xs font-medium text-stone-500 lg:grid lg:grid-cols-[minmax(0,1.3fr)_6.5rem_6.5rem_minmax(0,3.4fr)] lg:gap-3">
				<span>お部屋・お客様</span>
				<span>期間</span>
				<span class="text-right">残額</span>
				<span class="grid grid-cols-[repeat(3,minmax(0,1fr))_4.5rem] gap-2">
					{#each KINDS as k (k.key)}<span>{k.label}</span>{/each}<span></span>
				</span>
			</div>
			<ul class="space-y-3 lg:space-y-0 lg:divide-y lg:divide-stone-100">
				{#each data.stays as s (s.tokenId)}
					<li class="rounded-lg border border-stone-200 p-3 lg:grid lg:grid-cols-[minmax(0,1.3fr)_6.5rem_6.5rem_minmax(0,3.4fr)] lg:items-center lg:gap-3 lg:rounded-none lg:border-0 lg:px-0 lg:py-2.5">
						<div class="flex flex-wrap items-center gap-1.5 text-sm">
							<span class="font-medium text-stone-800">{s.roomCode}</span>
							{#if s.guestName}<span class="text-stone-500">{s.guestName} 様</span>{/if}
							{#if s.isDemo}<span class="{BADGE} {TONE.warn}">見本</span>{/if}
							{#if !stayNow(s)}<span class="{BADGE} {TONE.off}">これから</span>{/if}
						</div>
						<!-- スマホでは期間と残額を1行に -->
						<div class="mt-1 flex items-baseline justify-between gap-3 lg:contents">
							<span class="text-xs tabular-nums text-stone-500">{fmtDay(s.validFrom)}〜{fmtDay(s.validTo)}</span>
							<span class="text-right text-sm tabular-nums">
								<span class="text-[11px] text-stone-400 lg:hidden">残額 </span>{s.hasStay ? yen(s.dueTotal) : '—'}
								{#if s.paidOnline > 0}<span class="block text-[11px] text-emerald-700">オンライン {yen(s.paidOnline)}</span>{/if}
							</span>
						</div>
						<form method="POST" action="?/setOverride" use:enhance class="mt-3 grid gap-2 border-t border-stone-100 pt-3 lg:mt-0 lg:grid-cols-[repeat(3,minmax(0,1fr))_4.5rem] lg:items-center lg:border-0 lg:pt-0">
							<input type="hidden" name="tokenId" value={s.tokenId} />
							{#each KINDS as k (k.key)}
								<label class="flex items-center justify-between gap-3 text-xs">
									<span class="shrink-0 text-stone-500 lg:hidden">{k.label}</span>
									<select name={k.key} value={ovValue(s.override[k.key])} class="min-h-9 w-44 max-w-full rounded-md border border-stone-300 px-2 py-1.5 text-xs lg:min-h-0 lg:w-full lg:py-1">
										<option value="">既定（{data.settings.flags[k.key] ? '出す' : '出さない'}）</option>
										<option value="on">出す</option>
										<option value="off">出さない</option>
									</select>
								</label>
							{/each}
							<div class="flex items-center justify-end gap-2">
								{#if form?.overrideSaved === s.tokenId}<span class="text-xs text-emerald-700">保存しました</span>{/if}
								<button class="min-h-9 rounded-lg border border-stone-300 px-4 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 lg:min-h-0 lg:px-3 lg:py-1">保存</button>
							</div>
						</form>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>

<!-- ============ 最近のオンライン決済 ============ -->
<!-- スマホ（md 未満）では1件＝1枚のカード。md 以上は表 -->
<section class="rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
	<h2 class="flex items-center gap-2 text-sm font-semibold text-stone-800">
		<AdminIcon name="receipt" class="h-4 w-4 text-stone-500" />最近のオンライン決済
	</h2>
	<p class="mt-1 text-xs leading-relaxed text-stone-500">
		入金済みは PMS の請求書に入金行（オンライン決済(stripe)）が入っています。Stripe の管理画面から返金すると、PMS にマイナスの入金行が入ります。
		「テスト」はプレビュー（見本の滞在）で管理者が試した本番の決済で、PMS には入れていません。返金は Stripe の管理画面から手で行ってください（返金すると「返金済み」になります）。
		「金額の食い違い」は、お支払いの間にフロントで先に精算された等で残額が足りなかった決済で、全額を返金しています（入金行は入れていません）。
	</p>
	{#if form?.refundRetried}<p class="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">返金しました。</p>{/if}
	{#if data.payments.length === 0}
		<p class="mt-3 rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-400">まだありません。</p>
	{:else}
		<div class="mt-4">
			<div class="hidden border-b border-stone-200 pb-2 text-xs font-medium text-stone-500 md:grid md:grid-cols-[7rem_minmax(0,1.4fr)_6.5rem_minmax(0,1.6fr)_minmax(0,1fr)] md:gap-3">
				<span>日時</span><span>お部屋・お客様</span><span class="text-right">金額</span><span>状態</span><span>Stripe</span>
			</div>
			<ul class="space-y-3 md:space-y-0 md:divide-y md:divide-stone-100">
				{#each data.payments as p (p.id)}
					<li class="rounded-lg border border-stone-200 p-3 text-sm md:grid md:grid-cols-[7rem_minmax(0,1.4fr)_6.5rem_minmax(0,1.6fr)_minmax(0,1fr)] md:items-start md:gap-3 md:rounded-none md:border-0 md:px-0 md:py-2.5">
						<span class="text-xs tabular-nums text-stone-500">{fmtDateTime(p.paidAt ?? p.createdAt)}</span>
						<div class="mt-1 flex items-baseline justify-between gap-3 md:contents">
							<span class="min-w-0">{p.roomCode ?? ''}{#if p.guestName}<span class="ml-1 text-stone-500">{p.guestName} 様</span>{/if}</span>
							<span class="shrink-0 text-right tabular-nums">
								{yen(p.amount)}
								{#if p.refundedAmount > 0}<span class="block text-[11px] text-stone-500">返金 {yen(p.refundedAmount)}</span>{/if}
							</span>
						</div>
						<div class="mt-2 text-xs md:mt-0">
							<span class="flex flex-wrap items-center gap-1">
								<span class="{BADGE} {paymentTone(p.status)}">{INROOM_PAYMENT_STATUS[p.status] ?? p.status}</span>
								{#if p.isTest}<span class="{BADGE} {TONE.danger}">テスト</span>{/if}
							</span>
							{#if p.message}<span class="mt-1 block text-[11px] text-stone-400">{p.message}</span>{/if}
							{#if data.isAdmin && (p.status === 'refund_failed' || p.status === 'mismatch')}
								<form method="POST" action="?/retryRefund" use:enhance class="mt-2">
									<input type="hidden" name="id" value={p.id} />
									<button class="min-h-9 rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 md:min-h-0 md:py-1">返金を再実行する</button>
								</form>
							{/if}
						</div>
						<span class="mt-2 block text-[11px] break-all text-stone-400 md:mt-0">{p.paymentIntentId ?? ''}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>
