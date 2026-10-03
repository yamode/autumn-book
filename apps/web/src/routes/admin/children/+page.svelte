<script lang="ts">
  // お子様の受け入れ（施設で1件・全プラン共通）。区分と内容の表＋補足。
  // 区分も内容も自由入力（例: 小学生高学年 → 「大人料金の70%」「受入不可」）。内容が空の行は保存しない。
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';

  let { data, form } = $props();

  type Row = { key: number; label: string; value: string };
  let seq = 0;
  const toRows = (list: { label: string; value: string }[]): Row[] => list.map((r) => ({ key: seq++, label: r.label, value: r.value }));
  const initial = untrack(() => data.policy);
  let rows = $state<Row[]>(toRows(initial?.rows.length ? initial.rows : untrack(() => data.template)));
  let note = $state(initial?.note ?? '');
  let saving = $state(false);
  let dirty = $state(false);
  const payload = $derived(JSON.stringify({ rows: rows.map((r) => ({ label: r.label, value: r.value })), note }));

  function addRow() {
    if (rows.length >= 20) return;
    rows = [...rows, { key: seq++, label: '', value: '' }];
    dirty = true;
  }
  function removeRow(i: number) {
    rows = rows.filter((_, k) => k !== i);
    dirty = true;
  }
  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    rows = next;
    dirty = true;
  }
  const PRESETS = ['受入不可', '受入可', '不可', '可'];
  const inputClass = 'w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm focus:border-stone-500 focus:outline-none';
  const smallBtn = 'rounded-md border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-50 disabled:opacity-40';
</script>

<svelte:head><title>お子様の受け入れ ｜ 山人管理</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-6">
  <h1 class="text-lg font-bold text-stone-800">お子様の受け入れ — {data.facilityName}</h1>
  <p class="mt-1 text-xs leading-5 text-stone-500">
    区分ごとの受け入れ可否です。<strong class="font-medium text-stone-700">この施設の全プランで共通</strong>で、取引先ページのプラン紹介「お子様について」に表として出ます。
    内容が空の行は保存しません。何も設定していないときは、プランの区分（子供不可）から案内文を出します。
  </p>

  {#if !data.live || data.loadError}
    <p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{data.loadError}</p>
  {/if}
  {#if form?.error}
    <p class="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{form.error}</p>
  {:else if form?.saved && !dirty}
    <p class="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">保存しました。</p>
  {/if}

  <form
    method="POST"
    action="?/save"
    class="mt-5 grid gap-4"
    oninput={() => (dirty = true)}
    use:enhance={() => {
      saving = true;
      return async ({ update, result }) => {
        await update({ reset: false });
        saving = false;
        if (result.type === 'success') dirty = false;
      };
    }}
  >
    <input type="hidden" name="payload" value={payload} />

    <section class="rounded-lg border border-stone-200 bg-white p-4">
      <div class="mb-2 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2 px-1 text-xs text-stone-500">
        <span>区分</span><span>内容</span><span class="w-[7.5rem]"></span>
      </div>
      <div class="grid gap-2">
        {#each rows as r, i (r.key)}
          <div class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-start gap-2">
            <input bind:value={r.label} maxlength="60" placeholder="例: 小学生高学年" class={inputClass} />
            <div>
              <input bind:value={r.value} maxlength="200" placeholder="例: 受入不可／大人料金の70%" class={inputClass} list="child-presets" />
            </div>
            <div class="flex gap-1">
              <button type="button" class={smallBtn} disabled={i === 0} onclick={() => move(i, -1)} aria-label="上へ">↑</button>
              <button type="button" class={smallBtn} disabled={i === rows.length - 1} onclick={() => move(i, 1)} aria-label="下へ">↓</button>
              <button type="button" class={smallBtn} onclick={() => removeRow(i)}>削除</button>
            </div>
          </div>
        {/each}
      </div>
      <datalist id="child-presets">
        {#each PRESETS as p}<option value={p}></option>{/each}
      </datalist>
      {#if rows.length < 20}
        <button type="button" onclick={addRow} class="mt-3 rounded-md border border-dashed border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50">＋ 区分を追加</button>
      {/if}
    </section>

    <label class="grid gap-1">
      <span class="text-xs text-stone-500">補足（表の下に出ます。任意）</span>
      <textarea bind:value={note} rows="3" maxlength="1000" placeholder="例: 13歳未満のお子様はご利用いただけません。" class={inputClass}></textarea>
    </label>

    <div class="flex items-center gap-3">
      <button type="submit" disabled={saving || !data.live} class="rounded-lg bg-stone-800 px-5 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">
        {saving ? '保存中…' : '保存する'}
      </button>
      {#if dirty}<span class="text-xs text-amber-700">未保存の変更があります</span>{/if}
      {#if data.updatedAt}<span class="ml-auto text-xs text-stone-400">最終更新 {new Date(data.updatedAt).toLocaleString('ja-JP')}</span>{/if}
    </div>
  </form>
</div>
