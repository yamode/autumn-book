<script lang="ts">
	// 客室案内の精算案内（2026-10-17 指示）。施設の既定・滞在ごとの上書き・最近のオンライン決済。
	import { untrack } from 'svelte';
	import { enhance } from '$lib/enhance';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import { INROOM_PAYMENT_STATUS } from '$lib/inroom-bill';

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

<div class="mb-4">
	<a href="/admin/inroom" class="text-xs text-stone-500 hover:underline">← 館内案内・客室スリップ</a>
	<h1 class="mt-1 text-lg font-semibold text-stone-800">💴 精算案内 — {data.currentFacility.name}</h1>
	<p class="mt-1 text-xs text-stone-500">
		客室案内（お客様のスマホ）のトップに「ご精算」を出し、利用明細・フロントでの早め精算のご案内・オンライン決済（Stripe）を見せます。
		明細と残額は PMS の請求書から読みます（入金済みを差し引いた残り。<code>[自動]</code> の現地入金行は差し引きません）。
		オンライン決済が通ると、PMS の請求書に「オンライン決済(stripe)」の入金行が自動で入ります。
	</p>
</div>

{#if data.loadError}
	<div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">⚠ {data.loadError}</div>
{/if}
{#if form?.message}
	<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
{/if}
{#if !data.live}
	<p class="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600">デモの表示です（DATA_SOURCE=demo）。明細は見本で、オンライン決済はできません。</p>
{:else if !data.paymentReady}
	<p class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
		⚠ この環境ではオンライン決済を使えません（Stripe の鍵か SUPABASE_SERVICE_ROLE_KEY が未設定）。出す設定にしても、お客様には「フロントでご精算ください」と出ます。
	</p>
{/if}

<!-- ============ 施設の既定 ============ -->
<section class="mb-6 rounded-lg border border-stone-200 bg-white p-4">
	<h2 class="text-sm font-semibold text-stone-800">施設の既定</h2>
	<p class="mt-1 text-xs text-stone-500">すべての滞在に使う設定です。滞在ごとに変えたいときは、下の一覧で上書きします。</p>
	{#if form?.settingsSaved}<p class="mt-2 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">保存しました。</p>{/if}
	<form method="POST" action="?/saveSettings" use:enhance class="mt-3 space-y-4">
		<input type="hidden" name="facilityId" value={data.currentFacility.id} />
		<fieldset class="flex flex-wrap gap-x-6 gap-y-2 text-sm" disabled={!data.isAdmin}>
			<label class="flex items-center gap-2"><input type="checkbox" name="items" bind:checked={items} /> 利用明細を出す</label>
			<label class="flex items-center gap-2"><input type="checkbox" name="front" bind:checked={front} /> フロントでの早め精算のご案内を出す</label>
			<label class="flex items-center gap-2"><input type="checkbox" name="online" bind:checked={online} /> オンライン決済（Stripe）を出す</label>
		</fieldset>
		<div>
			<p class="text-xs font-medium text-stone-600">フロントでのご案内（日本語・必須）</p>
			<p class="text-[11px] text-stone-400">例: チェックアウトの混雑を避けるため、前日の夜までにフロントでのご精算をおすすめしています。</p>
			<div class="mt-1"><MarkdownEditor bind:value={note} name="note" rows={5} /></div>
		</div>
		<details class="rounded border border-stone-200 px-3 py-2" open={!!(noteEn || noteZh)}>
			<summary class="cursor-pointer text-xs font-medium text-stone-600">英語・繁体字（空なら日本語を出します）</summary>
			<label class="mt-2 block text-xs text-stone-500">英語
				<textarea name="noteEn" bind:value={noteEn} rows="3" class="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm"></textarea>
			</label>
			<label class="mt-2 block text-xs text-stone-500">繁体字
				<textarea name="noteZh" bind:value={noteZh} rows="3" class="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm"></textarea>
			</label>
		</details>
		{#if data.isAdmin}
			<button class="rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white">施設の既定を保存</button>
		{:else}
			<p class="text-xs text-stone-400">施設の既定は管理者だけが変えられます。</p>
		{/if}
	</form>
</section>

<!-- ============ 滞在ごとの上書き ============ -->
<section class="mb-6 rounded-lg border border-stone-200 bg-white p-4">
	<h2 class="text-sm font-semibold text-stone-800">滞在ごとの出し分け</h2>
	<p class="mt-1 text-xs text-stone-500">
		ご滞在中・これからの滞在コードです。「既定」はそのまま施設の既定を使います。残額は今の PMS の請求書から数えた額です（連泊は全泊・1つの請求書をまとめている予約はその請求書全体）。
	</p>
	{#if data.stays.length === 0}
		<p class="mt-3 text-sm text-stone-400">有効な滞在コードはありません。</p>
	{:else}
		<div class="mt-3 overflow-x-auto">
			<table class="w-full min-w-[720px] text-sm">
				<thead>
					<tr class="border-b border-stone-200 text-left text-xs text-stone-500">
						<th class="py-2 pr-3 font-medium">お部屋・お客様</th>
						<th class="py-2 pr-3 font-medium">期間</th>
						<th class="py-2 pr-3 text-right font-medium">残額</th>
						{#each KINDS as k (k.key)}<th class="py-2 pr-3 font-medium">{k.label}</th>{/each}
						<th class="py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.stays as s (s.tokenId)}
						<tr class="border-b border-stone-100 align-middle">
							<td class="py-2 pr-3">
								<span class="font-medium text-stone-800">{s.roomCode}</span>
								{#if s.guestName}<span class="ml-1 text-stone-500">{s.guestName} 様</span>{/if}
								{#if s.isDemo}<span class="ml-1 rounded bg-amber-50 px-1.5 text-[11px] text-amber-800">見本</span>{/if}
								{#if !stayNow(s)}<span class="ml-1 rounded bg-stone-100 px-1.5 text-[11px] text-stone-500">これから</span>{/if}
							</td>
							<td class="py-2 pr-3 text-xs tabular-nums text-stone-500">{fmtDay(s.validFrom)}〜{fmtDay(s.validTo)}</td>
							<td class="py-2 pr-3 text-right tabular-nums">
								{s.hasStay ? yen(s.dueTotal) : '—'}
								{#if s.paidOnline > 0}<span class="block text-[11px] text-emerald-700">オンライン {yen(s.paidOnline)}</span>{/if}
							</td>
							<td class="py-2 pr-3" colspan="4">
								<form method="POST" action="?/setOverride" use:enhance class="flex flex-wrap items-center gap-3">
									<input type="hidden" name="tokenId" value={s.tokenId} />
									{#each KINDS as k (k.key)}
										<label class="flex items-center gap-1 text-xs">
											<span class="text-stone-400 lg:hidden">{k.label}</span>
											<select name={k.key} value={ovValue(s.override[k.key])} class="rounded border border-stone-300 px-1.5 py-1 text-xs">
												<option value="">既定（{data.settings.flags[k.key] ? '出す' : '出さない'}）</option>
												<option value="on">出す</option>
												<option value="off">出さない</option>
											</select>
										</label>
									{/each}
									<button class="rounded border border-stone-300 px-2.5 py-1 text-xs text-stone-700 hover:bg-stone-50">保存</button>
									{#if form?.overrideSaved === s.tokenId}<span class="text-xs text-emerald-700">保存しました</span>{/if}
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<!-- ============ 最近のオンライン決済 ============ -->
<section class="rounded-lg border border-stone-200 bg-white p-4">
	<h2 class="text-sm font-semibold text-stone-800">最近のオンライン決済</h2>
	<p class="mt-1 text-xs text-stone-500">
		入金済みは PMS の請求書に入金行（オンライン決済(stripe)）が入っています。Stripe の管理画面から返金すると、PMS にマイナスの入金行が入ります。
		「テスト」はプレビュー（見本の滞在）で管理者が試した本番の決済で、PMS には入れていません。返金は Stripe の管理画面から手で行ってください（返金すると「返金済み」になります）。
		「金額の食い違い」は、お支払いの間にフロントで先に精算された等で残額が足りなかった決済で、全額を返金しています（入金行は入れていません）。
	</p>
	{#if form?.refundRetried}<p class="mt-2 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">返金しました。</p>{/if}
	{#if data.payments.length === 0}
		<p class="mt-3 text-sm text-stone-400">まだありません。</p>
	{:else}
		<div class="mt-3 overflow-x-auto">
			<table class="w-full min-w-[640px] text-sm">
				<thead>
					<tr class="border-b border-stone-200 text-left text-xs text-stone-500">
						<th class="py-2 pr-3 font-medium">日時</th>
						<th class="py-2 pr-3 font-medium">お部屋・お客様</th>
						<th class="py-2 pr-3 text-right font-medium">金額</th>
						<th class="py-2 pr-3 font-medium">状態</th>
						<th class="py-2 font-medium">Stripe</th>
					</tr>
				</thead>
				<tbody>
					{#each data.payments as p (p.id)}
						<tr class="border-b border-stone-100 align-top">
							<td class="py-2 pr-3 text-xs tabular-nums text-stone-500">{fmtDateTime(p.paidAt ?? p.createdAt)}</td>
							<td class="py-2 pr-3">{p.roomCode ?? ''}{#if p.guestName}<span class="ml-1 text-stone-500">{p.guestName} 様</span>{/if}</td>
							<td class="py-2 pr-3 text-right tabular-nums">
								{yen(p.amount)}
								{#if p.refundedAmount > 0}<span class="block text-[11px] text-stone-500">返金 {yen(p.refundedAmount)}</span>{/if}
							</td>
							<td class="py-2 pr-3 text-xs">
								<span class={p.status === 'paid' ? 'text-emerald-700' : p.status === 'refund_failed' || p.status === 'mismatch' ? 'text-red-700' : 'text-stone-600'}>
									{INROOM_PAYMENT_STATUS[p.status] ?? p.status}
								</span>
								{#if p.isTest}<span class="ml-1 rounded bg-red-50 px-1.5 text-[11px] font-medium text-red-700">テスト</span>{/if}
								{#if p.message}<span class="block text-[11px] text-stone-400">{p.message}</span>{/if}
								{#if data.isAdmin && (p.status === 'refund_failed' || p.status === 'mismatch')}
									<form method="POST" action="?/retryRefund" use:enhance class="mt-1">
										<input type="hidden" name="id" value={p.id} />
										<button class="rounded border border-red-300 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50">返金を再実行する</button>
									</form>
								{/if}
							</td>
							<td class="py-2 text-[11px] text-stone-400">{p.paymentIntentId ?? ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
