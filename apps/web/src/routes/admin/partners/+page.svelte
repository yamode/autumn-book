<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let creating = $state(false);
	// 請求書の設定フォームの結果は、その欄に出す（上部のお知らせには出さない）
	let billingSubmitted = $state(false);
	const inputCls = 'w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm';

	const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
	function statusOf(p: (typeof data.partners)[number]) {
		if (!p.isActive) return { label: '公開停止', cls: 'bg-stone-600 text-white' };
		if (p.validFrom && today < p.validFrom) return { label: '公開前', cls: 'bg-amber-500 text-white' };
		if (p.validUntil && today > p.validUntil) return { label: '期間終了', cls: 'bg-stone-200 text-stone-600' };
		return { label: '公開中', cls: 'bg-emerald-500 text-white' };
	}
	const adjustRules = (p: (typeof data.partners)[number]) => p.pricing.rules.filter((r) => r.action === 'adjust').length;
	const hideRules = (p: (typeof data.partners)[number]) => p.pricing.rules.filter((r) => r.action === 'hide').length;
	// 一覧の URL（範囲 ?all=1 と種別 ?kind= を組み合わせる・種別の既定は「すべて」・docs/vip-member-page.md §13.8 Q6）
	const listHref = (all: boolean, kind: 'all' | 'partner' | 'member') => {
		const q = new URLSearchParams();
		if (all) q.set('all', '1');
		if (kind !== 'all') q.set('kind', kind);
		const s = q.toString();
		return s ? `/admin/partners?${s}` : '/admin/partners';
	};
	const KIND_FILTERS: ['all' | 'partner' | 'member', string][] = [
		['all', 'すべての種別'],
		['partner', '取引先'],
		['member', '特別会員']
	];
</script>

<svelte:head><title>取引先 ｜ 山人管理</title></svelte:head>

<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="mb-1 text-lg font-bold text-stone-800">取引先 — {data.facilityName}</h1>
		<p class="max-w-3xl text-xs text-stone-400">
			旅行会社・法人などの取引先ごとに特別レートを決めて、限定URL（ログインIDとパスワードで見る料金カレンダー・予約）と
			REST API（API キー）で公開します。基準は料金マスタの理論値（1名・税込・入湯税別）です。
		</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
	{#if data.live && !data.error}
		<a href="/admin/partners/invoices" class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">🧾 予定請求書を見る</a>
	{/if}
	{#if data.canEdit && data.live && !data.error}
		<button
			type="button"
			onclick={() => (creating = !creating)}
			class="rounded-lg bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-700"
		>＋ 取引先を追加</button>
	{/if}
	</div>
</div>

{#if data.error}
	<p class="mb-4 rounded-lg px-3 py-2 text-sm {data.live ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900'}">{data.error}</p>
{/if}
{#if form?.message && !billingSubmitted}
	<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
{/if}
{#if !data.canEdit && data.live && !data.error}
	<p class="mb-4 text-xs text-stone-500">取引先の追加・編集は管理者だけができます（スタッフは閲覧のみ）。</p>
{/if}

{#if creating}
	<form method="POST" action="?/create" use:enhance={() => { billingSubmitted = false; }} class="mb-4 space-y-3 rounded-xl border border-stone-200 bg-white p-5">
		<h2 class="text-sm font-bold text-stone-700">取引先を追加</h2>
		<div class="grid gap-3 sm:grid-cols-[1fr_220px]">
			<label class="block text-sm">
				<span class="text-xs text-stone-500">取引先名</span>
				<input name="name" required maxlength="120" placeholder="例: ○○トラベル 秋田支店" class="mt-0.5 {inputCls}" autocomplete="off" />
			</label>
			<label class="block text-sm">
				<span class="text-xs text-stone-500">種別</span>
				<select name="kind" class="mt-0.5 {inputCls}">
					<!-- 特別会員は会員詳細の「専用ページを作る」から作る（ここの選択肢には出さない） -->
					{#each Object.entries(data.createKindLabels) as [value, label]}
						<option {value}>{label}</option>
					{/each}
				</select>
			</label>
		</div>
		<p class="text-xs text-stone-400">作成直後は「公開停止」です。特別レートとログインIDを設定してから公開してください。{data.facilityName}で販売する設定で作ります（他の施設は詳細の施設タブでオンにできます）。</p>
		<div class="flex gap-2">
			<button type="submit" class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">作成して設定へ</button>
			<button type="button" onclick={() => (creating = false)} class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">キャンセル</button>
		</div>
	</form>
{/if}

{#if data.live && !data.error}
	<!-- 一覧の範囲（N8・2026-10-09 複数施設化）: 既定は今の施設で設定のある取引先、「すべて」でテナントの取引先すべて -->
	<div class="mb-2 flex flex-wrap items-center gap-2">
		<div class="flex overflow-hidden rounded-md border border-stone-300 bg-white text-xs">
			<a href={listHref(false, data.kindFilter)} class={`px-3 py-1.5 ${!data.showAll ? 'bg-brand-800 text-white' : 'text-stone-700 hover:bg-stone-50'}`}>{data.facilityName}の取引先</a>
			<a href={listHref(true, data.kindFilter)} class={`px-3 py-1.5 ${data.showAll ? 'bg-brand-800 text-white' : 'text-stone-700 hover:bg-stone-50'}`}>すべて</a>
		</div>
		<!-- 種別の絞り込み（取引先＝旅行会社・法人・その他／特別会員） -->
		<div class="flex overflow-hidden rounded-md border border-stone-300 bg-white text-xs" role="group" aria-label="種別の絞り込み">
			{#each KIND_FILTERS as [k, label] (k)}
				<a href={listHref(data.showAll, k)} aria-current={data.kindFilter === k ? 'true' : undefined} class={`px-3 py-1.5 ${data.kindFilter === k ? 'bg-brand-800 text-white' : 'text-stone-700 hover:bg-stone-50'}`}>{label}</a>
			{/each}
		</div>
		<p class="text-[11px] text-stone-400">
			{data.showAll ? '全施設の取引先です。施設のバッジは販売中（濃）／停止中（薄）。' : `${data.facilityName}に設定のある取引先です（販売停止中を含む）。`}
		</p>
	</div>
	<div class="overflow-hidden rounded-xl border border-stone-200 bg-white">
		{#each data.partners as p (p.id)}
			{@const st = statusOf(p)}
			<a href="/admin/partners/{p.id}" class="flex flex-wrap items-center gap-3 border-b border-stone-100 p-3 last:border-b-0 hover:bg-stone-50">
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium text-stone-800">
						{p.name}
						{#if p.kind === 'member'}
							<span class="ml-1 rounded bg-amber-100 px-1.5 text-xs font-normal text-amber-800">{data.kindLabels[p.kind]}</span>
						{:else}
							<span class="ml-1 text-xs font-normal text-stone-400">{data.kindLabels[p.kind]}</span>
						{/if}
					</p>
					{#if p.kind === 'member'}
						<!-- 特別会員の専用ページ: ログインID・API キーは無い（公式サイトの会員ログイン） -->
						<p class="mt-0.5 text-[11px] text-stone-400">
							会員ログインで見る専用ページ
							・{adjustRules(p) ? `公開ルール ${adjustRules(p)}件` : '公開プラン未設定'}{hideRules(p) ? `・非表示ルール ${hideRules(p)}件` : ''}
							{#if p.validFrom || p.validUntil}・公開期間 {p.validFrom ?? '—'} 〜 {p.validUntil ?? '—'}{/if}
						</p>
					{:else}
					<p class="mt-0.5 text-[11px] text-stone-400">
						ログインID {p.activeAccounts}/{p.accounts}（利用可/発行数）・API キー {p.apiKeys}
						・{adjustRules(p) ? `公開ルール ${adjustRules(p)}件` : '公開プラン未設定'}{hideRules(p) ? `・非表示ルール ${hideRules(p)}件` : ''}
						{#if p.validFrom || p.validUntil}・公開期間 {p.validFrom ?? '—'} 〜 {p.validUntil ?? '—'}{/if}
					</p>
					{/if}
				</div>
				<div class="flex shrink-0 flex-wrap items-center gap-1.5">
					{#if data.showAll || p.facilities.length > 1}
						{#each p.facilities as f (f.id)}
							<span
								class={`rounded-full border px-2 py-0.5 text-[11px] ${f.enabled ? 'border-brand-800 bg-brand-50 text-brand-900' : 'border-stone-200 text-stone-400 line-through'}`}
								title={f.enabled ? (f.bookingEnabled ? '販売中・予約受付' : '販売中（予約受付なし）') : 'この施設では販売していません'}
							>{f.name}{#if f.enabled && f.bookingEnabled}・予約{/if}</span>
						{/each}
					{/if}
					{#if p.bookingEnabled}<span class="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] text-brand-800">予約受付</span>{/if}
					<span class="rounded-full px-2 py-0.5 text-[11px] {st.cls}">{st.label}</span>
				</div>
			</a>
		{:else}
			<p class="p-4 text-sm text-stone-500">{data.showAll ? 'まだ取引先がありません。' : `${data.facilityName}に設定のある取引先はありません（「すべて」で他の施設の取引先を見られます）。`}</p>
		{/each}
	</div>
{/if}

{#if data.live && !data.error}
	<!-- 請求書の設定（全施設共通・2026-10-09 N3）: 取引先の月次請求書（利用明細書＋適格請求書）の発行元・振込先・通知先 -->
	<div class="mt-6 rounded-xl border border-stone-200 bg-white p-5">
		<h2 class="text-sm font-bold text-stone-700">請求書の設定（全施設共通）</h2>
		<p class="mt-1 max-w-3xl text-xs leading-5 text-stone-500">
			取引先の月次のご請求書・ご利用明細書の発行元と振込先です。ご請求書は取引先ごとに全施設分を1枚にまとめて発行するため、この設定は施設を切り替えても同じです。
			発行済みのご請求書は発行時の内容のまま変わりません（変更は次の発行から）。
			月末の自動発行が ON なら、月末日の15:00〜16:00ごろにチェックアウト基準で発行し、取引先へメールで送ります（差出人は発行者名）。
		</p>
		{#if data.billing.error}
			<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.billing.error}</p>
		{:else if data.billing.settings}
			{@const b = data.billing.settings}
			{#if !b.bankAccount}
				<p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">振込先が未設定です。振込先を登録するまで、月末の請求書は自動発行されません。</p>
			{/if}
			{#if !b.saved}
				<p class="mt-2 text-[11px] text-stone-500">まだ保存されていません（既定値を表示しています。保存するまで月末の自動発行はされません）。</p>
			{/if}
			{#if billingSubmitted && form?.message}
				<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
			{:else if billingSubmitted && form?.billingSaved}
				<p class="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">請求書の設定を保存しました。</p>
			{/if}
			<form
				method="POST"
				action="?/saveBilling"
				use:enhance={() => {
					billingSubmitted = true;
					return async ({ update }) => update({ reset: false });
				}}
				class="mt-3 grid gap-3 sm:grid-cols-2"
			>
				<fieldset disabled={!data.canEdit} class="contents">
					<label class="block text-sm">
						<span class="text-xs text-stone-500">発行者名</span>
						<input name="issuer_name" required maxlength="80" value={b.issuerName} class="mt-0.5 {inputCls}" />
					</label>
					<label class="block text-sm">
						<span class="text-xs text-stone-500">登録番号（適格請求書発行事業者・T＋13桁）</span>
						<input name="registration_number" required value={b.registrationNumber} class="mt-0.5 font-mono {inputCls}" />
					</label>
					<label class="block text-sm">
						<span class="text-xs text-stone-500">住所（〒つき）</span>
						<input name="issuer_address" required maxlength="200" value={b.issuerAddress} class="mt-0.5 {inputCls}" />
					</label>
					<label class="block text-sm">
						<span class="text-xs text-stone-500">TEL（空欄にするとご請求書に載せません）</span>
						<input name="issuer_tel" maxlength="30" value={b.issuerTel} class="mt-0.5 {inputCls}" />
					</label>
					<label class="block text-sm">
						<span class="text-xs text-stone-500">振込先（銀行・支店・種別・口座番号・名義。改行できます）</span>
						<textarea name="bank_account" rows="3" maxlength="300" placeholder={'例: ○○銀行 △△支店\n普通 1234567\nカ）ヤマド'} class="mt-0.5 {inputCls}">{b.bankAccount}</textarea>
					</label>
					<label class="block text-sm">
						<span class="text-xs text-stone-500">備考（ご請求書に載ります）</span>
						<textarea name="note" rows="3" maxlength="500" class="mt-0.5 {inputCls}">{b.note}</textarea>
					</label>
					<label class="flex items-center gap-2 text-sm sm:col-span-2">
						<input type="checkbox" name="auto_issue" checked={b.autoIssue} />
						月末に自動で発行して取引先へ送る
						{#if b.autoIssue && !b.bankAccount}<span class="text-xs text-amber-800">（振込先が未設定のあいだは自動発行されません）</span>{/if}
					</label>
					<label class="block text-sm sm:col-span-2">
						<span class="text-xs text-stone-500">通知先（振込先が未設定などで月末の自動発行を止めたときに知らせるメールアドレス。改行・カンマ区切りで10件まで）</span>
						<textarea name="notify_emails" rows="2" placeholder="例: keiri@example.com" class="mt-0.5 font-mono {inputCls}">{b.notifyEmails.join('\n')}</textarea>
					</label>
				</fieldset>
				{#if data.canEdit}
					<div class="sm:col-span-2">
						<button type="submit" class="rounded-lg bg-brand-800 px-5 py-2 text-sm text-white hover:bg-brand-700">設定を保存</button>
					</div>
				{:else}
					<p class="text-xs text-stone-500 sm:col-span-2">請求書の設定の変更は管理者だけができます。</p>
				{/if}
			</form>
		{/if}
	</div>
{/if}
