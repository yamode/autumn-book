<script lang="ts">
	import { enhance } from '$app/forms';
	import ContentEditor from '$lib/components/admin/ContentEditor.svelte';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import { formatYen } from '$lib/format';
	import BookingQuestionsEditor from '$lib/components/admin/BookingQuestionsEditor.svelte';
	import type { BookingQuestion, PlanQuestionMode } from '$lib/booking-questions';

	let { data, form } = $props();
	let c = $derived(data.content);

	// 支払方法の選択（保存前の画面上の値）。予約時決済の割引は事前決済があるときだけ選べる
	// svelte-ignore state_referenced_locally
	let methodInput = $state<string | null>(data.content.paymentMethod);
	const DISCOUNT_STEPS = [0, 3, 5, 7, 10, 15, 20];
	const PAYMENT_OPTIONS = [
		{ value: 'onsite', label: '現地払いのみ', hint: 'チェックアウト時に現地で精算' },
		{ value: 'prepayment', label: '事前決済のみ', hint: '予約時にオンラインでカード決済' },
		{ value: 'deposit', label: 'どちらも選べる', hint: 'お客様が事前決済か現地払いを選ぶ' }
	] as const;

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

<nav class="mb-3 text-xs text-stone-400"><a href="/admin/plans" class="hover:underline">プラン</a> / {c.name}</nav>

<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-lg font-bold text-stone-800">{c.name}</h1>
		<p class="text-xs text-stone-400">
			{c.code || c.slug}
			{#if !c.isActive || !c.publicOnDirect}<span class="text-rose-600">・rms で直販対象外（公開しても表示されません）</span>{/if}
		</p>
	</div>
	{#if data.previewBase && c.slug && c.isPublished}
		<a href="{data.previewBase}/plans/{c.slug}" target="_blank" class="rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50">公開ページを開く ↗</a>
	{/if}
</div>

{#if data.namesError}
	<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{data.namesError}</p>
{/if}
{#if (form as { message?: string } | null)?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(form as { message?: string }).message}</p>{/if}

{#if data.demo}
	{@const d = data.demo}
	{@const p = d.plan}
	<!-- Step 1: 料金プラン（rms 管理・読み取り専用） -->
	<section class="rounded-xl border border-stone-200 bg-white p-5">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-bold text-stone-700">Step 1 ─ 料金プラン（rms で管理）</h2>
			<span class="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-500">読み取り専用</span>
		</div>
		<dl class="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
			<div class="flex gap-2"><dt class="text-stone-400">プラン名</dt><dd class="font-medium">{p.name}</dd></div>
			<div class="flex gap-2"><dt class="text-stone-400">基準料金</dt><dd>{formatYen(p.basePrice)} / 大人1名1泊（平日）</dd></div>
			<div class="flex gap-2"><dt class="text-stone-400">食事</dt><dd>{p.mealPlan}</dd></div>
			<div class="flex gap-2"><dt class="text-stone-400">支払</dt><dd>下の「決済設定」を参照</dd></div>
			<div class="flex gap-2"><dt class="text-stone-400">対象客室</dt><dd>{d.rooms.join(' / ')}</dd></div>
			<div class="col-span-full flex gap-2"><dt class="shrink-0 text-stone-400">キャンセル規定</dt><dd class="text-xs text-stone-600">{p.cancellationPolicy.note}</dd></div>
		</dl>
		<p class="mt-3 text-xs text-stone-400">料金・在庫・規定の変更は rms（料金管理）で行ってください。</p>
	</section>
{/if}

{#if data.live}
	<!-- 支払方法（本番）。booking.rate_plans.payment_method を Book で決める（rms 同期は上書きしない） -->
	<form method="POST" action="?/setPaymentMethod" use:enhance class="mt-2 rounded-xl border border-stone-200 bg-white p-5">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-bold text-stone-700">支払方法</h2>
			{#if form?.paymentSaved}<span class="text-xs text-emerald-600">✔ 保存しました</span>{/if}
		</div>
		{#if (form as { paymentError?: string } | null)?.paymentError}
			<p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(form as { paymentError?: string }).paymentError}</p>
		{/if}
		{#if c.paymentMethod === null}
			<p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">現在の支払方法を読めませんでした。選んで保存すると設定されます。</p>
		{/if}
		<div class="mt-3 grid gap-2 sm:grid-cols-3">
			{#each PAYMENT_OPTIONS as o}
				<label class="flex cursor-pointer gap-2 rounded-lg border p-3 text-sm has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 border-stone-200">
					<input type="radio" name="method" value={o.value} bind:group={methodInput} class="mt-0.5 h-4 w-4" />
					<span>
						<span class="font-medium text-stone-800">{o.label}</span>
						<span class="mt-0.5 block text-xs text-stone-500">{o.hint}</span>
					</span>
				</label>
			{/each}
		</div>
		{#if methodInput === 'prepayment' || methodInput === 'deposit'}
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
			現地払いでは、予約確認画面でお客様が PayPay・クレジットカード・現金から選びます（PMS の備考に申し送り）。
			事前決済はオンラインのカード決済です。オンライン決済が使えない状態のときは、事前決済のみのプランも現地払いで受け付けます。
		</p>
		<button type="submit" class="mt-3 rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">支払方法を保存</button>
	</form>
{/if}

{#if data.live}
	<!-- 予約時に聞く項目（book.plan_contents.question_mode）。公式サイト・取引先ページの予約で聞き、回答は PMS の予約備考に入る -->
	<form method="POST" action="?/setQuestions" use:enhance={() => async ({ update }) => update({ reset: false })} class="mt-4 rounded-xl border border-stone-200 bg-white p-5">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-bold text-stone-700">予約時に聞く項目</h2>
			{#if (form as { questionSaved?: boolean } | null)?.questionSaved}<span class="text-xs text-emerald-600">✔ 保存しました</span>{/if}
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
								<li>{q.label}{q.type === 'select' ? `（${q.choices.join('・')}）` : q.type === 'text' ? '（自由入力）' : '（チェック）'}{q.required ? '・必須' : ''}</li>
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
			<div class="mt-3"><BookingQuestionsEditor bind:questions={qOwn} /></div>
		{/if}
		<p class="mt-3 text-xs text-stone-400">
			公式サイトと取引先ページの予約で聞き、回答は PMS の予約備考に入ります。取引先ごとに足す項目は、取引先の設定で決めます。
			宿泊者名・人数・電話・メール・到着予定・備考は、ここで足さなくても毎回聞きます。
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
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-bold text-stone-700">決済設定 <span class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-normal text-amber-800">デモ専用（メモリ上のみ）</span></h2>
			{#if form?.paymentSaved}<span class="text-xs text-emerald-600">✔ 保存しました</span>{/if}
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
				<div class="ml-6 mt-1 flex gap-4 text-xs">
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

		<div class="mb-4 flex gap-2">
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

			<div class="flex items-center gap-4 border-t border-stone-100 pt-4">
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
