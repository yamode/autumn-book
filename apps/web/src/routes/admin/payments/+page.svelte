<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { EARLY_PREPAY_MAX_TIERS, percentText, RECOMMENDED_EARLY_PREPAY_TIERS, type EarlyPrepayMode } from '$lib/early-prepay';
	import { ADMIN_FEE_MAX_PERCENT, adminFeeNotice, STRIPE_FEE_PERCENT } from '$lib/cancel-admin-fee';
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
		const mode: EarlyPrepayMode = s?.mode ?? 'discount';
		return {
			enabled: s?.enabled ?? false,
			mode,
			tiers: (s && s.tiers.length ? s.tiers : RECOMMENDED_EARLY_PREPAY_TIERS[mode]).map((t) => ({ days: t.days, percent: t.percent })) as TierRow[],
			blackouts: (s?.blackouts ?? []).map((b) => ({ ...b })) as BlackRow[]
		};
	}
	let early = $state(initEarly());
	const addTier = () => {
		if (early.tiers.length >= EARLY_PREPAY_MAX_TIERS) return;
		const last = early.tiers.at(-1);
		early.tiers.push({ days: last ? Number(last.days) + 30 : 90, percent: last ? Number(last.percent) + 2 : 5 });
	};
	const resetTiers = () => (early.tiers = RECOMMENDED_EARLY_PREPAY_TIERS[early.mode].map((t) => ({ ...t })));
	const recommendedText = $derived(
		RECOMMENDED_EARLY_PREPAY_TIERS[early.mode].map((t) => `${t.days}日 ${early.mode === 'points' ? '+' : ''}${t.percent}%`).join('・')
	);
	const unit = $derived(early.mode === 'points' ? 'ポイント' : '割引');

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
		const points = early.mode === 'points';
		return rows.map((r) => {
			const permille = Math.round(r.percent * 10);
			// 割引: 請求額から引く。ポイント: 請求額は変わらず、税抜宿泊料金 × 率 を宿泊後に付与（DB と同じ ÷1.10・切り捨て）
			const discount = points ? 0 : Math.floor((total * permille) / 1000);
			const pt = points ? Math.floor((total * permille) / 1100) : 0;
			// 宿の負担（額面）。ポイントは未使用・再来の効果で実質はこれより小さい
			const cost = (points ? r.percent / 1.1 : r.percent) + STRIPE_FEE;
			return { ...r, discount, pt, pay: total - discount, cost };
		});
	});

	// ---- プラン別 ----
	const initPlanMethod = () => Object.fromEntries((data.settings?.plans ?? []).map((p) => [p.id, p.paymentMethod as string]));
	let planMethod = $state<Record<string, string>>(initPlanMethod());
	const earlyMax = $derived(
		early.enabled ? Math.max(0, ...(data.settings?.earlyPrepay.tiers ?? []).map((t) => t.percent)) : 0
	);
	const savedEarlyOn = $derived(data.settings?.earlyPrepay.enabled ?? false);
	const savedPoints = $derived(data.settings?.earlyPrepay.mode === 'points');
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
					<dd>月末締め翌月末銀行振込／オンライン決済（予約時）／オンライン決済（チェックアウト日）</dd>
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

	<!-- 予約時決済の事務手数料（取消時に返金しない率・2026-10-07）。公式サイト・取引先ページの両方に効く -->
	<section class="mb-6 rounded-xl border border-stone-200 bg-white p-4">
		<div class="mb-1 flex items-center justify-between">
			<h2 class="font-medium text-stone-800">事務手数料（予約時決済の取消で返金しない率）</h2>
			{#if f?.scope === 'adminFee' && f.saved}<span class="text-xs text-emerald-600">✔ 保存しました</span>{/if}
		</div>
		<p class="mb-3 max-w-3xl text-xs text-stone-500">
			予約時にオンライン決済（全額・取引先のデポジットを含む）で払った予約を取り消したとき、この率の額はキャンセル料の期間に関係なく返金しません。
			返金しない額はキャンセル料・予約時決済の割引額・事務手数料の<b class="text-stone-700">いちばん大きい方</b>です（足し合わせません）。
			公式サイトと取引先ページの両方に効き、予約前に率を表示します。率は予約ごとに残すので、変えても既にある予約は予約時の率のままです。
			Stripe の決済手数料（{STRIPE_FEE_PERCENT}%）以下にはできません（0%＝事務手数料なしも不可。取らない取消は、取消フォームで「事務手数料も免除」を選びます）。チェックアウト日決済（カード登録のみ）は対象外です。
		</p>
		{#if f?.scope === 'adminFee' && f.error}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{f.error}</p>{/if}
		{#if data.settings}
			<form method="POST" action="?/saveAdminFee" use:enhance={keep} class="flex flex-wrap items-end gap-3 text-sm">
				<fieldset disabled={!data.canEditAdmin || !!data.settingsError} class="flex flex-wrap items-end gap-3">
					<label class="grid gap-1">
						<span class="text-xs text-stone-500">率（%）</span>
						<input
							name="percent"
							type="number"
							step="0.1"
							min={STRIPE_FEE_PERCENT + 0.1}
							max={ADMIN_FEE_MAX_PERCENT}
							value={data.settings.cancelAdminFeePercent}
							required
							class="w-24 rounded-md border border-stone-300 px-2 py-1.5 text-right"
						/>
					</label>
					<button type="submit" class="rounded-md bg-stone-800 px-3 py-1.5 text-white hover:bg-stone-700">保存</button>
				</fieldset>
				<p class="w-full max-w-3xl text-xs text-stone-500">お客様への表示: {adminFeeNotice(data.settings.cancelAdminFeePercent, 'partner')}</p>
			</form>
		{/if}
	</section>

	<section class="rounded-xl border border-stone-200 bg-white p-4">
		<div class="mb-1 flex items-center justify-between">
			<h2 class="font-medium text-stone-800">早期決済割／早期決済ポイント（公式サイトの予約時決済）</h2>
			{#if f?.scope === 'early' && f.saved}<span class="text-xs text-emerald-600">✔ 保存しました</span>{/if}
		</div>
		<p class="mb-3 max-w-3xl text-xs text-stone-500">
			ご宿泊日が先の予約ほど、予約時に決済したときの還元が大きくなります。率は「予約した日から宿泊初日までの日数」で決まります。対象はプラン別で「対象」にしたプランだけです。
			還元方法は施設ごとに選びます。<b class="text-stone-700">割引</b>＝請求額から引く（プランの定率割引とは泊ごとに大きい方・上限 20%）。
			<b class="text-stone-700">ポイント</b>＝請求額は変えず、税抜宿泊料金 × 率 のポイントをご宿泊後に上乗せ付与（会員ランクの通常ポイントとは別。プランの定率割引はそのまま割引）。
			割引額はお客様都合の取消では返金しません（入湯税は返金・キャンセル料免除の取消は全額返金）。ポイントは宿泊後の付与なので、取消されれば付きません。
			非会員の予約でも、ご宿泊日までに同じメールアドレスで会員登録すればポイントが付きます。
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

				<div class="flex flex-wrap items-center gap-4">
					<span class="text-xs font-medium text-stone-500">還元方法</span>
					<label class="flex items-center gap-1.5"><input type="radio" name="mode" value="discount" bind:group={early.mode} class="h-4 w-4" /> 割引（早期決済割）</label>
					<label class="flex items-center gap-1.5"><input type="radio" name="mode" value="points" bind:group={early.mode} class="h-4 w-4" /> ポイント上乗せ（早期決済ポイント）</label>
					{#if early.mode !== (data.settings?.earlyPrepay.mode ?? 'discount')}
						<button type="button" onclick={resetTiers} class="text-xs text-sky-700 hover:underline">段階表をこの方式の推奨値にする</button>
					{/if}
				</div>

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
									<span class="text-stone-500">{early.mode === 'points' ? '% ポイント上乗せ' : '% 引き'}</span>
									<button type="button" onclick={() => early.tiers.splice(i, 1)} class="ml-1 text-xs text-red-500 hover:underline">削除</button>
								</div>
							{/each}
						</div>
						<div class="mt-2 flex gap-3 text-xs">
							{#if early.tiers.length < EARLY_PREPAY_MAX_TIERS}
								<button type="button" onclick={addTier} class="text-sky-700 hover:underline">＋ 段を追加</button>
							{/if}
							<button type="button" onclick={resetTiers} class="text-stone-500 hover:underline">推奨値（{recommendedText}）に戻す</button>
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
								<tr><th class="py-1 text-left font-normal">予約の時期</th><th class="text-right font-normal">{unit}</th><th class="text-right font-normal">{early.mode === 'points' ? '付与pt' : 'お得額'}</th><th class="text-right font-normal">お支払い</th><th class="text-right font-normal" title="還元（額面）＋Stripe 手数料 3.6%">宿の負担</th></tr>
							</thead>
							<tbody class="text-stone-700">
								{#each previewRows as r (r.label)}
									<tr class="border-t border-stone-200">
										<td class="py-1">{r.label}</td>
										<td class="text-right">{early.mode === 'points' && r.percent ? '+' : ''}{percentText(r.percent)}%</td>
										<td class="text-right">{early.mode === 'points' ? (r.pt ? `${r.pt.toLocaleString('ja-JP')}pt` : '—') : r.discount ? yen(r.discount) : '—'}</td>
										<td class="text-right">{yen(r.pay)}</td>
										<td class="text-right {r.cost > 10 ? 'text-amber-700' : 'text-stone-500'}">{r.cost.toFixed(1)}%</td>
									</tr>
								{/each}
							</tbody>
						</table>
						<p class="mt-2 text-[11px] leading-relaxed text-stone-400">宿の負担＝還元の額面＋Stripe 手数料（約3.6%）。OTA の手数料（概ね 10〜15%）を下回る範囲が目安です。ポイントは使われない分（ホテル業界で15〜25%）や再来の効果があり、実質の負担は額面の5〜6割程度とされます。</p>
					</div>
				</div>

				<!-- 除外期間 -->
				<div>
					<h3 class="mb-1 text-xs font-medium text-stone-500">除外期間（繁忙期）</h3>
					<p class="mb-2 text-xs text-stone-400">この期間に泊まる日には段階表を当てません（泊ごとに判定・プランの定率割引は残ります）。還元しなくても埋まる日を入れます。毎年の分は年ごとに追加してください。</p>
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
					<button type="submit" class="rounded-md bg-stone-800 px-4 py-2 text-sm text-white hover:bg-stone-700 disabled:opacity-40">保存</button>
					{#if data.settings?.updatedAt}<span class="text-xs text-stone-400">最終更新 {new Date(data.settings.updatedAt).toLocaleString('ja-JP')}</span>{/if}
				</div>
			</fieldset>
		</form>

		<details class="mt-5 rounded-lg border border-stone-200 p-3 text-xs text-stone-600">
			<summary class="cursor-pointer font-medium text-stone-700">段階表の考え方（推奨値の根拠と見直し方・2026-09-27 改訂）</summary>
			<ul class="mt-2 list-disc space-y-1 pl-5 leading-relaxed">
				<li><b>3カ月前から始める</b>。国内の旅館は2カ月前ごろに予約が入り始める（最初のピーク）ため、そこに還元を当てると「放っておいても入る予約」に配るだけになります（カニバリゼーション）。予約の入り方が立ち上がる手前だけに段を置くのが定石です。</li>
				<li>遠い日程の予約者ほど「行くかどうか・どこに行くか」がまだ決まっておらず、値引きに反応しやすい。直前の予約者は日程が決まっていて反応しにくい。予約時決済という条件で、反応する層だけに還元します。</li>
				<li><b>割引: 90日 5%・120日 8%・150日 10%</b>（段は3つ・30日刻みで「○カ月前」と言える区切り）。最上段は OTA 手数料の下限（約10%）まで。大手ホテルの前払いレートは 5〜15% 引きが一般的です。</li>
				<li><b>ポイント: 90日 +8%・120日 +12%・150日 +15%</b>（割引の約1.5倍）。ポイントは使われない分と、次の宿泊での利用（再来）があるため、実質の負担は割引とほぼ同じで、見た目の率は大きくできます。2倍以上にはしない（負債が積み上がる）。</li>
				<li>男鹿は認知がまだ浅く予約が直前寄りと見て、割引 60日 5%・90日 8%・120日 10% から（実績が出て2カ月前ピークなら 90日始まりに戻す）。西和賀はリピーターと会員化を重視してポイント。両館で方式が違うので比べられます。</li>
				<li>自社の宿泊代金にだけ使えるポイントは「値引」扱いで景品表示法の景品規制の対象外。物品や他社ポイントと交換できるようにすると規制がかかるので付けない。会計上は付与時に契約負債（収益認識基準）。</li>
				<li>見直しは四半期ごと（段の変更は年2回まで）。見るもの: 直販のうち予約時決済の割合／リードタイム帯（0-29・30-59・60-89・90-119・120-149・150日〜）ごとの件数と取消率（予約時決済と現地払いで比べる）／ポイントの付与・利用・失効／予約から始まった会員登録数。</li>
				<li><b>効き目の判定</b>: 導入前の同じ月と比べて「90日以上前の予約」が増え、「60〜89日の予約」が減っていなければ効いている。60〜89日が減っていれば入口が早すぎる（予約が前にずれただけ）。</li>
				<li>予約の入り方の実績が1年分たまったら: 入口の段＝最終稼働の10〜15%が埋まる日数より前、最上段＝3〜5%しか埋まっていない日数、その間を等分（3段まで）。予約が目標より早く埋まる日は除外期間に入れる。</li>
			</ul>
		</details>
	</section>
{:else if tab === 'plans'}
	<!-- ============ プラン別 ============ -->
	<p class="mb-3 max-w-3xl text-xs text-stone-500">
		料金プランごとに、お客様が選べる支払方法と割引を決めます。支払方法は会員（ログインした会員）と非会員で分けられます（例: 会員は現地払いも可・非会員は予約時決済のみ）。定率割引と早期決済割の対象は、会員の支払方法が「現地払いのみ」だと設定できません。定率割引は予約時決済を選んだときの割引（0〜20%）、早期決済割／ポイントは
		<a href="?tab=basic" class="text-sky-700 hover:underline">基本</a>
		の段階表です。割引方式のときは定率割引と泊ごとに大きい方、ポイント方式のときは定率割引に加えてポイントが付きます。
		{#if savedEarlyOn}
			<span class="text-stone-600">現在、{savedPoints ? '早期決済ポイントは ON（最大 +' : '早期決済割は ON（最大 '}{percentText(savedEarlyMax)}%）。</span>
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
					<th class="px-3 py-2 text-left font-normal">支払方法（会員／非会員）</th>
					<th class="px-3 py-2 text-left font-normal">定率割引</th>
					<th class="px-3 py-2 text-left font-normal">早期決済割</th>
					<th class="px-3 py-2 text-left font-normal">予約時決済の最大還元</th>
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
								<div class="space-y-1">
									<label class="flex items-center gap-1.5 text-xs text-stone-500">
										<span class="w-10 shrink-0">会員</span>
										<select name="method" bind:value={planMethod[p.id]} disabled={!p.hasContent} class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-800">
											{#each Object.entries(METHOD_LABEL) as [v, l] (v)}<option value={v}>{l}</option>{/each}
										</select>
									</label>
									<label class="flex items-center gap-1.5 text-xs text-stone-500">
										<span class="w-10 shrink-0">非会員</span>
										<select name="nonmember" disabled={!p.hasContent} class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-800">
											<option value="" selected={!p.nonmemberPaymentMethod}>会員と同じ</option>
											{#each Object.entries(METHOD_LABEL) as [v, l] (v)}<option value={v} selected={p.nonmemberPaymentMethod === v}>{l}</option>{/each}
										</select>
									</label>
								</div>
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
										{@const early = p.earlyPrepay && savedEarlyOn ? savedEarlyMax : 0}
										{#if savedPoints}
											{[flat ? `割引 ${flat}%` : '', early ? `最大 +${percentText(early)}%pt` : ''].filter(Boolean).join('＋') || '還元なし'}
										{:else}
											{@const max = Math.max(flat, early)}
											{max ? `最大 ${percentText(max)}%` : '割引なし'}
										{/if}
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
		「最大還元」は保存済みの内容で計算しています。段は予約した日から宿泊初日までの日数で決まり、除外期間の泊は定率割引だけになります。料金・食事・対象客室は RMS で管理しています。
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
					{#each p.paymentChoices as o (o.id)}
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
