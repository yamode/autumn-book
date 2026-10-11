<script lang="ts">
  // 特別会員の専用ページ: 対象の会員（docs/vip-member-page.md §4.2・§13.4.5）。
  //   対象の会員（self）: 会員を検索して追加・外す（admin のみ・?/searchMembers・?/addMember・?/removeMember）
  //   家族として使える会員（family）: PMS の家族でつながっている会員。読み取りのみ（家族の編集は PMS で）
  import { enhance } from '$app/forms';
  import { askConfirm } from '$lib/components/admin/confirm-dialog.svelte';
  import { streamed } from '$lib/streamed.svelte';
  import { MEMBER_RANK_LABELS } from '$lib/partner-member-page';

  type Row = {
    member_user_id: string;
    member_code: string;
    name: string | null;
    email: string | null;
    rank_code: string;
    via: 'self' | 'family';
    withdrawn: boolean;
    created_at: string | null;
  };
  type Candidate = { user_id: string; member_code: string; rank_code: string; name: string | null; kana: string | null; email: string | null; phone: string | null };

  let {
    members,
    canEdit,
    form
  }: {
    members: Promise<Row[]>;
    canEdit: boolean;
    /** ページの form（検索の結果・エラー・追加／削除の結果） */
    form?: Record<string, unknown> | null;
  } = $props();

  const list = streamed(() => members);
  const rows = $derived(list.current ?? null);
  const selfRows = $derived((rows ?? []).filter((r) => r.via === 'self'));
  const familyRows = $derived((rows ?? []).filter((r) => r.via === 'family'));
  const f = $derived((form ?? {}) as { memberQuery?: string; candidates?: Candidate[]; memberError?: string; memberAdded?: string; memberRemoved?: string; message?: string });
  const selfIds = $derived(new Set(selfRows.map((r) => r.member_user_id)));
  const rank = (code: string) => MEMBER_RANK_LABELS[code] ?? code.toUpperCase();
  let query = $state('');
  $effect(() => {
    if (typeof f.memberQuery === 'string') query = f.memberQuery;
  });
  let busy = $state(false);
  const smallBtn = 'rounded-md border border-stone-300 bg-white px-3 py-1 text-xs hover:bg-stone-50 disabled:opacity-50';
</script>

<div class="mb-6 rounded-xl border border-stone-200 bg-white p-5">
  <h2 class="text-lg font-bold text-stone-900">対象の会員</h2>
  <p class="mt-1 text-xs leading-5 text-stone-500">
    このページを見られる会員です（公式サイトの会員ログインで入ります）。対象の会員と PMS の家族でつながっている会員も使えます（グレードは問いません・予約は予約した本人の会員予約になります）。
  </p>

  {#if f.memberAdded}
    <p class="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">対象の会員に追加しました。</p>
  {:else if f.memberRemoved}
    <p class="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">対象の会員から外しました。</p>
  {/if}

  {#if !rows}
    <div class="mt-3 space-y-2" aria-busy="true">{#each [0, 1] as i (i)}<div class="shimmer h-8 w-full opacity-70"></div>{/each}</div>
  {:else}
    <ul class="mt-3 divide-y divide-stone-100 rounded-lg border border-stone-200">
      {#each selfRows as r (r.member_user_id)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
          <a href={`/admin/members/${r.member_user_id}`} class="min-w-0 font-medium text-brand-800 hover:underline">{r.name || '（名前なし）'}</a>
          <span class="font-mono text-xs text-stone-500">{r.member_code}</span>
          <span class="rounded-full border border-stone-300 px-2 py-0.5 text-[11px] text-stone-600">{rank(r.rank_code)}</span>
          {#if r.withdrawn}<span class="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] text-stone-600">退会済み（使えません）</span>{/if}
          {#if r.email}<span class="min-w-0 break-all text-xs text-stone-500">{r.email}</span>{/if}
          {#if canEdit}
            <form
              method="POST"
              action="?/removeMember"
              class="ml-auto"
              use:enhance={async ({ cancel }) => {
                if (!(await askConfirm({ message: `${r.name || r.member_code} さまを対象の会員から外します。このページを開けなくなります（ご家族として使えている会員も、つながりが無くなれば使えなくなります）。`, confirmLabel: '外す' }))) cancel();
                return async ({ update }) => update({ reset: false });
              }}
            >
              <input type="hidden" name="member_user_id" value={r.member_user_id} />
              <button type="submit" class={smallBtn}>外す</button>
            </form>
          {/if}
        </li>
      {:else}
        <li class="px-3 py-3 text-sm text-amber-800">対象の会員がいません。会員を追加するまで、このページは誰も開けません。</li>
      {/each}
    </ul>

    {#if familyRows.length}
      <h3 class="mt-4 text-sm font-bold text-stone-800">家族として使える会員 <span class="text-xs font-normal text-stone-500">（読み取りのみ・家族の編集は PMS で）</span></h3>
      <ul class="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-stone-50/60">
        {#each familyRows as r (r.member_user_id)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <a href={`/admin/members/${r.member_user_id}`} class="min-w-0 text-brand-800 hover:underline">{r.name || '（名前なし）'}</a>
            <span class="font-mono text-xs text-stone-500">{r.member_code}</span>
            <span class="rounded-full border border-stone-300 px-2 py-0.5 text-[11px] text-stone-600">{rank(r.rank_code)}</span>
            {#if r.withdrawn}<span class="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] text-stone-600">退会済み（使えません）</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  {#if canEdit}
    <!-- 会員を探して追加（会員番号・メールアドレス・電話番号） -->
    <form
      method="POST"
      action="?/searchMembers"
      class="mt-4 flex flex-wrap items-end gap-2"
      use:enhance={() => {
        busy = true;
        return async ({ update }) => {
          busy = false;
          await update({ reset: false });
        };
      }}
    >
      <label class="block min-w-0 flex-1 text-sm">
        <span class="mb-0.5 block text-xs text-stone-500">会員を探す（会員番号・メールアドレス・電話番号）</span>
        <input name="q" bind:value={query} minlength="3" required class="w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm" autocomplete="off" />
      </label>
      <button type="submit" disabled={busy} class="rounded-lg border border-brand-800 bg-white px-4 py-1.5 text-sm text-brand-800 hover:bg-brand-50 disabled:opacity-50">{busy ? '探しています…' : '探す'}</button>
    </form>
    {#if f.memberError}
      <p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{f.memberError}</p>
    {/if}
    {#if f.candidates}
      {#if f.candidates.length === 0}
        <p class="mt-2 text-sm text-stone-500">見つかりませんでした。</p>
      {:else}
        <ul class="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200">
          {#each f.candidates as c (c.user_id)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span class="font-medium">{c.name || '（名前なし）'}</span>
              <span class="font-mono text-xs text-stone-500">{c.member_code}</span>
              <span class="rounded-full border border-stone-300 px-2 py-0.5 text-[11px] text-stone-600">{rank(c.rank_code)}</span>
              {#if c.email}<span class="min-w-0 break-all text-xs text-stone-500">{c.email}</span>{/if}
              {#if selfIds.has(c.user_id)}
                <span class="ml-auto text-xs text-stone-500">追加済み</span>
              {:else}
                <form method="POST" action="?/addMember" class="ml-auto" use:enhance={() => async ({ update }) => update({ reset: false })}>
                  <input type="hidden" name="member_user_id" value={c.user_id} />
                  <button type="submit" class={smallBtn}>対象に追加</button>
                </form>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  {:else}
    <p class="mt-3 text-xs text-stone-500">対象の会員の追加・削除は管理者だけができます。</p>
  {/if}
</div>
