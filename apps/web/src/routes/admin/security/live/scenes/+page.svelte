<script lang="ts">
	// 管理画面「Autumn Live の背景」（docs/autumn-live.md §10）。保存すると Live の画面が 1 分以内に読み直して差し替える。
	import { enhance } from '$lib/enhance';
	import { confirmSubmit } from '$lib/components/admin/confirm-dialog.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';

	let { data, form } = $props();

	type Draft = Record<string, string>;
	const f = $derived(form as { message?: string; done?: string; uploaded?: string; editing?: string; draft?: Draft } | null);
	const pretty = (v: unknown) => JSON.stringify(v, null, 2);
	const md = (s: string) => `${Number(s.slice(0, 2))}/${Number(s.slice(3))}`;
	const fmt = (iso: string) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' });
	const draftFor = (id: string): Draft | null => (f?.draft && (f.editing === id || (id === 'new' && f.editing === 'new')) ? f.draft : null);

	const nd = $derived(draftFor('new'));
	const EXAMPLE = pretty({
		skyTint: ['#7d9fc4', '#e9e4da'],
		layers: [
			{ type: 'treeRow', preset: 'larch', colors: ['#e7b93a', '#d99a2b'], height: 1, spacing: 1, snowCap: false },
			{ type: 'particles', preset: 'snow', density: 22, size: [0.6, 1.9], speed: [6, 15], sway: 0.8, opacity: [0.35, 0.75] },
			{ type: 'image', url: 'https://…/live-scenes/xxx.png', anchor: 'bottom-left', width: 0.2, offset: [0.02, 0], opacity: 1, nightOpacity: 0.6, bob: 0 }
		]
	});
	let copied = $state(false);
	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* 選択してコピーしてもらう */
		}
	}
</script>

<svelte:head><title>Autumn Live の背景 ｜ 山人管理</title></svelte:head>

<p class="mb-2 text-sm"><a href="/admin/security/live" class="text-stone-500 hover:text-stone-700">← Autumn Live の端末</a></p>
<PageHeader title="Autumn Live の背景" />
<p class="-mt-3 mb-5 max-w-3xl text-sm leading-relaxed text-stone-500">
	Live の画面の背景（空の色・降るもの・木の並び・クリスマスツリー・画像）を、期間ごとのシーンとして持ちます。保存すると、開いている Live の画面が<strong>1 分以内に読み直して差し替えます</strong>（アプリや Book の更新は要りません）。期間が重なったら「優先」の大きいほう、同じなら期間の短いほうを使います。
</p>

{#if !data.available}
	<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">この環境（AUTH_MODE=demo）では使えません。</div>
{:else}
	{#if f?.message}<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{f.message}</p>{/if}
	{#if f?.done}<p class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{f.done}</p>{/if}
	{#if data.loadError}<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.loadError}</p>{/if}

	<section class="mb-6 rounded-xl border border-stone-200 bg-white p-4">
		<h2 class="text-sm font-semibold text-stone-800">画像を上げる</h2>
		<p class="mt-1 text-xs text-stone-500">PNG・WebP（透明な部分がある絵向け）・JPEG・AVIF・GIF、4MB まで。上げた URL を、シーンの設定の <code>"url"</code>（画像の層）か <code>"image"</code>（画像の粒）に貼ります。</p>
		<form method="POST" action="?/upload" enctype="multipart/form-data" use:enhance class="mt-3 flex flex-wrap items-center gap-3">
			<input id="scene-image" name="image" type="file" accept="image/png,image/webp,image/jpeg,image/avif,image/gif" class="text-sm" />
			<button type="submit" class="min-h-9 rounded-lg bg-stone-900 px-4 text-sm text-white hover:bg-stone-800">上げる</button>
		</form>
		{#if f?.uploaded}
			<div class="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 p-2 text-xs">
				<code class="min-w-0 break-all select-all">{f.uploaded}</code>
				<button type="button" class="rounded border border-stone-300 px-2 py-1" onclick={() => copy(f!.uploaded!)}>{copied ? 'コピーしました' : 'URL をコピー'}</button>
			</div>
		{/if}
	</section>

	<section class="mb-6 grid gap-4">
		{#each data.scenes as s (s.id)}
			{@const d = draftFor(s.id)}
			<form method="POST" action="?/save" use:enhance class="rounded-xl border border-stone-200 bg-white p-4">
				<input type="hidden" name="id" value={s.id} />
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="text-sm font-semibold text-stone-800">{s.name}<span class="ml-2 text-xs font-normal text-stone-500">{md(s.starts)}〜{md(s.ends)}・更新 {fmt(s.updated_at)}</span></p>
					{#if !s.enabled}<span class="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500">使わない</span>{/if}
				</div>
				<div class="mt-3 flex flex-wrap items-end gap-3 text-xs text-stone-600">
					<label class="grid gap-1">名前<input name="name" value={d?.name ?? s.name} maxlength="60" class="min-h-9 w-56 rounded-lg border border-stone-300 px-2 text-sm" /></label>
					<label class="grid gap-1">始まり（月-日）<input name="starts" value={d?.starts ?? s.starts} placeholder="11-01" class="min-h-9 w-24 rounded-lg border border-stone-300 px-2 text-sm tabular-nums" /></label>
					<label class="grid gap-1">終わり（月-日）<input name="ends" value={d?.ends ?? s.ends} placeholder="11-30" class="min-h-9 w-24 rounded-lg border border-stone-300 px-2 text-sm tabular-nums" /></label>
					<label class="grid gap-1">優先<input name="priority" type="number" value={d?.priority ?? s.priority} min="-100" max="100" class="min-h-9 w-20 rounded-lg border border-stone-300 px-2 text-sm tabular-nums" /></label>
					<label class="flex min-h-9 items-center gap-2"><input name="enabled" type="checkbox" checked={d ? d.enabled === 'on' : s.enabled} class="size-4" />使う</label>
				</div>
				<label class="mt-3 grid gap-1 text-xs text-stone-600">
					設定（JSON）
					<textarea name="config" rows="10" spellcheck="false" class="w-full rounded-lg border border-stone-300 p-2 font-mono text-xs leading-relaxed">{d?.config ?? pretty(s.config)}</textarea>
				</label>
				<div class="mt-3 flex flex-wrap justify-end gap-2">
					<button
						type="submit"
						formaction="?/remove"
						class="min-h-9 rounded-lg border border-red-300 px-3 text-xs text-red-700 hover:bg-red-50"
						onclick={confirmSubmit({ message: `「${s.name}」を削除します。元に戻せません。`, confirmLabel: '削除する' })}
					>削除</button>
					<button type="submit" class="min-h-9 rounded-lg bg-stone-900 px-4 text-sm text-white hover:bg-stone-800">保存</button>
				</div>
			</form>
		{/each}

		<form method="POST" action="?/save" use:enhance class="rounded-xl border border-dashed border-stone-300 bg-white p-4">
			<p class="text-sm font-semibold text-stone-800">新しいシーンを足す</p>
			<div class="mt-3 flex flex-wrap items-end gap-3 text-xs text-stone-600">
				<label class="grid gap-1">名前<input name="name" value={nd?.name ?? ''} maxlength="60" placeholder="例: お正月" class="min-h-9 w-56 rounded-lg border border-stone-300 px-2 text-sm" /></label>
				<label class="grid gap-1">始まり（月-日）<input name="starts" value={nd?.starts ?? ''} placeholder="01-01" class="min-h-9 w-24 rounded-lg border border-stone-300 px-2 text-sm tabular-nums" /></label>
				<label class="grid gap-1">終わり（月-日）<input name="ends" value={nd?.ends ?? ''} placeholder="01-07" class="min-h-9 w-24 rounded-lg border border-stone-300 px-2 text-sm tabular-nums" /></label>
				<label class="grid gap-1">優先<input name="priority" type="number" value={nd?.priority ?? '10'} min="-100" max="100" class="min-h-9 w-20 rounded-lg border border-stone-300 px-2 text-sm tabular-nums" /></label>
				<label class="flex min-h-9 items-center gap-2"><input name="enabled" type="checkbox" checked={nd ? nd.enabled === 'on' : true} class="size-4" />使う</label>
			</div>
			<label class="mt-3 grid gap-1 text-xs text-stone-600">
				設定（JSON）
				<textarea name="config" rows="10" spellcheck="false" class="w-full rounded-lg border border-stone-300 p-2 font-mono text-xs leading-relaxed">{nd?.config ?? EXAMPLE}</textarea>
			</label>
			<div class="mt-3 flex justify-end"><button type="submit" class="min-h-9 rounded-lg bg-stone-900 px-4 text-sm text-white hover:bg-stone-800">足す</button></div>
		</form>
	</section>

	<section class="rounded-xl border border-stone-200 bg-stone-50 p-4 text-xs leading-relaxed text-stone-600">
		<h2 class="text-sm font-semibold text-stone-800">設定の書き方</h2>
		<ul class="mt-2 grid gap-1">
			<li><code>skyTint</code>: 昼の空に混ぜる色（上・地平線）。例 <code>["#7fa9d2", "#e8eff5"]</code></li>
			<li><code>layers</code>: 下から順に描く層。種類は 4 つ。
				<ul class="ml-4 list-disc">
					<li><code>particles</code>（降るもの）: <code>preset</code> = snow／petal／leaf／firefly／image。<code>density</code>（100 万画素あたりの数）・<code>size</code>・<code>speed</code>（毎秒の px）・<code>sway</code>（横の揺れ）・<code>opacity</code>・<code>colors</code>・<code>image</code>（image のとき）・<code>dayOpacity</code>（昼の見え方）</li>
					<li><code>treeRow</code>（画面の下の木の並び）: <code>colors</code>・<code>height</code>（倍率）・<code>spacing</code>（間隔の倍率）・<code>snowCap</code>（雪をかぶせる）</li>
					<li><code>xmasTree</code>（クリスマスツリー）: <code>side</code> = left／right・<code>scale</code>・<code>lights</code>（灯りの色）</li>
					<li><code>image</code>（画像を置く）: <code>url</code>・<code>anchor</code>（bottom-left など）・<code>width</code>（画面の幅に対する割合）・<code>offset</code>・<code>opacity</code>・<code>nightOpacity</code>・<code>bob</code>（上下の揺れ px）</li>
				</ul>
			</li>
			<li>Live の画面の右上「背景（季節）」で、ほかのシーンを選んで見比べられます。新しい種類の動き（例: 花火・流れ星）は、コードを足すと使えるようになります。</li>
		</ul>
	</section>
{/if}
