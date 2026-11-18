<script lang="ts">
	// 客室・プランの「翻訳」（book.content_translations・2026-11-18）。
	// 日本語の紹介を項目ごとに左に出し、右に英語・繁体字を入れる。空の項目は公式サイトで日本語のまま出る。
	// 保存先は ?/saveTranslation（ページ側の action）。公開のチェックを外すと保存だけして公式サイトには出さない。
	import { enhance } from '$lib/enhance';
	import type { TranslationEntity, TranslationLocale, TranslationSet, TranslationSource } from '$lib/content-translation';

	let {
		entity,
		source,
		translations,
		savedLocale = null,
		error = null
	}: {
		entity: TranslationEntity;
		source: TranslationSource;
		translations: TranslationSet;
		savedLocale?: string | null;
		error?: string | null;
	} = $props();

	const LOCALES: { value: TranslationLocale; label: string }[] = [
		{ value: 'en', label: 'English' },
		{ value: 'zh-TW', label: '繁體中文' }
	];
	let locale = $state<TranslationLocale>('en');
	let open = $state(false);

	const tr = $derived(translations[locale]?.fields ?? {});
	const str = (v: unknown) => (typeof v === 'string' ? v : '');
	const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
	const specAt = (i: number) => (arr(tr.specs)[i] ?? {}) as Record<string, unknown>;
	const secAt = (i: number) => (arr(tr.sections)[i] ?? {}) as Record<string, unknown>;
	// 保存済みの訳が日本語と同じ（訳の無い項目に日本語を入れて保存したもの）なら、入力欄は空で見せる
	const unless = (v: unknown, ja: string) => (str(v) === ja ? '' : str(v));
	const hasTpl = $derived(/\{\{tpl:/.test(source.description));
	const status = (l: TranslationLocale) => (!translations[l] ? '未入力' : translations[l]!.isPublished ? '公開中' : '非公開');

	const inputCls = 'mt-1 w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm';
	const jaCls = 'whitespace-pre-line rounded bg-stone-50 px-2.5 py-1.5 text-sm text-stone-600';
</script>

<section class="mt-6 rounded-xl border border-stone-200 bg-white" aria-labelledby="translation-heading">
	<button type="button" onclick={() => (open = !open)} aria-expanded={open} class="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
		<span>
			<span id="translation-heading" class="text-sm font-bold text-stone-700">翻訳（英語・繁体字）</span>
			<span class="ml-2 text-xs text-stone-500">English: {status('en')}／繁體中文: {status('zh-TW')}</span>
		</span>
		<span class="text-stone-400" aria-hidden="true">{open ? '▲' : '▼'}</span>
	</button>

	{#if open}
		<div class="border-t border-stone-100 px-5 pb-5 pt-4">
			<p class="mb-3 text-xs leading-relaxed text-stone-500">
				公式サイトを英語・繁体字で開いたときに出す文言です。空の項目は日本語のまま出ます。
				施設名「山人-yamado-」「山人-oga-」はそのまま書いてください。
			</p>

			<div class="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="言語">
				{#each LOCALES as l (l.value)}
					<button type="button" role="tab" aria-selected={locale === l.value} onclick={() => (locale = l.value)} class="rounded-md px-4 py-1.5 text-sm font-medium {locale === l.value ? 'bg-brand-800 text-white' : 'border border-stone-300 bg-white text-stone-600 hover:bg-stone-50'}">
						{l.label}<span class="ml-1.5 text-xs opacity-80">（{status(l.value)}）</span>
					</button>
				{/each}
			</div>

			{#if savedLocale}<p role="status" class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">翻訳を保存しました（{savedLocale === 'en' ? 'English' : '繁體中文'}）。</p>{/if}
			{#if error}<p role="alert" class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>{/if}

			{#key locale}
				<form method="POST" action="?/saveTranslation" use:enhance class="space-y-5">
					<input type="hidden" name="locale" value={locale} />

					<fieldset class="space-y-3">
						<legend class="mb-1 text-xs font-bold text-stone-500">名前・見出し</legend>
						{#if entity === 'room_type'}
							<div class="grid gap-2 md:grid-cols-2">
								<div><p class="text-xs text-stone-400">部屋タイプ名（日本語）</p><p class={jaCls}>{source.name}</p></div>
								<label class="block text-xs text-stone-500">部屋タイプ名<input name="name" value={str(tr.name)} class={inputCls} /></label>
							</div>
						{/if}
						<div class="grid gap-2 md:grid-cols-2">
							<div><p class="text-xs text-stone-400">{entity === 'plan' ? 'プラン名（見出し）' : '見出し'}（日本語）</p><p class={jaCls}>{source.headline || '—'}</p></div>
							<label class="block text-xs text-stone-500">{entity === 'plan' ? 'プラン名（見出し）' : '見出し'}<input name="headline" value={str(tr.headline)} class={inputCls} /></label>
						</div>
					</fieldset>

					<fieldset class="space-y-2">
						<legend class="mb-1 text-xs font-bold text-stone-500">紹介文</legend>
						{#if hasTpl}
							<p class="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">日本語の紹介文にはテンプレートの差し込み（{'{{tpl:…}}'}）があります。テンプレートは日本語のまま出るので、訳では差し込みを使わず、文章をそのまま書いてください。</p>
						{/if}
						<div class="grid gap-2 md:grid-cols-2">
							<pre class="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-stone-50 px-2.5 py-1.5 text-xs text-stone-600">{source.description || '—'}</pre>
							<textarea name="description" rows="12" class="{inputCls} font-mono text-xs">{str(tr.description)}</textarea>
						</div>
					</fieldset>

					{#if entity === 'plan' && source.tags.length}
						<fieldset class="grid gap-2 md:grid-cols-2">
							<legend class="mb-1 text-xs font-bold text-stone-500">タグ（1 行に 1 つ）</legend>
							<p class={jaCls}>{source.tags.join('\n')}</p>
							<textarea name="tags" rows={Math.max(2, source.tags.length)} class={inputCls}>{arr(tr.highlightTags).map(str).join('\n')}</textarea>
						</fieldset>
					{/if}
					{#if entity === 'room_type' && source.amenities.length}
						<fieldset class="grid gap-2 md:grid-cols-2">
							<legend class="mb-1 text-xs font-bold text-stone-500">設備（1 行に 1 つ）</legend>
							<p class={jaCls}>{source.amenities.join('\n')}</p>
							<textarea name="amenities" rows={Math.max(2, source.amenities.length)} class={inputCls}>{arr(tr.amenities).map(str).join('\n')}</textarea>
						</fieldset>
					{/if}

					{#if source.specs.length}
						<fieldset class="space-y-2">
							<legend class="mb-1 text-xs font-bold text-stone-500">仕様（表）</legend>
							{#each source.specs as s, i (i)}
								<div class="grid gap-2 border-t border-stone-100 pt-2 md:grid-cols-2">
									<p class={jaCls}><span class="font-medium">{s.label}</span>　{s.value}</p>
									<div class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
										<input name="spec_label_{i}" value={unless(specAt(i).label, s.label)} placeholder="項目" aria-label="仕様の項目 {i + 1}" class={inputCls} />
										<textarea name="spec_value_{i}" rows={Math.min(4, s.value.split('\n').length)} placeholder="内容" aria-label="仕様の内容 {i + 1}" class={inputCls}>{unless(specAt(i).value, s.value)}</textarea>
									</div>
								</div>
							{/each}
						</fieldset>
					{/if}

					{#if source.sections.length}
						<fieldset class="space-y-2">
							<legend class="mb-1 text-xs font-bold text-stone-500">紹介ブロック</legend>
							{#each source.sections as s, i (i)}
								<div class="grid gap-2 border-t border-stone-100 pt-2 md:grid-cols-2">
									<div class="space-y-1">
										<p class="text-xs text-stone-400">{s.group}</p>
										<p class="text-sm font-medium text-stone-700">{s.title}</p>
										<p class={jaCls}>{s.text}</p>
										{#if s.note}<p class="text-xs text-stone-500">{s.note}</p>{/if}
									</div>
									<div class="space-y-1">
										<div class="grid grid-cols-2 gap-2">
											<input name="sec_group_{i}" value={unless(secAt(i).group, s.group)} placeholder="見出しのまとまり" aria-label="ブロック {i + 1} のまとまり" class={inputCls} />
											<input name="sec_title_{i}" value={unless(secAt(i).title, s.title)} placeholder="見出し" aria-label="ブロック {i + 1} の見出し" class={inputCls} />
										</div>
										<textarea name="sec_text_{i}" rows="4" placeholder="本文" aria-label="ブロック {i + 1} の本文" class={inputCls}>{unless(secAt(i).text, s.text)}</textarea>
										{#if s.note}<textarea name="sec_note_{i}" rows="2" placeholder="注記" aria-label="ブロック {i + 1} の注記" class={inputCls}>{unless(secAt(i).note, s.note)}</textarea>{/if}
									</div>
								</div>
							{/each}
						</fieldset>
					{/if}

					{#if source.photoCaptions.some(Boolean)}
						<fieldset class="space-y-2">
							<legend class="mb-1 text-xs font-bold text-stone-500">写真の説明（並び順どおり）</legend>
							{#each source.photoCaptions as cap, i (i)}
								{#if cap}
									<div class="grid gap-2 md:grid-cols-2">
										<p class={jaCls}>{i + 1}. {cap}</p>
										<input name="caption_{i}" value={str(arr(tr.photoCaptions)[i])} aria-label="写真 {i + 1} の説明" class={inputCls} />
									</div>
								{:else}
									<input type="hidden" name="caption_{i}" value={str(arr(tr.photoCaptions)[i])} />
								{/if}
							{/each}
						</fieldset>
					{/if}

					<div class="flex flex-wrap items-center gap-4 border-t border-stone-100 pt-4">
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" name="isPublished" checked={translations[locale]?.isPublished ?? true} class="h-4 w-4" />
							<span>公式サイトに出す</span>
						</label>
						<button type="submit" class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">{locale === 'en' ? 'English' : '繁體中文'}の翻訳を保存</button>
					</div>
				</form>
			{/key}
		</div>
	{/if}
</section>
