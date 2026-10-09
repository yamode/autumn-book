<script lang="ts">
  import { partnerTitle } from '$lib/partner-title';
  // 取引先専用ページ: アカウント → 担当者情報。予約担当者（ご予約者）の情報を設定する（見出し・タブは ./+layout.svelte）。
  // ここで保存した内容が予約フォームの「予約者」に最初から入り、予約確認などのメールはこのメールアドレスへ届く。
  import { enhance } from '$app/forms';
  import type { PartnerBooker } from '$lib/partner-booking';
  import { streamed } from '$lib/streamed.svelte';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string; saved?: boolean; booker?: PartnerBooker } } = $props();

  // 担当者情報は後から届く（届くまでは入力欄の枠を出す）
  const profile = streamed(() => data.profile);
  // 入力に失敗したときは送った値を残す（保存できたときは保存後の値）
  const values = $derived(form?.booker ?? profile.current?.booker ?? null);
  let saving = $state(false);
  const input = 'w-full rounded-md border border-stone-300 bg-white px-3 py-2 outline-none transition focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)]';
  const label = 'mb-1 block text-sm font-medium';
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, '担当者情報')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<section>
  {#if form?.message}
    <p class="mb-4 rounded-xl border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700">{form.message}</p>
  {:else if form?.saved}
    <p class="mb-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3 text-[var(--pt-accent)]">予約担当者の情報を保存しました。</p>
  {/if}

  <form
    method="POST"
    use:enhance={() => {
      saving = true;
      return async ({ update }) => {
        saving = false;
        await update({ reset: false });
      };
    }}
    class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6"
  >
    <h3 class="text-lg font-bold">予約担当者（ご予約者）</h3>
    <p class="mt-1 text-sm leading-6 text-stone-600">
      予約フォームの『ご予約者』に最初から入ります。予約確認・取消・お支払いに関するメールはこのメールアドレスへお送りします（ご宿泊者様へはお送りしません）。
    </p>
    {#if !values}
      {#if profile.current?.error}
        <p class="mt-4 rounded-lg bg-rose-700/5 px-4 py-3 text-sm text-rose-700">{profile.current.error}</p>
      {:else}
        <div class="mt-4 grid gap-4 sm:grid-cols-2" aria-busy="true">
          {#each [0, 1, 2, 3] as i (i)}<div class="space-y-1.5"><div class="shimmer h-3.5 w-20"></div><div class="shimmer h-10 w-full"></div></div>{/each}
        </div>
      {/if}
    {:else}
      {#key values}
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <label class="block"><span class={label}>お名前 <em class="req">必須</em></span><input name="name" value={values.name} required maxlength="60" autocomplete="name" class={input} /></label>
          <label class="block"><span class={label}>フリガナ</span><input name="kana" value={values.kana} maxlength="60" class={input} /></label>
          <label class="block"><span class={label}>部署</span><input name="department" value={values.department} maxlength="60" autocomplete="organization-title" class={input} /></label>
          <label class="block"><span class={label}>電話番号</span><input name="phone" type="tel" value={values.phone} minlength="8" maxlength="20" placeholder="03-1234-5678" autocomplete="tel" class={input} /></label>
          <label class="block sm:col-span-2"><span class={label}>メールアドレス <em class="req">必須</em></span><input name="email" type="email" value={values.email} required maxlength="254" autocomplete="email" class={input} /></label>
        </div>
      {/key}
    {/if}
    <button type="submit" disabled={saving || !values} class="mt-5 rounded-lg bg-accent-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-50">{saving ? '保存しています…' : '保存する'}</button>
  </form>
</section>

<style>
  .req {
    margin-left: 0.25rem;
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--color-rose-700, #be123c) 12%, transparent);
    padding: 0 0.3rem;
    font-size: 0.7rem;
    font-style: normal;
    color: var(--color-rose-700, #be123c);
  }
</style>
