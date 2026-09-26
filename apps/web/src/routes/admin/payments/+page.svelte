<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { DEFAULT_EARLY_PREPAY_TIERS, EARLY_PREPAY_MAX_TIERS, percentText } from '$lib/early-prepay';
	import type { SubmitFunction } from '@sveltejs/kit';

	let { data, form } = $props();

	type Tab = 'basic' | 'plans' | 'partners';
	const TABS: { id: Tab; label: string }[] = [
		{ id: 'basic', label: '基本・早期決済割' },
		{ id: 'plans', label: 'プラン別' },
		{ id: 'partners', label: '取引先別' }
	];
	const tab = $derived<Tab>(((t) => (t === 'plans' || t === 'partners' ? t : 'basic'))(page.url.searchParams.get('tab')));

	const METHOD_LABEL: Record<string, string> = {
		onsite: '現地払いのみ',
		prepayment: '予約時決済のみ',
		deposit: '予約時決済・現地払いを選べる'
	};
	const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

	// 保存後もフォームの入力を残す（既定の enhance はフォームをリセットする）
	const keep: SubmitFunction = () => async ({ update }) => update({ reset: false });

	// ---- 早期決済割の編集状態 ----
	type TierRow = { days: number | string; percent: number | string };
	type BlackRow = { from: string; to: string; label: string };
	function initEarly() {
		const s = data.settings?.earlyPrepay;
		return {
			enabled: s?.enabled ?? false,
			tiers: (s && s.tiers.length ? s.tiers : DEFAULT_EARLY_PREPAY_TIERS).map((t) => ({ days: t.days, percent: t.percent })) as TierRow[],
			blackouts: (s?.blackouts ?? []).map((b) => ({ ...b })) as BlackRow[]
		};
	}
	let early = $state(initEarly());
	const addTier = () => {
		if (early.tiers.length >= EARLY_PREPAY_MAX_TIERS) return;
		const last = early.tiers.at(-1);
		early.tiers.push({ days: last ? Number(last.days) + 90 : 30, percent: last ? Number(last.percent) + 2 : 3 });
	};
	const resetTiers = () => (early.tiers = DEFAULT_EARLY_PREPAY_TIERS.map((t) => ({ ...t })));

	// 試算（1予約の宿泊料金を入れると、段ごとの割引額・お支払い額が出る）
	let sample = $state(60000);
	const STRIPE_FEE = 3.6;
	const previewRows = $derived.by(() => {
		const tiers = early.tiers
			.map((t) => ({ days: Number(t.days), percent: Number(t.percent) }))
			.filter((t) => Number.isFinite(t.days) && Number.isFinite(t.percent) && t.days > 0)
			.sort((a, b) => a.days - b.days);
		const total = Math.max(0, Math.round(Number(sample) || 0));
		const rows = [{ label: tiers.length ? `${tiers[0].days - 1}日前まで` : '全期間', percent: 0 }];
		tiers.forEach((t, i) => {
			const next = tiers[i + 1];
			rows.push({ label: next ? `${t.days}〜${next.days - 1}日前` : `${t.days}日前以上`, percent: t.percent });
		});
		return rows.map((r) => {
			const discount = Math.floor((total * Math.round(r.percent * 10)) / 1000);
			return { ...r, discount, pay: total - discount, cost: r.percent + STRIPE_FEE };
		});
	});

	// ---- プラン別 ----
	const initPlanMethod = () => Object.fromEntries((data.settings?.plans ?? []).map((p) => [p.id, p.paymentMethod as string]));
	let planMethod = $state<Record<string, string>>(initPlanMethod());
	const earlyMax = $derived(
		early.enabled ? Math.max(0, ...(data.settings?.earlyPrepay.tiers ?? []).map((t) => t.percent)) : 0
	);
	const savedEarlyOn = $derived(data.settings?.earlyPrepay.enabled ?? false);
	const savedEarlyMax = $derived(Math.max(0, ...(data.settings?.earlyPrepay.tiers ?? []).map((t) => t.percent)));

	// ---- 取引先別 ----
	const initDiscountType = () => Object.fromEntries(data.partners.map((p) => [p.id, p.prepayDiscount.type as string]));
	let partnerDiscountType = $state<Record<string, string>>(initDiscountType());

	const f = $derived(form as { scope?: string; error?: string; saved?: boolean; planId?: string; partnerId?: string } | null);
</script>

<svelte:head><title>支払方法 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">支払方法</h1>
<p class="mb-4 max-w-3xl text-xs text-stone-400">
	{data.facilityName} の支払方法をここでまとめて設定します。公式サイトのお客様向け（基本・早期決済割・プラン別）と、取引先ページ向け（取引先別）があります。
</p>

<nav class="mb-4 flex gap-1 border-b border-stone-200 text-sm">
	{#each TABS as t (t.id)}
		<a
			href="?tab={t.id}"
			data-sveltekit-noscroll
			class="-mb-px rounded-t-md border px-3 py-2 {tab === t.id
				? 'border-stone-200 border-b-white bg-white font-medium text-stone-800'
				: 'border-transparent text-stone-500 hover:text-stone-800'}">{t.label}</a
		>
	{/each}
</nav>

{#if !data.live}
	<p class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{data.notLive}（デモの内容を表示しています。保存はできません）</p>
{/if}
{#if tab === 'basic'}
	<!-- ============ 基本 ============ -->
	<section class="mb-6 grid gap-3 md:grid-cols-2">
		<div class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
			<h2 class="mb-2 font-medium text-stone-800">公式サイトのお客様</h2>
			<dl class="space-y-1.5 text-stone-600">
				<div class="flex gap-2">
					<dt class="w-28 shrink-0 text-stone-400">現地払い</dt>
					<dd>現地PayPay決済・現地カード決済・現地現金決済（予約確認画面で選択。PayPay を先頭に表示）</dd>
				</div>
				<div class="flex gap-2">
					<dt class="w-28 shrink-0 text-stone-400">予約時決済</dt>
					<dd>
						オンライン決済（Stripe・カード / Apple Pay / Google Pay）
						{#if data.status?.directOnline}
							<span class="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">利用できます</span>
						{:else}
							<span class="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">未設定（事前決済のみのプランも現地払いで受けます）</span>
						{/if}
					</dd>
				</div>
				<div class="flex gap-2">
					<dt class="w-28 shrink-0 text-stone-400">どれを出すか</dt>
					<dd>料金プランごとに決めます → <a href="?tab=plans" class="text-sky-700 hover:underline">プラン別</a></dd>
				</div>
			</dl>
		</div>
		<div class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
			<h2 class="mb-2 font-medium text-stone-800">取引先ページ</h2>
			<dl class="space-y-1.5 text-stone-600">
				<div class="flex gap-2">
					<dt class="w-28 shrink-0 text-stone-400">支払方法</dt>
					<dd>月末締め翌月末銀行振込／オンライン決済（予約時）／オンライン決済（チェックイン日）</dd>
				</div>
				<div class="flex gap-2">
					<dt class="w-28 shrink-0 text-stone-400">オンライン決済</dt>
					<dd>
						{#if data.status?.partnerOnline}
							<span class="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">利用できます</span>
						{:else}
							<span class="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">未設定</span>
						{/if}
					</dd>
				</div>
				<div class="flex gap-2">
					<dt class="w-28 shrink-0 text-stone-400">どれを出すか</dt>
					<dd>取引先ごとに決めます → <a href="?tab=partners" class="text-sky-700 hover:underline">取引先別</a>（早期決済割は取引先には効きません）</dd>
				</div>
			</dl>
		</div>
	</section>

	<section class="rounded-xl border border-stone-200 bg-white p-4">
		<div class="mb-1 flex items-center justify-between">
			<h2 class="font-medium text-stone-800">早期決済割（公式サイトの予約時決済）</h2>
			{#if f?.scope === 'early' && f.saved}<span class="text-xs text-emerald-600">✔ 保存しました</span>{/if}
		</div>
		<p class="mb-3 max-w-3xl text-xs text-stone-500">
			ご宿泊日が先の予約ほど、予約時に決済すると割引率が上がります。率は「予約した日から宿泊初日までの日数」で決まります。
			対象はプラン別で「早期決済割の対象」にしたプランだけです。プランの定率割引がある場合は、泊ごとに大きい方の率を使います（足し算はしません。上限 20%）。
			<b class="text-stone-700">割引額はお客様都合の取消では返金しません</b>（キャンセル料を免除した取消は全額返金）。予約画面にも同じ大きさで表示します。
		</p>
		{#if data.settingsError}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.settingsError}</p>{/if}
		{#if f?.scope === 'early' && f.error}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{f.error}</p>{/if}
		{#if !data.canEditAdmin}<p class="mb-3 text-xs text-stone-400">閲覧のみ（変更は管理者だけができます）。</p>{/if}

		<form method="POST" action="?/saveEarlyPrepay" use:enhance={keep} class="text-sm">
			<fieldset disabled={!data.canEditAdmin || !!data.settingsError} class="space-y-5">
				<label class="flex items-center gap-2">
					<input type="checkbox" name="enabled" bind:checked={early.enabled} class="h-4 w-4" />
					<span class="font-medium text-stone-700">早期決済割を使う</span>
					<span class="text-xs text-stone-400">（オフにすると段階表は効かず、プランの定率割引だけになります）</span>
				</label>

				<div class="grid gap-6 lg:grid-cols-2">
					<!-- 段階表 -->
					<div>
						<h3 class="mb-2 text-xs font-medium text-stone-500">段階表（最大 {EARLY_PREPAY_MAX_TIERS} 段・日数も率も上の段より大きく）</h3>
						<div class="space-y-2">
							{#each early.tiers as t, i (i)}
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-stone-400">宿泊初日の</span>
									<input type="number" name="tier_days" bind:value={t.days} min="1" max="365" class="w-20 rounded-md border border-stone-300 px-2 py-1.5 text-right" />
									<span class="text-stone-500">日前以上なら</span>
									<input type="number" name="tier_percent" bind:value={t.percent} min="1" max="20" step="0.1" class="w-20 rounded-md border border-stone-300 px-2 py-1.5 text-right" />
									<span class="text-stone-500">% 引き</span>
									<button type="button" onclick={() => early.tiers.splice(i, 1)} class="ml-1 text-xs text-red-500 hover:underline">削除</button>
								</div>
							{/each}
						</div>
						<div class="mt-2 flex gap-3 text-xs">
							{#if early.tiers.length < EARLY_PREPAY_MAX_TIERS}
								<button type="button" onclick={addTier} class="text-sky-700 hover:underline">＋ 段を追加</button>
							{/if}
							<button type="button" onclick={resetTiers} class="text-stone-500 hover:underline">推奨値（30日 3%・90日 5%・180日 8%）に戻す</button>
						</div>
					</div>

					<!-- 試算 -->
					<div class="rounded-lg bg-stone-50 p-3">
						<div class="mb-2 flex items-center gap-2 text-xs text-stone-500">
							試算: 宿泊料金
							<input type="number" bind:value={sample} min="0" step="1000" class="w-28 rounded-md border border-stone-300 px-2 py-1 text-right text-sm" />
							円の予約
						</div>
						<table class="w-full text-xs">
							<thead class="text-stone-400">
								<tr><th class="py-1 text-left font-normal">予約の時期</th><th class="text-right font-normal">割引</th><th class="text-right font-normal">お得額</th><th class="text-right font-normal">お支払い</th><th class="text-right font-normal" title="割引＋Stripe 手数料 3.6%">宿の負担</th></tr>
							</thead>
							<tbody class="text-stone-700">
								{#each previewRows as r (r.label)}
									<tr class="border-t border-stone-200">
										<td class="py-1">{r.label}</td>
										<td class="text-right">{percentText(r.percent)}%</td>
										<td class="text-right">{r.discount ? yen(r.discount) : '—'}</td>
										<td class="text-right">{yen(r.pay)}</td>
										<td class="text-right {r.cost > 10 ? 'text-amber-700' : 'text-stone-500'}">{r.cost.toFixed(1)}%</td>
									</tr>
								{/each}
							</tbody>
						</table>
						<p class="mt-2 text-[11px] leading-relaxed text-stone-400">宿の負担＝割引＋Stripe 手数料（約3.6%）。OTA の手数料（概ね 10〜15%）を下回る範囲が目安です。</p>
					</div>
				</div>

				<!-- 除外期間 -->
				<div>
					<h3 class="mb-1 text-xs font-medium text-stone-500">除外期間（繁忙期）</h3>
					<p class="mb-2 text-xs text-stone-400">この期間に泊まる日には段階表を当てません（泊ごとに判定・プランの定率割引は残ります）。割引しなくても埋まる日を入れます。毎年の分は年ごとに追加してください。</p>
					<div class="space-y-2">
						{#each early.blackouts as b, i (i)}
							<div class="flex flex-wrap items-center gap-2">
								<input type="date" name="bo_from" bind:value={b.from} class="rounded-md border border-stone-300 px-2 py-1.5" />
								<span class="text-stone-400">〜</span>
								<input type="date" name="bo_to" bind:value={b.to} class="rounded-md border border-stone-300 px-2 py-1.5" />
								<input type="text" name="bo_label" bind:value={b.label} maxlength="40" placeholder="例: 紅葉ピーク" class="w-40 rounded-md border border-stone-300 px-2 py-1.5" />
								<button type="button" onclick={() => early.blackouts.splice(i, 1)} class="text-xs text-red-500 hover:underline">削除</button>
							</div>
						{/each}
						{#if early.blackouts.length === 0}<p class="text-xs text-stone-400">除外期間はありません。</p>{/if}
					</div>
					<button type="button" onclick={() => early.blackouts.push({ from: '', to: '', label: '' })} class="mt-2 text-xs text-sky-700 hover:underline">＋ 期間を追加</button>
				</div>

				<div class="flex items-center gap-3">
					<button type="submit" class="rounded-md bg-stone-800 px-4 py-2 text-sm text-white hover:bg-stone-700 disabled:opacity-40">早期決済割を保存</button>
					{#if data.settings?.updatedAt}<span class="text-xs text-stone-400">最終更新 {new Date(data.settings.updatedAt).toLocaleString('ja-JP')}</span>{/if}
				</div>
			</fieldset>
		</form>

		<details class="mt-5 rounded-lg border border-stone-200 p-3 text-xs text-stone-600">
			<summary class="cursor-pointer font-medium text-stone-700">段階表の考え方（初期値の根拠と見直し方）</summary>
			<ul class="mt-2 list-disc space-y-1 pl-5 leading-relaxed">
				<li><b>段は3つ＋0%</b>。多すぎると「あと何日早ければ得か」が見えにくくなり、行動につながりません。</li>
				<li><b>30 / 90 / 180日</b>は「1カ月・3カ月・半年」と言える区切り。早割プラン（45 / 75日・男鹿は 60 / 90日）と日数をずらし、「料金が下がる早割」と「払い方で下がる早期決済割」を混同させません。</li>
				<li><b>3 → 5 → 8%</b>と上に行くほど差を広げます（差を実感してもらうため）。端数の率は避けます。最上段でも 8%＋手数料 3.6%＝11.6% で OTA より安く、上限 20% の半分以下です。</li>
				<li>遠い日程ほど取消が多くなりますが、割引額は取消時に返金しないので、割引だけ取られる心配はありません。</li>
				<li>早割プランは初期値で対象外にしています（重ねると OTA 並みの負担になるため）。</li>
				<li>見直しは四半期ごと。見るもの: 直販のうち予約時決済の割合（目標 40%）・段ごとの件数と割引総額（直販売上の 2% 以内が目安）・割引付き予約の取消率・直販のリードタイム中央値。</li>
				<li>最上段の利用が少なくても、8% は「見せる段」として残す価値があります（負担は小さく、比べる基準になる）。繁忙期に割引予約が多いときは、率ではなく除外期間を足して調整します。</li>
			</ul>
		</details>
	</section>
{:else if tab === 'plans'}
	<!-- ============ プラン別 ============ -->
	<p class="mb-3 max-w-3xl text-xs text-stone-500">
		料金プランごとに、お客様が選べる支払方法と割引を決めます。定率割引は予約時決済を選んだときの割引（0〜20%）、早期決済割は
		<a href="?tab=basic" class="text-sky-700 hover:underline">基本</a>
		の段階表です。両方あるときは泊ごとに大きい方を使います。
		{#if savedEarlyOn}
			<span class="text-stone-600">現在、早期決済割は ON（最大 {percentText(savedEarlyMax)}%）。</span>
		{:else}
			<span class="text-amber-700">現在、早期決済割は OFF です（対象にしても効きません）。</span>
		{/if}
	</p>
	{#if data.settingsError}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.settingsError}</p>{/if}

	<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
		<table class="w-full min-w-[760px] text-sm">
			<thead class="bg-stone-50 text-xs text-stone-500">
				<tr>
					<th class="px-3 py-2 text-left font-normal">プラン</th>
					<th class="px-3 py-2 text-left font-normal">支払方法</th>
					<th class="px-3 py-2 text-left font-normal">定率割引</th>
					<th class="px-3 py-2 text-left font-normal">早期決済割</th>
					<th class="px-3 py-2 text-left font-normal">予約時決済の最大割引</th>
					<th class="px-3 py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.settings?.plans ?? [] as p (p.id)}
					{@const onsite = planMethod[p.id] === 'onsite'}
					{@const shown = p.isActive && p.publicOnDirect && p.isPublished}
					<tr class="border-t border-stone-100 align-top {shown ? '' : 'bg-stone-50/60 text-stone-500'}">
						<td class="px-3 py-2">
							<div class="font-medium">{p.headline || p.name}</div>
							<div class="text-xs text-stone-400">
								{p.code}{#if p.headline && p.headline !== p.name}・{p.name}{/if}
								{#if !shown}<span class="ml-1 rounded bg-stone-200 px-1 text-[10px] text-stone-600">公式サイト非公開</span>{/if}
							</div>
						</td>
						<td class="px-3 py-2" colspan="4">
							<form id="plan-{p.id}" method="POST" action="?/savePlan" use:enhance={keep} class="grid grid-cols-[1.3fr_0.8fr_1fr_1fr] items-center gap-3">
								<input type="hidden" name="planId" value={p.id} />
								<select name="method" bind:value={planMethod[p.id]} disabled={!p.hasContent} class="rounded-md border border-stone-300 px-2 py-1.5 text-sm">
									{#each Object.entries(METHOD_LABEL) as [v, l] (v)}<option value={v}>{l}</option>{/each}
								</select>
								<select name="discount" disabled={onsite || !p.hasContent} class="rounded-md border border-stone-300 px-2 py-1.5 text-sm">
									{#each Array.from({ length: 21 }, (_, i) => i) as d (d)}
										<option value={d} selected={Math.round(p.prepayDiscountRate * 100) === d}>{d === 0 ? 'なし' : `${d}%`}</option>
									{/each}
								</select>
								<label class="flex items-center gap-1.5 text-xs">
									<input type="checkbox" name="early" checked={p.earlyPrepay} disabled={onsite || !p.hasContent} class="h-4 w-4" />
									対象にする
									<!-- 現地払いのみにしても「対象」の設定は残す（無効化したチェックは送信されないため） -->
									{#if onsite && p.earlyPrepay}<input type="hidden" name="early" value="on" />{/if}
								</label>
								<span class="text-xs text-stone-600">
									{#if onsite}—（予約時決済なし）
									{:else}
										{@const flat = Math.round(p.prepayDiscountRate * 100)}
										{@const max = Math.max(flat, p.earlyPrepay && savedEarlyOn ? savedEarlyMax : 0)}
										{max ? `最大 ${percentText(max)}%` : '割引なし'}
									{/if}
								</span>
							</form>
							{#if !p.hasContent}<p class="mt-1 text-xs text-amber-700">プラン紹介が未作成のため保存できません（プラン画面で紹介を作ってください）。</p>{/if}
							{#if f?.scope === 'plan' && f.planId === p.id && f.error}<p class="mt-1 text-xs text-red-600">{f.error}</p>{/if}
						</td>
						<td class="whitespace-nowrap px-3 py-2 text-right">
							{#if f?.scope === 'plan' && f.planId === p.id && f.saved}<span class="mr-2 text-xs text-emerald-600">✔</span>{/if}
							<button type="submit" form="plan-{p.id}" disabled={!p.hasContent} class="rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50 disabled:opacity-40">保存</button>
						</td>
					</tr>
				{:else}
					<tr><td colspan="6" class="px-3 py-6 text-center text-sm text-stone-400">料金プランがありません。</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="mt-2 text-xs text-stone-400">
		「最大割引」は保存済みの内容で計算しています。早期決済割の段は予約した日から宿泊初日までの日数で決まり、除外期間の泊は定率割引だけになります。料金・食事・対象客室は RMS で管理しています。
		{#if earlyMax !== savedEarlyMax && early.enabled}（基本タブの未保存の変更は反映されていません）{/if}
	</p>
{:else}
	<!-- ============ 取引先別 ============ -->
	<p class="mb-3 max-w-3xl text-xs text-stone-500">
		取引先ページで取引先が選べる支払方法と、予約時決済（オンライン決済・予約時）の割引です。取引先の割引は段階表ではなく一律です。
		受付期限・キャンセル期限・追加項目などは各取引先の画面で設定します。
	</p>
	{#if data.partnersError}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.partnersError}</p>{/if}
	{#if !data.canEditAdmin}<p class="mb-3 text-xs text-stone-400">閲覧のみ（変更は管理者だけができます）。</p>{/if}

	<div class="space-y-3">
		{#each data.partners as p (p.id)}
			<form method="POST" action="?/savePartner" use:enhance={keep} class="rounded-xl border border-stone-200 bg-white p-4 text-sm {p.isActive ? '' : 'opacity-70'}">
				<input type="hidden" name="partnerId" value={p.id} />
				<div class="mb-2 flex flex-wrap items-center gap-2">
					<a href="/admin/partners/{p.id}" class="font-medium text-stone-800 hover:underline">{p.name}</a>
					<span class="text-xs text-stone-400">{data.kindLabels[p.kind as keyof typeof data.kindLabels] ?? p.kind}</span>
					{#if !p.isActive}<span class="rounded bg-stone-200 px-1.5 text-[10px] text-stone-600">無効</span>{/if}
					<span class="rounded px-1.5 text-[10px] {p.bookingEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}">{p.bookingEnabled ? '予約受付中' : '予約受付なし'}</span>
					{#if f?.scope === 'partner' && f.partnerId === p.id && f.saved}<span class="text-xs text-emerald-600">✔ 保存しました</span>{/if}
				</div>
				<fieldset disabled={!data.canEditAdmin} class="flex flex-wrap items-center gap-x-5 gap-y-2">
					{#each data.partnerPaymentOptions as o (o.id)}
						<label class="flex items-center gap-1.5" title={o.note}>
							<input type="checkbox" name="pay_{o.id}" checked={p.paymentOptions.includes(o.id)} class="h-4 w-4" />
							{o.label}
						</label>
					{/each}
					<span class="flex items-center gap-1.5">
						<span class="text-xs text-stone-500">予約時決済の割引</span>
						<select name="discount_type" bind:value={partnerDiscountType[p.id]} class="rounded-md border border-stone-300 px-2 py-1 text-sm">
							<option value="none">なし</option>
							<option value="percent">%引き</option>
							<option value="yen">1名1泊 円引き</option>
						</select>
						{#if partnerDiscountType[p.id] !== 'none'}
							<input type="number" name="discount_value" value={p.prepayDiscount.value || ''} min="1" max={partnerDiscountType[p.id] === 'percent' ? 50 : 100000} class="w-24 rounded-md border border-stone-300 px-2 py-1 text-right" />
							<span class="text-xs text-stone-500">{partnerDiscountType[p.id] === 'percent' ? '%' : '円'}</span>
						{/if}
					</span>
					<button type="submit" class="ml-auto rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50">保存</button>
				</fieldset>
				{#if f?.scope === 'partner' && f.partnerId === p.id && f.error}<p class="mt-2 text-xs text-red-600">{f.error}</p>{/if}
			</form>
		{:else}
			{#if !data.partnersError}<p class="text-sm text-stone-400">取引先がありません。<a href="/admin/partners" class="text-sky-700 hover:underline">取引先</a>から追加できます。</p>{/if}
		{/each}
	</div>
{/if}
