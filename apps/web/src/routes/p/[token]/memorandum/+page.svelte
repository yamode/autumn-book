<script lang="ts">
  import { partnerTitle } from '$lib/partner-title';
  // 取引先専用ページ: 覚書。宿が書いた取引条件のまとめ（本文）と、宿・貴社の双方が保存するファイル。
  // 本文はプレーンテキスト（改行はそのまま表示。リンクの自動変換はしない）。
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string; uploaded?: string; deleted?: boolean } } = $props();

  const token = $derived($page.params.token);
  const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }) : '');
  let uploading = $state(false);
  let deleting = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let clientError = $state('');
  const input = 'w-full rounded-md border border-stone-300 bg-white px-3 py-2 outline-none transition focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)]';
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, '覚書')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6">
  <h2 class="text-2xl font-bold">覚書</h2>
  <p class="mt-1 text-sm text-stone-500">貴社との取引条件のまとめと、やりとりする書類です。</p>

  {#if form?.message}
    <p class="mt-4 rounded-xl border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700">{form.message}</p>
  {:else if form?.uploaded}
    <p class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3 text-[var(--pt-accent)]">「{form.uploaded}」を保存しました。</p>
  {:else if form?.deleted}
    <p class="mt-4 rounded-xl border border-stone-300 bg-white px-4 py-3">ファイルを削除しました。</p>
  {/if}

  <!-- 本文（宿が書く） -->
  <section class="mt-5 rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-lg font-bold">取引条件</h3>
      {#if data.memorandum.updatedAt}<p class="text-xs text-stone-500">最終更新 {dt(data.memorandum.updatedAt)}</p>{/if}
    </div>
    {#if data.memorandum.text}
      <div class="mt-3 whitespace-pre-wrap break-words leading-7">{data.memorandum.text}</div>
    {:else}
      <p class="mt-3 text-stone-500">まだ登録されていません。</p>
    {/if}
  </section>

  <!-- ファイル -->
  <section class="mt-5 rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
    <h3 class="text-lg font-bold">ファイル</h3>
    {#if data.documents.length === 0}
      <p class="mt-3 text-stone-500">保存されたファイルはありません。</p>
    {:else}
      <ul class="mt-3 divide-y divide-stone-200">
        {#each data.documents as d (d.id)}
          <li class="flex flex-wrap items-start justify-between gap-3 py-3">
            <div class="min-w-0 flex-1">
              <a href={`/p/${token}/memorandum/files/${d.id}`} target="_blank" rel="noopener" class="break-all font-medium text-brand-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-900">{d.fileName}</a>
              <p class="mt-0.5 text-xs text-stone-500">
                {d.size}{d.size ? ' ・ ' : ''}{d.uploader} ・ {dt(d.createdAt)}
              </p>
              {#if d.note}<p class="mt-1 whitespace-pre-wrap break-words text-sm text-stone-600">{d.note}</p>{/if}
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <a href={`/p/${token}/memorandum/files/${d.id}`} download class="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50">ダウンロード</a>
              {#if d.canDelete}
                <form
                  method="POST"
                  action="?/delete"
                  use:enhance={({ cancel }) => {
                    if (!confirm(`「${d.fileName}」を削除します。元に戻せません。よろしいですか？`)) {
                      cancel();
                      return;
                    }
                    deleting = d.id;
                    return async ({ update }) => {
                      deleting = null;
                      await update();
                    };
                  }}
                >
                  <input type="hidden" name="id" value={d.id} />
                  <button type="submit" disabled={deleting === d.id} class="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50">{deleting === d.id ? '削除中…' : '削除'}</button>
                </form>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- アップロード（保存者は貴社のログインID） -->
    <form
      method="POST"
      action="?/upload"
      enctype="multipart/form-data"
      use:enhance={({ cancel }) => {
        // 上限を超えるファイルは送る前に止める（サーバでも確かめる）
        clientError = '';
        const f = fileInput?.files?.[0];
        if (f && f.size > data.maxBytes) {
          clientError = `1ファイル ${data.maxBytesLabel} までです。`;
          cancel();
          return;
        }
        uploading = true;
        return async ({ result, update }) => {
          uploading = false;
          await update({ reset: result.type === 'success' });
        };
      }}
      class="mt-5 grid gap-3 rounded-xl bg-stone-50 p-4"
    >
      <p class="font-medium">ファイルを保存する</p>
      <label class="block">
        <span class="mb-1 block text-sm font-medium">ファイル</span>
        <input bind:this={fileInput} type="file" name="file" required accept={data.accept} class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-800 file:px-3 file:py-1.5 file:text-white" />
        <span class="mt-1 block text-xs text-stone-500">PDF・画像・Word・Excel・PowerPoint・CSV・テキスト・ZIP、1ファイル {data.maxBytesLabel} まで。宿からも見えます。</span>
      </label>
      <label class="block">
        <span class="mb-1 block text-sm font-medium">メモ（任意）</span>
        <input name="note" maxlength="200" placeholder="例: 2026年度 契約書（押印済み）" class={input} />
      </label>
      {#if clientError}<p class="text-sm text-rose-700">{clientError}</p>{/if}
      <div>
        <button type="submit" disabled={uploading} class="rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-50">{uploading ? '保存しています…' : '保存する'}</button>
      </div>
    </form>
  </section>
</main>
