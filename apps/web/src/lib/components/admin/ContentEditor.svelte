<script lang="ts">
	// 部屋タイプ・プラン紹介の編集フォーム（/admin/rooms/[id]・/admin/plans/[id] 共通）。
	//
	// ■ 編集中の値はすべてこのコンポーネントの $state に持ち、「保存」で hidden の payload（JSON）に
	//   まとめて ?/save へ送る。空要素の除去・型の正規化はサーバー側（normalizeContentDraft）で行う。
	// ■ 写真は選んだ時点で ?/upload に上げて URL だけ受け取り、一覧・ブロックへ差し込む。
	//   **行への書き込みは「保存」を押したとき**（他の編集と一緒に書く）。
	// ■ 保存後はページ側が {#key updatedAt} で作り直すので、正規化後の値で表示し直される。
	import { enhance, deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import {
		PHOTO_CATEGORIES,
		PHOTO_CATEGORY_LABELS,
		PHOTO_MIME_TYPES,
		moveItem,
		type ContentPhoto,
		type ContentSection,
		type ContentSpec,
		type PhotoCategory
	} from '$lib/content-blocks';

	type Initial = {
		headline: string;
		description: string;
		isPublished: boolean;
		tags: string[];
		specs: ContentSpec[];
		sections: ContentSection[];
		photos: ContentPhoto[];
		sortOrder: number;
	};

	let {
		initial,
		kind,
		live,
		tagsLabel,
		tagsPlaceholder = '',
		showSortOrder = false,
		markdown = false,
		photoFallback = 'room'
	}: {
		initial: Initial;
		kind: 'room' | 'plan';
		live: boolean;
		tagsLabel: string;
		tagsPlaceholder?: string;
		showSortOrder?: boolean;
		/** description を Markdown エディタで編集する（プラン本文）。false なら改行を保つテキスト。 */
		markdown?: boolean;
		photoFallback?: PhotoCategory;
	} = $props();

	// 初期値を prop から取り込み、以降はローカルで編集する（意図的な初期化。保存後は親が作り直す）
	// svelte-ignore state_referenced_locally
	let headline = $state(initial.headline);
	// svelte-ignore state_referenced_locally
	let description = $state(initial.description);
	// svelte-ignore state_referenced_locally
	let isPublished = $state(initial.isPublished);
	// svelte-ignore state_referenced_locally
	let tagsText = $state(initial.tags.join('、'));
	// svelte-ignore state_referenced_locally
	let sortOrder = $state(initial.sortOrder);
	// svelte-ignore state_referenced_locally
	let specs = $state<ContentSpec[]>(initial.specs.map((s) => ({ ...s })));
	// svelte-ignore state_referenced_locally
	let sections = $state<ContentSection[]>(
		initial.sections.map((s) => ({ group: s.group, title: s.title, text: s.text, note: s.note ?? '', photo: s.photo ?? '' }))
	);
	// svelte-ignore state_referenced_locally
	let photos = $state<ContentPhoto[]>(initial.photos.map((p) => ({ ...p })));

	let saving = $state(false);
	let uploading = $state<string | null>(null); // 'photos' | 'section:N'
	let message = $state<{ ok: boolean; text: string } | null>(null);
	let dirty = $state(false);

	const payload = $derived(
		JSON.stringify({
			headline,
			description,
			isPublished,
			tags: tagsText,
			sortOrder,
			specs,
			sections,
			photos
		})
	);

	const accept = PHOTO_MIME_TYPES.join(',');

	function touch() {
		dirty = true;
		message = null;
	}

	// ---- 仕様表
	function addSpec() {
		specs.push({ label: '', value: '' });
		touch();
	}
	function removeSpec(i: number) {
		specs.splice(i, 1);
		touch();
	}
	function moveSpec(i: number, d: -1 | 1) {
		specs = moveItem(specs, i, d);
		touch();
	}

	// ---- 紹介ブロック
	function addSection() {
		// 直前のブロックと同じ見出しで足す（同じ見出しの続きを書くことが多い）
		const g = sections.length ? sections[sections.length - 1].group : '';
		sections.push({ group: g, title: '', text: '', note: '', photo: '' });
		touch();
	}
	function removeSection(i: number) {
		sections.splice(i, 1);
		touch();
	}
	function moveSection(i: number, d: -1 | 1) {
		sections = moveItem(sections, i, d);
		touch();
	}

	// ---- 写真
	function removePhoto(i: number) {
		photos.splice(i, 1);
		touch();
	}
	function movePhoto(i: number, d: -1 | 1) {
		photos = moveItem(photos, i, d);
		touch();
	}

	/** ?/upload へ上げて公開 URL を受け取る（行には書かない）。 */
	async function upload(file: File): Promise<string | null> {
		const fd = new FormData();
		fd.append('photo', file);
		const res = await fetch('?/upload', {
			method: 'POST',
			body: fd,
			headers: { 'x-sveltekit-action': 'true' }
		});
		const result = deserialize(await res.text());
		if (result.type === 'success' && typeof result.data?.uploaded === 'string') return result.data.uploaded;
		const err =
			result.type === 'failure' && typeof result.data?.error === 'string' ? result.data.error : 'アップロードに失敗しました。';
		message = { ok: false, text: err };
		return null;
	}

	async function onPhotosPicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (!files.length) return;
		uploading = 'photos';
		message = null;
		try {
			for (const f of files) {
				const url = await upload(f);
				if (!url) break;
				photos.push({ url, caption: '', category: photoFallback });
				dirty = true;
			}
		} finally {
			uploading = null;
		}
	}

	async function onSectionPhotoPicked(e: Event, i: number) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		uploading = `section:${i}`;
		message = null;
		try {
			const url = await upload(file);
			if (url && sections[i]) {
				sections[i].photo = url;
				dirty = true;
			}
		} finally {
			uploading = null;
		}
	}

	const inputCls = 'w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm';
	const iconBtn =
		'rounded border border-stone-300 px-1.5 py-0.5 text-xs text-stone-600 hover:bg-stone-50 disabled:opacity-30';
</script>

<form
	method="POST"
	action="?/save"
	use:enhance={() => {
		saving = true;
		message = null;
		return async ({ result, update }) => {
			saving = false;
			if (result.type === 'success') {
				dirty = false;
				message = { ok: true, text: '保存しました。' };
				// 親が updatedAt で作り直すので、正規化後の値で表示し直される
				await invalidateAll();
			} else if (result.type === 'failure') {
				message = { ok: false, text: String(result.data?.error ?? '保存できませんでした。') };
			} else {
				await update({ reset: false });
			}
		};
	}}
	class="space-y-6"
>
	<input type="hidden" name="payload" value={payload} />

	<!-- 基本 -->
	<section class="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
		<h2 class="text-sm font-bold text-stone-700">基本</h2>
		<label class="block text-sm">
			<span class="text-xs text-stone-500">見出し（headline）</span>
			<input bind:value={headline} oninput={touch} class="mt-0.5 {inputCls}" />
		</label>

		<div class="block text-sm">
			<span class="text-xs text-stone-500">
				{markdown ? '本文（Markdown — 右がそのまま顧客画面の表示）' : '説明文（改行はそのまま表示されます）'}
			</span>
			<div class="mt-0.5" oninput={touch}>
				{#if markdown}
					<MarkdownEditor bind:value={description} name="description_md" rows={14} photos={photos} />
				{:else}
					<textarea bind:value={description} rows="6" class={inputCls}></textarea>
				{/if}
			</div>
		</div>

		<label class="block text-sm">
			<span class="text-xs text-stone-500">{tagsLabel}</span>
			<input bind:value={tagsText} oninput={touch} placeholder={tagsPlaceholder} class="mt-0.5 {inputCls}" />
		</label>

		<div class="flex flex-wrap items-center gap-6">
			{#if showSortOrder}
				<label class="flex items-center gap-2 text-sm">
					<span class="text-stone-600">表示順</span>
					<input type="number" bind:value={sortOrder} oninput={touch} min="0" class="w-24 rounded-md border border-stone-300 px-2.5 py-1.5" />
				</label>
			{/if}
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={isPublished} onchange={touch} class="h-4 w-4" />
				<span>公式サイトに公開する（OFF＝下書き）</span>
			</label>
		</div>
	</section>

	<!-- 仕様表 -->
	<section class="rounded-xl border border-stone-200 bg-white p-5">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="text-sm font-bold text-stone-700">仕様表 <span class="text-xs font-normal text-stone-400">（例: 広さ／48㎡、ベッド／ツイン…）</span></h2>
			<button type="button" onclick={addSpec} class="rounded-md border border-stone-300 px-3 py-1 text-xs hover:bg-stone-50">＋ 行を追加</button>
		</div>
		{#if specs.length === 0}
			<p class="text-xs text-stone-400">まだありません。</p>
		{/if}
		<div class="space-y-2">
			{#each specs as spec, i (i)}
				<div class="flex flex-col gap-2 rounded-lg border border-stone-100 p-2 sm:flex-row sm:items-start">
					<input bind:value={spec.label} oninput={touch} placeholder="項目名" class="{inputCls} sm:w-40" />
					<textarea bind:value={spec.value} oninput={touch} rows="2" placeholder="内容（改行できます）" class="{inputCls} flex-1"></textarea>
					<div class="flex shrink-0 gap-1">
						<button type="button" class={iconBtn} disabled={i === 0} onclick={() => moveSpec(i, -1)} aria-label="上へ">↑</button>
						<button type="button" class={iconBtn} disabled={i === specs.length - 1} onclick={() => moveSpec(i, 1)} aria-label="下へ">↓</button>
						<button type="button" class="{iconBtn} text-rose-600" onclick={() => removeSpec(i)} aria-label="削除">✕</button>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- 紹介ブロック -->
	<section class="rounded-xl border border-stone-200 bg-white p-5">
		<div class="mb-1 flex items-center justify-between">
			<h2 class="text-sm font-bold text-stone-700">紹介ブロック</h2>
			<button type="button" onclick={addSection} class="rounded-md border border-stone-300 px-3 py-1 text-xs hover:bg-stone-50">＋ ブロックを追加</button>
		</div>
		<p class="mb-3 text-xs text-stone-400">同じ「見出し」が続くブロックは、公開ページで1つの見出しの下にまとめて表示されます。</p>
		{#if sections.length === 0}
			<p class="text-xs text-stone-400">まだありません。</p>
		{/if}
		<div class="space-y-3">
			{#each sections as sec, i (i)}
				<div class="rounded-lg border border-stone-200 p-3">
					<div class="flex flex-col gap-3 sm:flex-row">
						<div class="flex-1 space-y-2">
							<div class="grid gap-2 sm:grid-cols-2">
								<label class="block text-sm">
									<span class="text-xs text-stone-500">見出し（group）</span>
									<input bind:value={sec.group} oninput={touch} placeholder="例: 浴室" class="mt-0.5 {inputCls}" />
								</label>
								<label class="block text-sm">
									<span class="text-xs text-stone-500">タイトル</span>
									<input bind:value={sec.title} oninput={touch} placeholder="例: 半露天風呂" class="mt-0.5 {inputCls}" />
								</label>
							</div>
							<label class="block text-sm">
								<span class="text-xs text-stone-500">本文</span>
								<textarea bind:value={sec.text} oninput={touch} rows="4" class="mt-0.5 {inputCls}"></textarea>
							</label>
							<label class="block text-sm">
								<span class="text-xs text-stone-500">注記（任意）</span>
								<input bind:value={sec.note} oninput={touch} placeholder="例: ※温泉ではございません" class="mt-0.5 {inputCls}" />
							</label>
						</div>
						<div class="w-full shrink-0 space-y-2 sm:w-44">
							<span class="text-xs text-stone-500">写真（1枚）</span>
							{#if sec.photo}
								<img src={sec.photo} alt="" class="h-28 w-full rounded-md object-cover" />
								<button type="button" class="text-xs text-rose-600 hover:underline" onclick={() => { sec.photo = ''; touch(); }}>写真を外す</button>
							{:else}
								<div class="flex h-28 items-center justify-center rounded-md bg-stone-100 text-xs text-stone-400">写真なし</div>
							{/if}
							{#if photos.length}
								<select
									class="w-full rounded-md border border-stone-300 px-2 py-1 text-xs"
									value=""
									onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v) { sec.photo = v; touch(); } (e.currentTarget as HTMLSelectElement).value = ''; }}
								>
									<option value="">写真一覧から選ぶ…</option>
									{#each photos as p, pi (pi)}
										<option value={p.url}>{pi + 1}. {p.caption || PHOTO_CATEGORY_LABELS[p.category]}</option>
									{/each}
								</select>
							{/if}
							<label class="block cursor-pointer rounded-md border border-dashed border-stone-300 px-2 py-1 text-center text-xs text-stone-600 hover:bg-stone-50 {live ? '' : 'pointer-events-none opacity-40'}">
								{uploading === `section:${i}` ? 'アップロード中…' : '新しくアップロード'}
								<input type="file" accept={accept} class="hidden" disabled={!live || uploading !== null} onchange={(e) => onSectionPhotoPicked(e, i)} />
							</label>
						</div>
					</div>
					<div class="mt-2 flex justify-end gap-1">
						<button type="button" class={iconBtn} disabled={i === 0} onclick={() => moveSection(i, -1)}>↑ 上へ</button>
						<button type="button" class={iconBtn} disabled={i === sections.length - 1} onclick={() => moveSection(i, 1)}>↓ 下へ</button>
						<button type="button" class="{iconBtn} text-rose-600" onclick={() => removeSection(i)}>削除</button>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- 写真 -->
	<section class="rounded-xl border border-stone-200 bg-white p-5">
		<div class="mb-1 flex items-center justify-between">
			<h2 class="text-sm font-bold text-stone-700">写真 <span class="text-xs font-normal text-stone-400">（先頭が一覧・ページ上部の代表写真）</span></h2>
			<label class="cursor-pointer rounded-md border border-stone-300 px-3 py-1 text-xs hover:bg-stone-50 {live ? '' : 'pointer-events-none opacity-40'}">
				{uploading === 'photos' ? 'アップロード中…' : '＋ 写真をアップロード'}
				<input type="file" accept={accept} multiple class="hidden" disabled={!live || uploading !== null} onchange={onPhotosPicked} />
			</label>
		</div>
		<p class="mb-3 text-xs text-stone-400">JPEG・PNG・WebP・AVIF、1枚10MBまで。アップロードした写真は「保存」を押すまで公開ページに反映されません。</p>
		{#if photos.length === 0}
			<p class="text-xs text-stone-400">まだありません。</p>
		{/if}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each photos as photo, i (i)}
				<div class="rounded-lg border border-stone-200 p-2">
					<img src={photo.url} alt={photo.caption} class="h-32 w-full rounded-md object-cover" />
					<input bind:value={photo.caption} oninput={touch} placeholder="キャプション" class="mt-2 {inputCls}" />
					<div class="mt-2 flex items-center gap-1">
						<select bind:value={photo.category} onchange={touch} class="flex-1 rounded-md border border-stone-300 px-2 py-1 text-xs">
							{#each PHOTO_CATEGORIES as c (c)}
								<option value={c}>{PHOTO_CATEGORY_LABELS[c]}</option>
							{/each}
						</select>
						<button type="button" class={iconBtn} disabled={i === 0} onclick={() => movePhoto(i, -1)} aria-label="前へ">←</button>
						<button type="button" class={iconBtn} disabled={i === photos.length - 1} onclick={() => movePhoto(i, 1)} aria-label="後ろへ">→</button>
						<button type="button" class="{iconBtn} text-rose-600" onclick={() => removePhoto(i)} aria-label="削除">✕</button>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- 保存バー -->
	<div class="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
		<button
			type="submit"
			disabled={saving || !live}
			class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
		>
			{saving ? '保存中…' : '保存する'}
		</button>
		{#if !live}
			<span class="text-xs text-amber-700">この環境では保存できません（本番でお試しください）。</span>
		{:else if message}
			<span class="text-sm {message.ok ? 'text-emerald-700' : 'text-rose-700'}">{message.text}</span>
		{:else if dirty}
			<span class="text-xs text-amber-700">未保存の変更があります</span>
		{/if}
		<span class="ml-auto text-xs text-stone-400">{kind === 'room' ? '部屋' : 'プラン'}の紹介は autumn-rms の取引先ページにも使われます</span>
	</div>
</form>
