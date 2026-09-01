<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import QrCode from '$lib/components/QrCode.svelte';
	import type { StayToken } from '$lib/types';

	let { data, form } = $props();

	// ?all=1 で来たら「客室スリップ」タブを初期表示（失効一覧の再読込を跨いでも維持）
	let tab = $state<'guides' | 'slips'>(page.url.searchParams.get('all') ? 'slips' : 'guides');

	// 公開URL は管理画面と同じオリジン。本番で開けばそのまま本番の URL になる。
	const guestUrl = (token: string) => `${page.url.origin}/r/c/${token}`;
	const qrUrl = $derived(form?.qr ? guestUrl(form.qr.token) : '');

	// 一覧の行ごとに QR を開くためのトグル（開いた行の id）
	let openQr = $state<string | null>(null);

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = text;
			setTimeout(() => (copied = null), 1500);
		} catch {
			/* クリップボードが使えない環境では何もしない（URL は画面に出ている） */
		}
	}
	let copied = $state<string | null>(null);

	// 日付フィルタのリンク（?date= を差し替えつつ ?all=1 等は保つ）
	const dateHref = (d: string) => {
		const p = new URLSearchParams(page.url.search);
		if (d) p.set('date', d);
		else p.delete('date');
		return `?${p.toString()}`;
	};

	const langLabel: Record<string, string> = { ja: '日本語', en: 'English', 'zh-TW': '繁體中文' };

	// トークンの状態（有効 / 失効 / 期限切れ）
	function tokenStatus(t: StayToken): 'active' | 'revoked' | 'expired' {
		if (t.revokedAt) return 'revoked';
		const now = Date.now();
		if (now >= new Date(t.validTo).getTime() || now < new Date(t.validFrom).getTime()) return 'expired';
		return 'active';
	}
	const statusLabel = { active: '有効', revoked: '失効', expired: '期限切れ' } as const;
	const statusClass = {
		active: 'bg-emerald-50 text-emerald-700',
		revoked: 'bg-stone-100 text-stone-500',
		expired: 'bg-amber-50 text-amber-700'
	} as const;

	function fmtDateTime(iso: string): string {
		return new Date(iso).toLocaleString('ja-JP', {
			timeZone: 'Asia/Tokyo',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head><title>客室案内 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">客室電子インフォメーション — {data.currentFacility.name}</h1>
<p class="mb-4 text-xs text-stone-400">
	ゲストの客室スマホに表示する滞在カード・館内案内と、チェックイン時にお渡しする印刷スリップ（QR＋手入力コード）を管理します。
</p>

{#if data.loadError}
	<div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
		⚠ {data.loadError}
	</div>
{/if}

<!-- タブ -->
<div class="mb-5 flex gap-1 border-b border-stone-200">
	<button
		type="button"
		onclick={() => (tab = 'guides')}
		class="border-b-2 px-4 py-2 text-sm font-medium {tab === 'guides' ? 'border-brand-800 text-brand-900' : 'border-transparent text-stone-400 hover:text-stone-600'}"
	>📖 館内案内</button>
	<button
		type="button"
		onclick={() => (tab = 'slips')}
		class="border-b-2 px-4 py-2 text-sm font-medium {tab === 'slips' ? 'border-brand-800 text-brand-900' : 'border-transparent text-stone-400 hover:text-stone-600'}"
	>🎫 客室スリップ</button>
</div>

{#if form?.message}
	<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
{/if}

{#if tab === 'guides'}
	<!-- ============================ 館内案内 ============================ -->
	{#if form?.guideAdded}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">追加しました（下書き状態）。</p>{/if}
	{#if form?.guideDeleted}<p class="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">削除しました。</p>{/if}

	<div class="space-y-3">
		{#each data.guides as g (g.id)}
			<div class="rounded-xl border border-stone-200 bg-white p-4">
				<form method="POST" action="?/guideSave" use:enhance class="space-y-3 text-sm">
					<input type="hidden" name="facilityId" value={data.currentFacility.id} />
					<input type="hidden" name="guideId" value={g.id} />
					<div class="flex flex-wrap items-center gap-2">
						<input name="section" value={g.section} placeholder="section" class="w-32 rounded-md border border-stone-300 px-2 py-1.5 text-xs" />
						<input name="title" value={g.title} placeholder="タイトル" class="min-w-40 flex-1 rounded-md border border-stone-300 px-3 py-1.5 font-medium" />
						<select name="lang" value={g.lang} class="rounded-md border border-stone-300 px-2 py-1.5 text-xs">
							{#each Object.entries(langLabel) as [code, label]}
								<option value={code}>{label}</option>
							{/each}
						</select>
						<label class="flex items-center gap-1 text-xs text-stone-500">
							並び
							<input name="sortOrder" type="number" value={g.sortOrder} class="w-16 rounded-md border border-stone-300 px-2 py-1.5" />
						</label>
						<label class="flex items-center gap-1.5 text-xs">
							<input type="checkbox" name="isPublished" checked={g.isPublished} class="h-4 w-4" /> 公開
						</label>
						{#if form?.guideSaved === g.id}<span class="text-xs text-emerald-600">✔ 保存</span>{/if}
					</div>
					<MarkdownEditor value={g.body} name="body" rows={8} />
					<div class="flex items-center gap-2">
						<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-xs text-white hover:bg-brand-700">保存</button>
					</div>
				</form>
				<form method="POST" action="?/guideDelete" use:enhance class="mt-2 border-t border-stone-100 pt-2">
					<input type="hidden" name="guideId" value={g.id} />
					<button
						type="submit"
						class="text-xs text-stone-400 hover:text-red-600"
						onclick={(e) => { if (!confirm('この館内案内を削除しますか？')) e.preventDefault(); }}
					>削除</button>
				</form>
			</div>
		{/each}
		{#if data.guides.length === 0}
			<p class="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-8 text-center text-sm text-stone-400">
				館内案内はまだありません。下のフォームから追加してください。
			</p>
		{/if}
	</div>

	<!-- 新規追加 -->
	<form method="POST" action="?/guideAdd" use:enhance class="mt-6 rounded-xl border border-dashed border-stone-300 bg-white p-4 text-sm">
		<input type="hidden" name="facilityId" value={data.currentFacility.id} />
		<h2 class="mb-2 font-medium text-stone-700">＋ 新しい館内案内を追加</h2>
		<div class="flex flex-wrap items-center gap-2">
			<input name="section" placeholder="section（例: onsen）" class="w-40 rounded-md border border-stone-300 px-2 py-1.5 text-xs" />
			<input name="title" placeholder="タイトル" class="min-w-40 flex-1 rounded-md border border-stone-300 px-3 py-1.5" />
			<select name="lang" class="rounded-md border border-stone-300 px-2 py-1.5 text-xs">
				{#each Object.entries(langLabel) as [code, label]}
					<option value={code}>{label}</option>
				{/each}
			</select>
			<label class="flex items-center gap-1 text-xs text-stone-500">
				並び
				<input name="sortOrder" type="number" value="0" class="w-16 rounded-md border border-stone-300 px-2 py-1.5" />
			</label>
			<label class="flex items-center gap-1.5 text-xs">
				<input type="checkbox" name="isPublished" class="h-4 w-4" /> 公開
			</label>
		</div>
		<div class="mt-2">
			<MarkdownEditor name="body" rows={8} />
		</div>
		<button type="submit" class="mt-2 rounded-md bg-accent-600 px-4 py-1.5 text-xs text-white hover:bg-accent-500">追加（下書きで作成）</button>
	</form>
{:else}
	<!-- ============================ 客室スリップ ============================ -->
	{#if form?.issued}
		<div class="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
			<p class="text-sm text-emerald-800">スリップを発行しました。チェックイン時にお渡しください。</p>
			<div class="mt-2 flex flex-wrap items-center gap-4">
				<div>
					<span class="text-xs text-stone-500">部屋</span>
					<span class="ml-1 font-medium text-stone-800">{form.issued.roomCode}</span>
				</div>
				<div>
					<span class="text-xs text-stone-500">手入力コード</span>
					<span class="ml-1 font-mono text-xl font-bold tracking-widest text-brand-900">{form.issued.shortCode}</span>
				</div>
				<a
					href={`/admin/inroom/slip/${form.issued.id}`}
					target="_blank"
					class="rounded-md bg-brand-800 px-4 py-1.5 text-xs text-white hover:bg-brand-700"
				>🖨 印刷スリップを開く</a>
			</div>
		</div>
	{/if}
	{#if form?.revoked}<p class="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">失効しました。</p>{/if}

	<!-- ============ 実際のご予約から公開URL・QRを出す（貸切風呂と同じ仕組み） ============ -->
	<section class="mb-6 rounded-xl border border-stone-200 bg-white">
		<header class="border-b border-stone-200 px-4 py-3">
			<h2 class="text-sm font-medium text-stone-700">🔗 ご予約から公開URL・QRを出す</h2>
			<p class="mt-1 text-xs text-stone-400">
				その日にご滞在のお客様を選ぶと、そのお部屋の客室案内の公開URLとQRが出ます。管理画面からそのまま開いて確認できます。<br />
				同じご予約なら何度押しても同じURL・同じQRです（発行済みなら取り出すだけ）。
			</p>
		</header>

		<div class="px-4 py-4">
			<form method="GET" class="flex flex-wrap items-center gap-2">
				{#if data.includeInactive}<input type="hidden" name="all" value="1" />{/if}
				<label class="text-xs text-stone-500">
					日付
					<input
						type="date"
						name="date"
						value={data.date ?? ''}
						class="ml-1 rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-800"
					/>
				</label>
				<button type="submit" class="rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50">この日の予約を出す</button>
				{#if data.date}
					<a href={dateHref('')} class="text-xs text-stone-400 underline hover:text-stone-600">今日に戻す</a>
				{/if}
			</form>

			{#if data.staysError}
				<p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{data.staysError}</p>
			{:else if data.stays.length === 0}
				<p class="mt-3 text-xs text-stone-400">この日にご滞在のお客様はいません。</p>
			{:else}
				<ul class="mt-3 divide-y divide-stone-100">
					{#each data.stays as s (s.stay_id)}
						<li class="flex flex-wrap items-center gap-3 py-2 text-sm">
							<span class="min-w-16 font-medium text-stone-800">{s.room_code}</span>
							<span class="text-stone-600">{s.guest_name}</span>
							<span class="text-xs text-stone-400">{s.check_in_date}〜{s.check_out_date}</span>
							{#if s.token}
								<span class="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">発行済み</span>
							{/if}
							<form method="POST" action="?/issueQr" use:enhance class="ml-auto">
								<input type="hidden" name="facilityId" value={data.currentFacility.id} />
								<input type="hidden" name="stayId" value={s.stay_id} />
								<input type="hidden" name="roomCode" value={s.room_code} />
								<input type="hidden" name="guestName" value={s.guest_name} />
								<input type="hidden" name="checkOutDate" value={s.check_out_date} />
								<button
									type="submit"
									disabled={!data.live}
									class="rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50 disabled:opacity-40"
								>URL・QRを出す</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}

			{#if form?.qr}
				<div class="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
					<div class="flex flex-wrap items-start gap-4">
						<div class="rounded-lg bg-white p-2">
							<QrCode value={qrUrl} px={168} label="客室案内へのQRコード" />
						</div>
						<div class="min-w-0 flex-1 text-sm">
							<p class="font-medium text-stone-800">
								{form.qr.roomCode}
								{#if form.qr.guestName}<span class="ml-2 text-stone-500">{form.qr.guestName} 様</span>{/if}
							</p>
							<p class="mt-2 text-xs text-stone-500">公開URL</p>
							<p class="break-all font-mono text-xs text-stone-700">{qrUrl}</p>
							<div class="mt-2 flex flex-wrap items-center gap-2">
								<a
									href={qrUrl}
									target="_blank"
									rel="noopener"
									class="rounded-md bg-brand-800 px-3 py-1.5 text-xs text-white hover:bg-brand-700"
								>開いて確認する</a>
								<button
									type="button"
									onclick={() => copy(qrUrl)}
									class="rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-white"
								>{copied === qrUrl ? '✔ コピーしました' : 'URLをコピー'}</button>
							</div>
							<p class="mt-3 text-xs text-stone-500">
								手入力コード <span class="font-mono text-base tracking-widest text-brand-900">{form.qr.shortCode}</span>
							</p>
							<p class="mt-2 text-xs text-stone-400">
								開くとトークンは httpOnly Cookie に交換され、URL から消えます。確認用に開いた場合は、
								ブラウザのシークレットウィンドウを使うか、あとで別のお部屋を開き直してください。
							</p>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</section>

	<!-- 発行フォーム -->
	<form method="POST" action="?/tokenIssue" use:enhance class="mb-6 rounded-xl border border-stone-200 bg-white p-4 text-sm">
		<input type="hidden" name="facilityId" value={data.currentFacility.id} />
		<h2 class="mb-2 font-medium text-stone-700">＋ 滞在スリップを発行</h2>
		<div class="flex flex-wrap items-end gap-3">
			<label class="text-xs text-stone-500">
				部屋名 <span class="text-red-500">*</span>
				<input name="roomCode" required placeholder="例: 雪椿" class="mt-1 block w-40 rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-800" />
			</label>
			<label class="text-xs text-stone-500">
				ゲスト名（任意）
				<input name="guestName" placeholder="例: 山田 太郎" class="mt-1 block w-44 rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-800" />
			</label>
			<label class="text-xs text-stone-500">
				チェックアウト日 <span class="text-red-500">*</span>
				<input name="checkout" type="date" required class="mt-1 block rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-800" />
			</label>
			<button type="submit" class="rounded-md bg-accent-600 px-4 py-2 text-xs text-white hover:bg-accent-500">発行する</button>
		</div>
		<p class="mt-2 text-xs text-stone-400">有効期限はチェックアウト日の 11:00（JST）までです。</p>
	</form>

	<!-- 一覧 -->
	<div class="mb-2 flex items-center justify-between">
		<h2 class="text-sm font-medium text-stone-700">発行済みスリップ</h2>
		{#if data.includeInactive}
			<a href="/admin/inroom" class="text-xs text-stone-400 hover:text-stone-600">← 有効なもののみ表示</a>
		{:else}
			<a href="/admin/inroom?all=1" class="text-xs text-stone-400 hover:text-stone-600">失効済みも表示 →</a>
		{/if}
	</div>

	<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
		<table class="w-full text-left text-sm">
			<thead class="border-b border-stone-200 text-xs text-stone-400">
				<tr>
					<th class="px-3 py-2 font-medium">部屋</th>
					<th class="px-3 py-2 font-medium">ゲスト</th>
					<th class="px-3 py-2 font-medium">コード</th>
					<th class="px-3 py-2 font-medium">期限</th>
					<th class="px-3 py-2 font-medium">状態</th>
					<th class="px-3 py-2 font-medium">操作</th>
				</tr>
			</thead>
			<tbody>
				{#each data.tokens as t (t.id)}
					{@const st = tokenStatus(t)}
					<tr class="border-b border-stone-100 last:border-0">
						<td class="px-3 py-2 font-medium text-stone-800">{t.roomCode}</td>
						<td class="px-3 py-2 text-stone-600">{t.guestName ?? '—'}</td>
						<td class="px-3 py-2 font-mono tracking-wider text-stone-700">{t.shortCode}</td>
						<td class="px-3 py-2 text-xs text-stone-500">{fmtDateTime(t.validTo)}</td>
						<td class="px-3 py-2">
							<span class="rounded-full px-2 py-0.5 text-xs {statusClass[st]}">{statusLabel[st]}</span>
						</td>
						<td class="px-3 py-2">
							<div class="flex items-center gap-3">
								<a
									href={guestUrl(t.token)}
									target="_blank"
									rel="noopener"
									class="text-xs text-brand-700 hover:text-brand-800">↗ 開く</a>
								<button
									type="button"
									onclick={() => (openQr = openQr === t.id ? null : t.id)}
									class="text-xs text-brand-700 hover:text-brand-800">▣ QR</button>
								<a href={`/admin/inroom/slip/${t.id}`} target="_blank" class="text-xs text-brand-700 hover:text-brand-800">🖨 印刷</a>
								{#if st === 'active'}
									<form method="POST" action="?/tokenRevoke" use:enhance class="inline">
										<input type="hidden" name="tokenId" value={t.id} />
										<button
											type="submit"
											class="text-xs text-stone-400 hover:text-red-600"
											onclick={(e) => { if (!confirm('このスリップを失効しますか？（ゲストのアクセスが即時無効になります）')) e.preventDefault(); }}
										>失効</button>
									</form>
								{/if}
							</div>
						</td>
					</tr>
					{#if openQr === t.id}
						<tr class="border-b border-stone-100 bg-stone-50 last:border-0">
							<td colspan="6" class="px-3 py-4">
								<div class="flex flex-wrap items-start gap-4">
									<div class="rounded-lg bg-white p-2">
										<QrCode value={guestUrl(t.token)} px={168} label={`${t.roomCode} の客室案内へのQRコード`} />
									</div>
									<div class="min-w-0 flex-1 text-sm">
										<p class="text-xs text-stone-500">公開URL</p>
										<p class="break-all font-mono text-xs text-stone-700">{guestUrl(t.token)}</p>
										<button
											type="button"
											onclick={() => copy(guestUrl(t.token))}
											class="mt-2 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50"
										>{copied === guestUrl(t.token) ? '✔ コピーしました' : 'URLをコピー'}</button>
										<p class="mt-3 text-xs text-stone-500">
											手入力コード <span class="font-mono text-base tracking-widest text-brand-900">{t.shortCode}</span>
										</p>
									</div>
								</div>
							</td>
						</tr>
					{/if}
				{/each}
				{#if data.tokens.length === 0}
					<tr><td colspan="6" class="px-3 py-8 text-center text-sm text-stone-400">スリップはまだありません。</td></tr>
				{/if}
			</tbody>
		</table>
	</div>
{/if}
