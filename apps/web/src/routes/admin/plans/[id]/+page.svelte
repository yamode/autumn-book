<script lang="ts">
	import { enhance } from '$lib/enhance';
	import ContentEditor from '$lib/components/admin/ContentEditor.svelte';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import { formatYen } from '$lib/format';
	import BookingQuestionsEditor from '$lib/components/admin/BookingQuestionsEditor.svelte';
	import type { BookingQuestion, PlanQuestionMode } from '$lib/booking-questions';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import AdminIcon from '$lib/components/admin/AdminIcon.svelte';
	import { qrSvg } from '$lib/qr';
	import { planSaleState, type PlanSaleState } from '$lib/plan-sale';
	import { DOW_LABELS } from '$lib/plan-limits';

	// 販売の状態の表示（販売スイッチ＋販売表示期間。実際の出し分けは DB の book.plan_on_sale）
	const SALE_BADGE: Record<PlanSaleState, { label: string; cls: string }> = {
		on: { label: '販売中', cls: 'bg-emerald-100 text-emerald-800' },
		before: { label: '販売開始前', cls: 'bg-sky-100 text-sky-800' },
		ended: { label: '販売期間終了', cls: 'bg-stone-200 text-stone-700' },
		off: { label: '停止中', cls: 'bg-rose-100 text-rose-800' }
	};
	import { RANK_LABELS_JA, isOpenPlan, planAccessSummaryJa } from '$lib/plan-access';

	let { data, form } = $props();
	let c = $derived(data.content);

	// 支払方法の組み合わせ（保存前の画面上の値・2026-11-02）。予約時決済の割引は「オンライン（予約時）」があるときだけ選べる
	// svelte-ignore state_referenced_locally
	let optsInput = $state<string[]>([...data.content.paymentOptions]);
	const DISCOUNT_STEPS = [0, 3, 5, 7, 10, 15, 20];
	const PAYMENT_OPTIONS = [
		{ value: 'onsite', label: '現地払い', hint: 'チェックアウト時に現地で精算' },
		{ value: 'online_now', label: 'オンライン決済（予約時）', hint: '予約時にカード決済・割引の対象' },
		{ value: 'online_checkout', label: 'オンライン決済（チェックアウト日）', hint: 'カードを登録し、チェックアウト日に請求' }
	] as const;

	// 公開範囲（シークレットプラン・保存前の画面上の値）。予約できる人: 誰でも / 会員 / グレード以上
	// svelte-ignore state_referenced_locally
	const a0 = data.content.access;
	let whoInput = $state<'anyone' | 'members' | 'rank'>(a0.audience === 'public' ? 'anyone' : a0.minRank && a0.minRank !== 'standard' ? 'rank' : 'members');
	let rankInput = $state<string>(a0.minRank && a0.minRank !== 'standard' ? a0.minRank : 'gold');
	let linkOnlyInput = $state(a0.linkOnly);
	// 宿泊不可期間の入力行（何件でも足し引きできる。空の行は保存時に捨てる）
	// svelte-ignore state_referenced_locally
	let blackoutRows = $state(data.content.stayClosed.blackouts.map((b) => ({ ...b })));
	const addBlackoutRow = () => blackoutRows.push({ start: '', end: '' });
	const removeBlackoutRow = (i: number) => blackoutRows.splice(i, 1);
	const WHO_OPTIONS = [
		{ value: 'anyone', label: '誰でも', hint: '会員でなくても予約できる' },
		{ value: 'members', label: '会員だけ', hint: 'ログインした会員なら予約できる' },
		{ value: 'rank', label: 'グレード以上の会員', hint: '指定したグレード以上の会員だけ' }
	] as const;
	const accessSummary = $derived(planAccessSummaryJa(c.access));
	let copied = $state(false);
	async function copyShareUrl() {
		if (!data.shareUrl) return;
		try {
			await navigator.clipboard.writeText(data.shareUrl);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// クリップボードが使えないとき（http・権限なし）は欄を選んでコピーしてもらう
			(document.getElementById('share-url') as HTMLInputElement | null)?.select();
		}
	}

	// 専用URLの QR コード。画面は SVG、ダウンロードは同じ path を canvas に描いて PNG にする
	const qr = $derived(qrSvg(data.shareUrl ?? ''));
	const QR_PNG_PX = 1024; // 余白込みの1辺。印刷にも使える大きさ
	function downloadQrPng() {
		if (!qr.size) return;
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = QR_PNG_PX;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, QR_PNG_PX, QR_PNG_PX);
		ctx.fillStyle = '#000000';
		ctx.scale(QR_PNG_PX / qr.size, QR_PNG_PX / qr.size);
		ctx.fill(new Path2D(qr.path));
		canvas.toBlob((blob) => {
			if (!blob) return;
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = `plan-qr-${c.slug}.png`;
			a.click();
			URL.revokeObjectURL(a.href);
		}, 'image/png');
	}

	// 予約時に聞く項目（保存前の画面上の値）。テンプレートを選んでいなくても、独自の項目は残しておく
	// svelte-ignore state_referenced_locally
	const qs0 = data.live ? data.questionSetting : null;
	let qMode = $state<PlanQuestionMode>(qs0?.mode ?? 'none');
	let qTemplateId = $state<string>(qs0?.templateId ?? '');
	let qOwn = $state<BookingQuestion[]>(structuredClone(qs0?.questions ?? []));
	const qTemplate = $derived(data.live ? data.questionTemplates.find((t) => t.id === qTemplateId) : undefined);
	const Q_MODES = [
		{ value: 'none', label: 'なし', hint: '追加の項目は聞かない' },
		{ value: 'template', label: 'テンプレートを使う', hint: 'テンプレートを直すと、選んだ全プランが変わる' },
		{ value: 'custom', label: 'プラン独自に決める', hint: 'このプランだけの項目' }
	] as const;

	// ---- ここから下はデモ環境だけで使う（決済設定・翻訳はまだデモストアにしか繋がっていない）
	// 翻訳タブ
	let translationLocale = $state<'en' | 'zh-TW'>('en');
	let trDescription = $state('');
	$effect(() => {
		const tr = data.demo?.translations[translationLocale];
		trDescription = (tr?.fields?.description as string) ?? '';
	});
</script>

<svelte:head><title>プラン編集 ｜ 山人管理</title></svelte:head>

<p class="mb-2 text-xs text-stone-500"><a href="/admin/plans" class="hover:underline">← プラン一覧</a></p>

<PageHeader title={c.name} description={c.code || c.slug}>
	{#snippet actions()}
		{#if data.previewBase && c.slug}
			<!-- 未公開・料金なしでも、販売ページの見た目を確かめられる（スタッフだけ。予約はできない） -->
			<a href={`${data.previewBase}/plans/${c.slug}?preview=1`} target="_blank" class="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 hover:bg-stone-50">販売ページをプレビュー <AdminIcon name="external" class="h-4 w-4" /></a>
		{/if}
		{#if data.previewBase && c.slug && c.isPublished}
			<!-- シークレットプランは一覧から見えないので、専用 URL で開く（URL を開いた扱いになる） -->
			<a href={!isOpenPlan(c.access) && data.shareUrl ? data.shareUrl : `${data.previewBase}/plans/${c.slug}`} target="_blank" class="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 hover:bg-stone-50">公開ページを開く <AdminIcon name="external" class="h-4 w-4" /></a>
		{/if}
	{/snippet}
</PageHeader>
{#if c.rmsState === 'awaiting'}
	<!-- Book で先に作ったプラン: 料金は rms のプランテンプレートを紐づけたときに入る -->
	<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
		<strong class="font-medium">料金待ち：</strong>このプランは Book で先に作りました。紹介文・写真・支払方法・公開範囲はここで設定できます。
		料金・在庫・客室は、rms でプランを作り「Book のプランに紐づける」と入ります（最長3時間で反映）。紐づけるまでは、公開しても予約できません。
	</p>
{:else if !c.isActive || !c.publicOnDirect}
	<p class="-mt-3 mb-4 inline-block rounded-full bg-rose-50 px-2.5 py-0.5 text-xs text-rose-700">rms で直販対象外（公開しても表示されません）</p>
{/if}

{#if data.namesError}
	<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{data.namesError}</p>
{/if}
{#if (form as { message?: string } | null)?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(form as { message?: string }).message}</p>{/if}

{#if data.demo}
	{@const d = data.demo}
	{@const p = d.plan}
	<!-- Step 1: 料金プラン（rms 管理・読み取り専用） -->
	<section class="rounded-xl border border-stone-200 bg-white p-5">
		<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<h2 class="text-sm font-bold text-stone-700">Step 1 ─ 料金プラン（rms で管理）</h2>
			<span class="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-500">読み取り専用</span>
		</div>
		<dl class="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
			<div class="flex gap-2"><dt class="text-stone-400">プラン名</dt><dd class="font-medium">{p.name}</dd></div>
			<div class="flex gap-2"><dt class="text-stone-400">基準料金</dt><dd>{formatYen(p.basePrice)} / 大人1名あたり（平日）</dd></div>
			<div class="flex gap-2"><dt class="text-stone-400">食事</dt><dd>{p.mealPlan}</dd></div>
			<div class="flex gap-2"><dt class="text-stone-400">支払</dt><dd>下の「決済設定」を参照</dd></div>
			<div class="flex gap-2"><dt class="text-stone-400">対象客室</dt><dd>{d.rooms.join(' / ')}</dd></div>
			<div class="col-span-full flex gap-2"><dt class="shrink-0 text-stone-400">キャンセル規定</dt><dd class="text-xs text-stone-600">{p.cancellationPolicy.note}</dd></div>
		</dl>
		<p class="mt-3 text-xs text-stone-400">料金・在庫・規定の変更は rms（料金管理）で行ってください。</p>
	</section>
{/if}

<!-- 販売（いちばん上）: 販売スイッチと販売表示期間。紹介文の保存とは別に保存する（古い画面から保存しても戻らないように） -->
{#if data.live}
	{@const sale = planSaleState(c.isPublished, c.bookingStart, c.bookingEnd)}
	<form method="POST" action="?/setSale" use:enhance={() => async ({ update }) => update({ reset: false })} class="rounded-xl border-2 bg-white p-5 {sale === 'on' ? 'border-emerald-300' : 'border-stone-200'}">
		<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<h2 class="text-sm font-bold text-stone-700">
				販売
				<span class="ml-1 rounded-full px-2 py-0.5 text-xs font-normal {SALE_BADGE[sale].cls}">{SALE_BADGE[sale].label}</span>
				{#if sale === 'before' && c.bookingStart}<span class="ml-1 text-xs font-normal text-stone-500">{c.bookingStart.replaceAll('-', '/')} から販売</span>{/if}
			</h2>
			{#if (form as { saleSaved?: boolean } | null)?.saleSaved}<span class="text-xs text-emerald-600">保存しました</span>{/if}
		</div>
		{#if (form as { saleError?: string } | null)?.saleError}
			<p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(form as { saleError?: string }).saleError}</p>
		{/if}
		<label class="mt-3 flex cursor-pointer items-center gap-3 text-sm text-stone-800">
			<input type="checkbox" name="on_sale" checked={c.isPublished} class="peer sr-only" />
			<span class="relative h-6 w-11 shrink-0 rounded-full bg-stone-300 transition peer-checked:bg-emerald-600 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" aria-hidden="true"></span>
			<span class="font-medium">公式サイトで販売する</span>
			<span class="text-xs text-stone-500">オフ＝停止中（一覧・プラン詳細・専用URLのどれからも予約できない）</span>
		</label>
		<p class="mt-4 text-xs font-medium text-stone-600">販売表示期間（予約を受け付ける期間）</p>
		<div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-700">
			<input type="date" name="booking_start" value={c.bookingStart ?? ''} class="rounded-md border border-stone-300 px-2 py-1.5 text-sm" aria-label="販売表示期間の開始日" />
			〜
			<input type="date" name="booking_end" value={c.bookingEnd ?? ''} class="rounded-md border border-stone-300 px-2 py-1.5 text-sm" aria-label="販売表示期間の終了日" />
		</div>
		<p class="mt-1 text-xs text-stone-400">日本時間で、開始日の 0:00 から終了日の 23:59 まで、プランを表示して予約を受け付けます。空欄は制限なし。泊まれる日の範囲は、下の「宿泊可能期間」で決めます。</p>
		<button type="submit" class="mt-3 rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">販売の設定を保存</button>
	</form>
{/if}

<!-- 公開範囲（シークレットプラン）と専用 URL。特別会員の専用ページ・取引先ページとは別で、公式サイトの会員制度の中で完結する -->
<form method="POST" action="?/setAccess" use:enhance={() => async ({ update }) => update({ reset: false })} class="mt-2 rounded-xl border border-stone-200 bg-white p-5">
	<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
		<h2 class="text-sm font-bold text-stone-700">
			公開範囲
			{#if accessSummary}<span class="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-normal text-amber-800">シークレット：{accessSummary}</span>{/if}
		</h2>
		{#if (form as { accessSaved?: boolean } | null)?.accessSaved}<span class="text-xs text-emerald-600">保存しました</span>{/if}
	</div>
	{#if (form as { accessError?: string } | null)?.accessError}
		<p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(form as { accessError?: string }).accessError}</p>
	{/if}
	<p class="mt-1 text-xs text-stone-500">予約できる人</p>
	<div class="mt-1 grid gap-2 sm:grid-cols-3">
		{#each WHO_OPTIONS as o (o.value)}
			<label class="flex cursor-pointer gap-2 rounded-lg border border-stone-200 p-3 text-sm has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50">
				<input type="radio" name="who" value={o.value} bind:group={whoInput} class="mt-0.5 h-4 w-4" />
				<span>
					<span class="font-medium text-stone-800">{o.label}</span>
					<span class="mt-0.5 block text-xs text-stone-500">{o.hint}</span>
				</span>
			</label>
		{/each}
	</div>
	{#if whoInput === 'rank'}
		<label class="mt-3 flex flex-wrap items-center gap-2 text-sm text-stone-700">
			<select name="min_rank" bind:value={rankInput} class="rounded-md border border-stone-300 px-2 py-1.5 text-sm">
				{#each data.ranks.filter((r) => r !== 'standard') as r (r)}
					<option value={r}>{RANK_LABELS_JA[r]}</option>
				{/each}
			</select>
			以上の会員
		</label>
	{/if}
	<label class="mt-3 flex cursor-pointer items-start gap-2 text-sm text-stone-700">
		<input type="checkbox" name="link_only" bind:checked={linkOnlyInput} class="mt-0.5 h-4 w-4" />
		<span>
			プラン一覧・検索に出さない（専用URLを知っている人だけ）
			<span class="mt-0.5 block text-xs text-stone-500">
				{#if whoInput === 'anyone'}URL を開けば、会員でなくても予約できます。{:else}URL を開いたうえで、上の条件に合う会員だけが予約できます。{/if}
				オフのときは、{whoInput === 'anyone' ? '普通のプランとして一覧に出ます' : '条件に合う会員にだけ一覧に出ます（ほかの方には出ません）'}。
			</span>
		</span>
	</label>
	<p class="mt-3 text-xs text-stone-400">
		シークレットプランは、検索結果・空室カレンダーの最安料金・アプリ（yamado-one）の予約には出ません。
		会員限定のプランをログインしていない方が URL から開くと、料金は出さずに「ログイン・会員登録」の案内を出します。
	</p>
	<button type="submit" class="mt-3 rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">公開範囲を保存</button>
</form>

<!-- 絞り込み（販売期間・人数・部屋タイプ）。料金はテンプレートと共有し、このプランでは狭めるだけ -->
{#if data.live}
	<form method="POST" action="?/setLimits" use:enhance={() => async ({ update }) => update({ reset: false })} class="mt-2 rounded-xl border border-stone-200 bg-white p-5">
		<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<h2 class="text-sm font-bold text-stone-700">絞り込み（宿泊可能期間・人数・部屋タイプ）</h2>
			{#if (form as { limitsSaved?: boolean } | null)?.limitsSaved}<span class="text-xs text-emerald-600">保存しました</span>{/if}
		</div>
		{#if (form as { limitsError?: string } | null)?.limitsError}
			<p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(form as { limitsError?: string }).limitsError}</p>
		{/if}
		<p class="mt-1 text-xs text-stone-500">料金は rms の料金テンプレートと共有し、このプランでは販売する範囲を狭めるだけです（広げることはできません）。空欄は制限なし（テンプレート・料金式どおり）です。</p>

		<p class="mt-3 text-xs font-medium text-stone-600">宿泊可能期間</p>
		<div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-700">
			<input type="date" name="sales_start" value={c.limits.salesStart ?? ''} class="rounded-md border border-stone-300 px-2 py-1.5 text-sm" aria-label="宿泊可能期間の開始日" />
			〜
			<input type="date" name="sales_end" value={c.limits.salesEnd ?? ''} class="rounded-md border border-stone-300 px-2 py-1.5 text-sm" aria-label="宿泊可能期間の終了日" />
		</div>
		<p class="mt-1 text-xs text-stone-400">泊まれる日の範囲です。予約を受け付ける期間は、上の「販売」の販売表示期間で決めます。</p>

		<p class="mt-3 text-xs font-medium text-stone-600">宿泊不可期間</p>
		{#if blackoutRows.length}
			<ul class="mt-1 space-y-1.5">
				{#each blackoutRows as row, i (i)}
					<li class="flex flex-wrap items-center gap-2 text-sm text-stone-700">
						<input type="date" name="blackout_start" bind:value={row.start} class="rounded-md border border-stone-300 px-2 py-1.5 text-sm" aria-label="宿泊不可期間{i + 1}の開始日" />
						〜
						<input type="date" name="blackout_end" bind:value={row.end} min={row.start || undefined} class="rounded-md border border-stone-300 px-2 py-1.5 text-sm" aria-label="宿泊不可期間{i + 1}の終了日" />
						<button type="button" onclick={() => removeBlackoutRow(i)} class="rounded-md px-2 py-1 text-xs text-red-700 hover:bg-red-50">削除</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-1 text-xs text-stone-400">設定なし</p>
		{/if}
		<button type="button" onclick={addBlackoutRow} class="mt-1.5 rounded-md border border-stone-300 px-3 py-1 text-xs text-stone-700 hover:bg-stone-50">＋ 期間を追加</button>
		<p class="mt-1 text-xs text-stone-400">この期間に泊まる日は、検索・空室カレンダー・予約で選べなくなります（開始日・終了日の両日とも不可）。例: 12/29〜1/3。1日だけなら開始日だけ入れても構いません。</p>

		<p class="mt-3 text-xs font-medium text-stone-600">宿泊不可の曜日</p>
		<div class="mt-1 flex flex-wrap gap-3">
			{#each DOW_LABELS as label, d (d)}
				<label class="flex cursor-pointer items-center gap-1.5 text-sm text-stone-700">
					<input type="checkbox" name="closed_dows" value={d} checked={c.stayClosed.dows.includes(d)} class="h-4 w-4" />
					{label}
				</label>
			{/each}
		</div>
		<p class="mt-1 text-xs text-stone-400">チェックした曜日に泊まる日は選べなくなります（チェックアウト日ではなく、宿泊する日の曜日です）。</p>

		<p class="mt-3 text-xs font-medium text-stone-600">ご利用人数（1部屋あたり）</p>
		<div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-700">
			最小
			<select name="min_guests" class="rounded-md border border-stone-300 px-2 py-1.5 text-sm">
				<option value="" selected={c.limits.minGuests == null}>指定なし</option>
				{#each [1, 2, 3, 4, 5, 6] as n (n)}<option value={n} selected={c.limits.minGuests === n}>{n}名</option>{/each}
			</select>
			最大
			<select name="max_guests" class="rounded-md border border-stone-300 px-2 py-1.5 text-sm">
				<option value="" selected={c.limits.maxGuests == null}>指定なし</option>
				{#each [1, 2, 3, 4, 5, 6] as n (n)}<option value={n} selected={c.limits.maxGuests === n}>{n}名</option>{/each}
			</select>
		</div>

		<p class="mt-3 text-xs font-medium text-stone-600">対象の部屋タイプ</p>
		{#if data.limitRooms.length}
			<div class="mt-1 grid gap-1 sm:grid-cols-2">
				{#each data.limitRooms as r (r.id)}
					<label class="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
						<input type="checkbox" name="room_type_ids" value={r.id} checked={c.limits.roomTypeIds.includes(r.id)} class="h-4 w-4" />
						{r.name}{#if !r.isActive}<span class="text-xs text-stone-400">（停止中）</span>{/if}
					</label>
				{/each}
			</div>
			<p class="mt-1 text-xs text-stone-400">1つも選ばないと、料金式が対応するすべての客室が対象です。</p>
		{:else}
			<p class="mt-1 text-xs text-stone-400">部屋タイプを読めませんでした。再読み込みしてください。</p>
		{/if}

		<p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
			保存した内容は、日別料金への反映に最大3時間かかります（同期のあとに販売ページへ反映されます）。宿泊不可の期間・曜日は保存した時点で選べなくなり、外した日は数分で戻ります。
		</p>
		<button type="submit" class="mt-3 rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">絞り込みを保存</button>
	</form>
{/if}

<!-- 専用 URL（/plan/<token>）。どのプランにも 1 本あり、作り直すと古い URL は使えなくなる -->
<section class="mt-2 rounded-xl border border-stone-200 bg-white p-5">
	<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
		<h2 class="text-sm font-bold text-stone-700">このプランの専用URL</h2>
		{#if (form as { linkRotated?: boolean } | null)?.linkRotated}<span class="text-xs text-emerald-600">作り直しました（古いURLは使えません）</span>{/if}
	</div>
	{#if data.shareUrl}
		<div class="mt-2 flex flex-col gap-2 sm:flex-row">
			<input id="share-url" type="text" readonly value={data.shareUrl} onfocus={(e) => e.currentTarget.select()} class="min-w-0 flex-1 rounded-md border border-stone-300 bg-stone-50 px-3 py-2 font-mono text-xs text-stone-700" />
			<button type="button" onclick={copyShareUrl} class="shrink-0 rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white hover:bg-accent-500">{copied ? 'コピーしました' : 'URLをコピー'}</button>
		</div>
		<p class="mt-2 text-xs text-stone-500">
			メール・SNS・会員向けのご案内に貼って使います。開いた端末では、一覧に出さないプランも見られて予約できるようになります（会員限定の条件はそのまま）。
		</p>
		<div class="mt-3 flex items-center gap-4">
			<svg viewBox="0 0 {qr.size} {qr.size}" class="h-32 w-32 shrink-0 rounded-md border border-stone-200 bg-white" role="img" aria-label="専用URLのQRコード" shape-rendering="crispEdges"><path d={qr.path} fill="#000" /></svg>
			<div>
				<button type="button" onclick={downloadQrPng} class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">QRコードをダウンロード（PNG）</button>
				<p class="mt-2 text-xs text-stone-500">チラシ・ポップに載せる用です。URLを作り直すと古いQRは使えなくなります。</p>
			</div>
		</div>
		<form method="POST" action="?/rotateLink" use:enhance class="mt-2" onsubmit={(e) => { if (!confirm('専用URLを作り直しますか？今のURLと、それで開いた端末では見られなくなります。')) e.preventDefault(); }}>
			<button type="submit" class="text-xs text-stone-500 underline underline-offset-4 hover:text-stone-700">URLを作り直す（漏れたとき・配布を終えるとき）</button>
		</form>
	{:else}
		<p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">専用URLを読めませんでした。再読み込みしてください。</p>
	{/if}
</section>

{#if data.live}
	<!-- お食事（book.plan_contents.meals）。朝食の有無と、夕食は RMS のどの食事コースか。公式サイトのプラン詳細に「朝食付き」「夕食付き ○○コース」と出る。
	     料金（rms の食事区分）は変えない。未設定のプランは料金テンプレートから推定した値を初期値に出す -->
	<form method="POST" action="?/setMeals" use:enhance={() => async ({ update }) => update({ reset: false })} class="mt-2 rounded-xl border border-stone-200 bg-white p-5">
		<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<h2 class="text-sm font-bold text-stone-700">お食事</h2>
			{#if (form as { mealsSaved?: boolean } | null)?.mealsSaved}<span class="text-xs text-emerald-600">保存しました</span>{/if}
		</div>
		{#if (form as { mealsError?: string } | null)?.mealsError}
			<p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(form as { mealsError?: string }).mealsError}</p>
		{/if}
		{#if !c.meals}
			<p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">まだ設定していません（料金テンプレート{c.mealPlan ? `「${c.mealPlan}」` : ''}から推定した値を出しています）。確かめて保存してください。</p>
		{/if}
		<div class="mt-3 grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-x-6">
			<label class="inline-flex cursor-pointer items-center gap-2 text-sm text-stone-800">
				<input type="checkbox" name="breakfast" checked={data.mealsForm.breakfast} class="h-4 w-4 rounded" />
				朝食付き
			</label>
			<label class="flex flex-wrap items-center gap-2 text-sm text-stone-800">
				夕食
				<select name="dinner" class="min-w-48 rounded-md border border-stone-300 px-2 py-1.5 text-sm">
					<option value="" selected={!data.mealsForm.dinnerRateId}>夕食なし</option>
					{#each data.dinnerCourses as dc (dc.id)}
						<option value={dc.id} selected={data.mealsForm.dinnerRateId === dc.id}>{dc.name}{dc.description ? `（${dc.description}）` : ''}</option>
					{/each}
				</select>
			</label>
		</div>
		{#if data.dinnerCourses.length === 0}
			<p class="mt-2 text-xs text-amber-800">RMS の食事コース（夕食）を読めませんでした。RMS の「食事料金」に夕食のコースがあるか確かめてください。</p>
		{/if}
		<p class="mt-3 text-xs text-stone-400">夕食のコースは RMS の食事料金（夕食）から選びます。公式サイトのプラン詳細に「朝食付き」「夕食付き」とコース名を出します。料金は変わりません。</p>
		<button type="submit" class="mt-3 rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">お食事を保存</button>
	</form>

	<!-- 支払方法（本番）。book.plan_contents.payment_options（組み合わせ）を Book で決める。rate_plans.payment_method は DB が3択に変換して書く -->
	<form method="POST" action="?/setPaymentMethod" use:enhance class="mt-2 rounded-xl border border-stone-200 bg-white p-5">
		<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<h2 class="text-sm font-bold text-stone-700">支払方法</h2>
			{#if form?.paymentSaved}<span class="text-xs text-emerald-600">保存しました</span>{/if}
		</div>
		{#if (form as { paymentError?: string } | null)?.paymentError}
			<p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(form as { paymentError?: string }).paymentError}</p>
		{/if}
		<p class="mt-2 text-xs text-stone-500">お客様に出す支払方法を選びます（複数可）。施設全体のオン/オフ・非会員の支払方法・文言は <a href="/admin/payments" class="text-sky-700 hover:underline">支払方法</a> の画面で設定します。</p>
		<div class="mt-3 grid gap-2 sm:grid-cols-3">
			{#each PAYMENT_OPTIONS as o}
				<label class="flex cursor-pointer gap-2 rounded-lg border p-3 text-sm has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 border-stone-200">
					<input type="checkbox" name="opt" value={o.value} bind:group={optsInput} class="mt-0.5 h-4 w-4" />
					<span>
						<span class="font-medium text-stone-800">{o.label}</span>
						<span class="mt-0.5 block text-xs text-stone-500">{o.hint}</span>
					</span>
				</label>
			{/each}
		</div>
		{#if optsInput.includes('online_now')}
			<label class="mt-3 flex flex-wrap items-center gap-2 text-sm text-stone-700">
				予約時決済の割引
				<select name="discount" class="rounded-md border border-stone-300 px-2 py-1.5 text-sm">
					{#each DISCOUNT_STEPS as d (d)}
						<option value={d} selected={Math.round(c.prepayDiscountRate * 100) === d}>{d === 0 ? '割引なし' : `${d}% OFF`}</option>
					{/each}
				</select>
				<span class="text-xs text-stone-500">オンラインのカード決済を選んだお客様だけ、請求額から割り引きます（予約金額・キャンセル料の基準は割引前のまま）。</span>
			</label>
		{/if}
		<p class="mt-3 text-xs text-stone-400">
			現地払いでは、予約確認画面でお客様が現金・クレジットカード・PayPay から選びます（PMS の備考に申し送り）。
			オンライン決済が使えない状態のときは、オンライン決済のみのプランも現地払いで受け付けます。
		</p>
		<button type="submit" class="mt-3 rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">支払方法を保存</button>
	</form>
{/if}

{#if data.live}
	<!-- 予約時に聞く項目（book.plan_contents.question_mode）。公式サイト・取引先ページの予約で聞き、回答は PMS の予約備考に入る -->
	<form method="POST" action="?/setQuestions" use:enhance={() => async ({ update }) => update({ reset: false })} class="mt-4 rounded-xl border border-stone-200 bg-white p-5">
		<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<h2 class="text-sm font-bold text-stone-700">予約時に聞く項目</h2>
			{#if (form as { questionSaved?: boolean } | null)?.questionSaved}<span class="text-xs text-emerald-600">保存しました</span>{/if}
		</div>
		{#if (form as { questionError?: string } | null)?.questionError}
			<p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(form as { questionError?: string }).questionError}</p>
		{/if}
		{#if !data.questionSetting}
			<p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">いまの設定を読めませんでした（DB の更新がまだの可能性があります）。</p>
		{/if}
		<input type="hidden" name="questions" value={JSON.stringify(qOwn)} />
		<div class="mt-3 grid gap-2 sm:grid-cols-3">
			{#each Q_MODES as o}
				<label class="flex cursor-pointer gap-2 rounded-lg border p-3 text-sm has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 border-stone-200">
					<input type="radio" name="mode" value={o.value} bind:group={qMode} class="mt-0.5 h-4 w-4" />
					<span>
						<span class="font-medium text-stone-800">{o.label}</span>
						<span class="mt-0.5 block text-xs text-stone-500">{o.hint}</span>
					</span>
				</label>
			{/each}
		</div>
		{#if qMode === 'template'}
			<div class="mt-3">
				{#if data.questionTemplates.length}
					<select name="template_id" bind:value={qTemplateId} class="rounded-md border border-stone-300 px-2 py-1.5 text-sm">
						<option value="">テンプレートを選ぶ</option>
						{#each data.questionTemplates as t (t.id)}<option value={t.id}>{t.name}（{t.questions.length}項目）</option>{/each}
					</select>
					{#if qTemplate}
						<ul class="mt-2 list-disc pl-5 text-xs text-stone-600">
							{#each qTemplate.questions as q (q.id)}
								<li>{q.label}{q.type === 'select' ? `（${q.choices.join('・')}）` : q.type === 'text' ? '（自由入力）' : '（チェック）'}{q.required ? '・必須' : ''}{q.scope === 'room' ? '・部屋ごと' : ''}</li>
							{:else}<li>項目がありません</li>{/each}
						</ul>
					{/if}
				{:else}
					<input type="hidden" name="template_id" value="" />
					<p class="text-xs text-stone-500">まだテンプレートがありません。</p>
				{/if}
				<a href="/admin/booking-questions" class="mt-2 inline-block text-xs text-brand-700 underline">テンプレートを作る・直す →</a>
			</div>
		{:else}
			<input type="hidden" name="template_id" value={qTemplateId} />
		{/if}
		{#if qMode === 'custom'}
			<div class="mt-3"><BookingQuestionsEditor bind:questions={qOwn} transportChoices={data.transportField?.choices} transportLabel={data.transportField?.label} /></div>
		{/if}
		<label class="mt-4 flex items-start gap-2 rounded-lg border border-stone-200 p-3 text-sm">
			<input type="checkbox" name="ask_gender" checked={qs0?.askGender ?? true} class="mt-0.5 h-4 w-4" />
			<span>
				<span class="font-medium text-stone-800">部屋ごとの男女の内訳を聞く</span>
				<span class="mt-0.5 block text-xs text-stone-500">必須。男性と女性の合計がその部屋の大人の人数と合わないと予約できません。PMS の部屋別の男女の人数に入ります。上の「なし」を選んでいても聞きます。</span>
			</span>
		</label>
		<p class="mt-3 text-xs text-stone-400">
			公式サイトと取引先ページの予約で聞き、回答は PMS の予約備考に入ります。取引先ごとに足す項目は、取引先の設定で決めます。
			宿泊者名・人数・電話・メール・到着予定・備考は、ここで足さなくても毎回聞きます。「部屋ごと」の項目は、複数室の予約で部屋の数だけ聞きます。
		</p>
		<button type="submit" class="mt-3 rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">予約時に聞く項目を保存</button>
	</form>
{/if}

<h2 class="mb-2 mt-6 text-sm font-bold text-stone-700">見せ方をつくる（公開コンテンツ）</h2>
{#key c.updatedAt}
	<ContentEditor
		initial={c}
		kind="plan"
		live={data.live}
		tagsLabel="タグ（「、」区切り — 一覧の絞り込みチップになります）"
		tagsPlaceholder="露天風呂付、記念日、一人旅"
		showSortOrder
		markdown
		photoFallback="meal"
		templates={data.live ? data.templates : []}
	/>
{/key}

{#if data.demo}
	{@const d = data.demo}
	{@const p = d.plan}
	<!-- 決済設定（現地払い / 事前決済=即時決済 / PayPay / 事前割引 最大20%） -->
	<form method="POST" action="?/savePayment" use:enhance class="mt-6 space-y-4 rounded-xl border border-stone-200 bg-white p-5">
		<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<h2 class="text-sm font-bold text-stone-700">決済設定 <span class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-normal text-amber-800">デモ専用（メモリ上のみ）</span></h2>
			{#if form?.paymentSaved}<span class="text-xs text-emerald-600">保存しました</span>{/if}
		</div>
		{#if (form as { paymentError?: string } | null)?.paymentError}<p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(form as { paymentError?: string }).paymentError}</p>{/if}

		<div class="grid gap-4 sm:grid-cols-2">
			<fieldset class="rounded-lg border border-stone-200 p-3 text-sm">
				<legend class="px-1 text-xs text-stone-500">受け付ける支払い方法</legend>
				<label class="flex items-center gap-2 py-1">
					<input type="checkbox" name="onsite" checked={p.payment.onsite} class="h-4 w-4" />
					現地払い（チェックアウト時）
				</label>
				<label class="flex items-center gap-2 py-1">
					<input type="checkbox" name="prepay" checked={p.payment.prepay} class="h-4 w-4" />
					事前決済 <span class="text-xs text-stone-400">— ご予約時の即時決済（宿泊後請求ではない）</span>
				</label>
				<div class="ml-6 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
					<label class="flex items-center gap-1.5">
						<input type="checkbox" name="m_card" checked={p.payment.prepayMethods.includes('card')} class="h-3.5 w-3.5" /> クレジットカード
					</label>
					<label class="flex items-center gap-1.5">
						<input type="checkbox" name="m_paypay" checked={p.payment.prepayMethods.includes('paypay')} class="h-3.5 w-3.5" />
						<span class="rounded bg-[#ff0033] px-1 py-0.5 text-[10px] font-bold text-white">PayPay</span>
					</label>
				</div>
			</fieldset>

			<fieldset class="rounded-lg border border-stone-200 p-3 text-sm">
				<legend class="px-1 text-xs text-stone-500">事前決済割引（上限 20%）</legend>
				<select name="discount" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2">
					{#each [0, 5, 10, 15, 20] as d}
						<option value={d} selected={Math.round(p.payment.prepayDiscountRate * 100) === d}>
							{d === 0 ? '割引なし' : `${d}% OFF`}
						</option>
					{/each}
				</select>
				<p class="mt-2 text-xs text-stone-400">
					事前決済を選んだお客様の宿泊料金から自動で割引されます（現地払いは定価）。直販ベストレートの訴求軸になります。
				</p>
			</fieldset>
		</div>
		<button type="submit" class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">決済設定を保存</button>
	</form>

	<!-- 翻訳（i18n フェーズ2） -->
	<section class="mt-6 rounded-xl border border-stone-200 bg-white p-5">
		<h2 class="mb-3 text-sm font-bold text-stone-700">翻訳（コンテンツ多言語化） <span class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-normal text-amber-800">デモ専用（メモリ上のみ）</span></h2>
		<p class="mb-3 text-xs text-stone-400">en / zh-TW の翻訳を入力・公開すると顧客画面に反映されます。未入力フィールドは日本語がフォールバック表示されます。</p>

		<div class="mb-4 flex flex-wrap gap-2">
			{#each (['en', 'zh-TW'] as const) as loc}
				<button
					type="button"
					onclick={() => { translationLocale = loc; }}
					class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {translationLocale === loc ? 'bg-brand-800 text-white' : 'border border-stone-300 bg-white text-stone-600 hover:bg-stone-50'}"
				>{loc === 'en' ? 'English (en)' : '繁體中文 (zh-TW)'}</button>
			{/each}
		</div>

		{#if form?.translationSaved}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">翻訳を保存しました（{translationLocale}）。</p>{/if}

		<form method="POST" action="?/saveTranslation" use:enhance class="space-y-4">
			<input type="hidden" name="locale" value={translationLocale} />

			<div class="grid gap-4 lg:grid-cols-2">
				<div class="space-y-3">
					<p class="text-xs font-medium text-stone-500">日本語（原文・参照用）</p>
					<div class="text-sm">
						<p class="text-xs text-stone-400">headline</p>
						<p class="mt-1 rounded bg-stone-50 px-3 py-2 text-stone-700">{p.headline}</p>
					</div>
					<div class="text-sm">
						<p class="text-xs text-stone-400">highlightTags</p>
						<p class="mt-1 rounded bg-stone-50 px-3 py-2 text-stone-700">{p.highlightTags.join('、')}</p>
					</div>
					<div class="text-sm">
						<p class="text-xs text-stone-400">description（Markdown）</p>
						<pre class="mt-1 overflow-auto rounded bg-stone-50 px-3 py-2 text-xs text-stone-600 whitespace-pre-wrap max-h-40">{p.description}</pre>
					</div>
				</div>

				<div class="space-y-3">
					<p class="text-xs font-medium text-stone-500">{translationLocale === 'en' ? 'English' : '繁體中文'}（翻訳入力）</p>
					<label class="block text-sm">
						<span class="text-xs text-stone-400">headline</span>
						<input
							name="headline"
							value={d.translations[translationLocale]?.fields?.headline ?? ''}
							class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
							placeholder="翻訳を入力（空白は日本語で表示）"
						/>
					</label>
					<label class="block text-sm">
						<span class="text-xs text-stone-400">highlightTags（カンマ区切り）</span>
						<input
							name="tags"
							value={(d.translations[translationLocale]?.fields?.highlightTags as string[] | undefined)?.join(', ') ?? ''}
							class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
							placeholder="Onsen, Private dining, ..."
						/>
					</label>
					<div class="text-sm">
						<span class="text-xs text-stone-400">description（Markdown）</span>
						<div class="mt-1">
							<MarkdownEditor bind:value={trDescription} name="description" rows={10} photos={[...p.photos, ...d.facility.photos]} />
						</div>
					</div>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-4 border-t border-stone-100 pt-4">
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" name="isPublished" checked={d.translations[translationLocale]?.isPublished ?? false} class="h-4 w-4" />
					<span>公開する（顧客画面に反映）</span>
				</label>
				<button type="submit" class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">翻訳を保存</button>
			</div>
		</form>
	</section>
{:else}
	<p class="mt-6 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-500">
		決済設定・翻訳はまだ実データに繋がっていないため、この環境では表示していません（決済方法は rms 側で設定します）。
	</p>
{/if}
