<script lang="ts">
	// 管理画面: プラン紹介文のテンプレートブロック。
	// 紹介文に {{tpl:キー}} と書くと、表示するときにここの見出し・本文に置き換わる（テンプレートを直せば全プランが変わる）。
	// 種類「特典」は本文に出さず、予約ボタンの横のバナー（押すとモーダル）に出す。
	import { enhance } from '$app/forms';
	import { templateToken } from '$lib/plan-templates';
	import { askConfirm } from '$lib/components/admin/confirm-dialog.svelte';

	let { data, form } = $props();
	let creating = $state<{ title: string; body: string; key: string; kind: 'body' | 'perk'; bannerLabel: string } | null>(null);

	// 見出しから作り始める（本文はその見出しで一番多い文章・キーは見出しから推測）
	const KEY_HINTS: Record<string, string> = { ご夕食: 'dinner', ご朝食: 'breakfast', 周辺スポット: 'spots', ご案内: 'guide', 公式HP限定特典: 'official-perk', プラン説明: 'plan-note' };
	function startFrom(h: { title: string; body: string }) {
		const name = h.title.replace(/^■-|-■$/g, '');
		const perk = /特典/.test(name);
		creating = { title: h.title, body: h.body, key: KEY_HINTS[name] ?? '', kind: perk ? 'perk' : 'body', bannerLabel: perk ? name : '' };
	}
	const usageOf = (id: string) => (data.usage as Record<string, { using: string[]; literal: string[] }>)[id] ?? { using: [], literal: [] };
	const existingTitles = $derived(new Set(data.templates.map((t) => t.title)));
	let copied = $state('');
	async function copyToken(key: string) {
		try {
			await navigator.clipboard.writeText(templateToken(key));
			copied = key;
			setTimeout(() => (copied = ''), 1500);
		} catch {
			/* コピーできない環境では何もしない */
		}
	}
</script>

<svelte:head><title>紹介文テンプレート ｜ 山人管理</title></svelte:head>

<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
	<div>
		<p class="text-xs text-stone-500"><a href="/admin/plans" class="hover:underline">プラン</a> / 紹介文テンプレート</p>
		<h1 class="text-lg font-bold text-stone-800">紹介文テンプレート — {data.currentFacility.name}</h1>
	</div>
	<button type="button" onclick={() => (creating = { title: '■--■', body: '', key: '', kind: 'body', bannerLabel: '' })} class="rounded-md bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-700">＋ 新しいテンプレート</button>
</div>

<div class="mb-5 rounded-lg bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
	<p>プランの紹介文に <code class="rounded bg-white px-1">{'{{tpl:キー}}'}</code> と書くと、表示するときにテンプレートの見出しと本文に置き換わります。テンプレートを直せば、それを入れた全プランが変わります。</p>
	<p>種類を「特典」にすると本文には出さず、予約ボタンの横にバナーとして出します（押すと中身をモーダルで表示）。まだ文章のまま入っている同じ見出しのブロックも、本文から外してバナーにします。</p>
	<p>「同じ文章を置き換え」は、見出しも本文もテンプレートと同じブロックだけを差し込み印にします。プランごとに書き分けている文章は触りません。</p>
</div>

{#if data.loadError}<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{data.loadError}</p>{/if}
{#if form?.error}<p class="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{form.error}</p>{/if}

{#if data.headings.length}
	<section class="mb-6">
		<h2 class="mb-2 text-sm font-bold text-stone-700">紹介文に出てくる見出しから作る</h2>
		<div class="flex flex-wrap gap-2">
			{#each data.headings as h (h.title)}
				<button type="button" disabled={existingTitles.has(h.title)} onclick={() => startFrom(h)} class="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm hover:border-brand-800 disabled:opacity-40" title={existingTitles.has(h.title) ? 'テンプレートあり' : `${h.plans}プラン・文章${h.variants}通り`}>
					{h.title} <span class="text-xs text-stone-500">{h.plans}プラン{h.variants > 1 ? `・${h.variants}通り` : ''}</span>
				</button>
			{/each}
		</div>
		<p class="mt-1 text-xs text-stone-500">「◯通り」はプランごとに文章が違う見出し（例: ご夕食）。テンプレートにすると、一番多い文章のプランだけが置き換え対象になります。</p>
	</section>
{/if}

{#snippet editor(t: { id?: string; key: string; title: string; body: string; kind: 'body' | 'perk'; bannerLabel: string | null; sortOrder?: number }, isNew: boolean)}
	<form method="POST" action="?/save" use:enhance={() => async ({ update, result }) => { await update({ reset: false }); if (isNew && result.type === 'success') creating = null; }} class="grid gap-3">
		{#if t.id}<input type="hidden" name="id" value={t.id} />{/if}
		<div class="grid gap-3 sm:grid-cols-[1fr_12rem_9rem_6rem]">
			<label class="text-xs text-stone-500">見出し<input name="title" value={t.title} required maxlength="80" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800" /></label>
			<label class="text-xs text-stone-500">キー（半角英小文字）<input name="key" value={t.key} required pattern="[a-z0-9][a-z0-9_\-]{'{'}0,39{'}'}" placeholder="breakfast" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-sm text-stone-800" /></label>
			<label class="text-xs text-stone-500">種類
				<select name="kind" value={t.kind} class="mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-2 text-sm text-stone-800">
					<option value="body">本文に入れる</option>
					<option value="perk">特典（バナー）</option>
				</select>
			</label>
			<label class="text-xs text-stone-500">並び順<input name="sortOrder" type="number" value={t.sortOrder ?? 0} class="mt-1 w-full rounded-md border border-stone-300 px-2 py-2 text-sm text-stone-800" /></label>
		</div>
		<label class="text-xs text-stone-500">特典のバナーの文字（種類が特典のとき）<input name="bannerLabel" value={t.bannerLabel ?? ''} maxlength="30" placeholder="公式HP限定特典" class="mt-1 w-full max-w-sm rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800" /></label>
		<label class="text-xs text-stone-500">本文（Markdown・行末に空白2つで改行）<textarea name="body" rows="8" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-sm leading-6 text-stone-800">{t.body}</textarea></label>
		<div class="flex flex-wrap items-center gap-2">
			<button type="submit" class="rounded-md bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-700">保存</button>
			{#if isNew}<button type="button" onclick={() => (creating = null)} class="rounded-md border border-stone-300 px-4 py-2 text-sm">やめる</button>{/if}
		</div>
	</form>
{/snippet}

{#if creating}
	<section class="mb-6 rounded-xl border-2 border-brand-800/30 bg-white p-4">
		<h2 class="mb-3 text-sm font-bold text-stone-700">新しいテンプレート</h2>
		{@render editor({ ...creating, bannerLabel: creating.bannerLabel }, true)}
	</section>
{/if}

<div class="space-y-5">
	{#each data.templates as t (t.id)}
		{@const u = usageOf(t.id)}
		<section class="rounded-xl border border-stone-200 bg-white p-4">
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div class="flex flex-wrap items-center gap-2">
					<span class={`rounded-full px-2 py-0.5 text-xs ${t.kind === 'perk' ? 'bg-teal-600 text-white' : 'bg-stone-100 text-stone-600'}`}>{t.kind === 'perk' ? `特典「${t.bannerLabel}」` : '本文'}</span>
					<button type="button" onclick={() => copyToken(t.key)} class="rounded bg-stone-100 px-2 py-0.5 font-mono text-xs text-stone-700 hover:bg-stone-200" title="押すとコピー">{templateToken(t.key)}</button>
					{#if copied === t.key}<span class="text-xs text-emerald-700">コピーしました</span>{/if}
				</div>
				<p class="text-xs text-stone-500">差し込み印を入れたプラン {u.using.length}件{u.literal.length ? `・文章のまま同じ見出しがあるプラン ${u.literal.length}件` : ''}</p>
			</div>
			{@render editor(t, false)}
			<div class="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
				{#if u.literal.length}
					<form method="POST" action="?/replace" use:enhance>
						<input type="hidden" name="id" value={t.id} />
						<button type="submit" class="rounded-md border border-brand-800 px-3 py-1.5 text-sm text-brand-800 hover:bg-brand-50">同じ文章を差し込み印に置き換え</button>
					</form>
				{/if}
				<form method="POST" action="?/delete" use:enhance={async ({ cancel }) => { if (!(await askConfirm({ message: `「${t.title}」を削除します。差し込み印を入れたプランでは、その部分が表示されなくなります。`, confirmLabel: '削除する' }))) cancel(); }} class="ml-auto">
					<input type="hidden" name="id" value={t.id} />
					<button type="submit" class="rounded-md px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50">削除</button>
				</form>
			</div>
			{#if form?.replaced && form.replaced.id === t.id}
				<p class="mt-2 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
					置き換えたプラン {form.replaced.replaced.length}件{form.replaced.replaced.length ? `（${form.replaced.replaced.join('、')}）` : ''}。
					{#if form.replaced.different.length}文章が違うので置き換えなかったプラン: {form.replaced.different.join('、')}{/if}
				</p>
			{/if}
			{#if u.using.length}<p class="mt-2 text-xs text-stone-500">使っているプラン: {u.using.join('、')}</p>{/if}
		</section>
	{:else}
		{#if data.live && !data.loadError}<p class="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">テンプレートはまだありません。上の見出しから作るか、「新しいテンプレート」で作ってください。</p>{/if}
	{/each}
</div>
