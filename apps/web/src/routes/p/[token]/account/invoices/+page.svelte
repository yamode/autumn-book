<script lang="ts">
  // 取引先専用ページ: アカウント → 請求書。月ごとの利用明細書＋適格請求書をダウンロードする。
  import { page } from '$app/stores';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
  const ym = (iso: string) => `${Number(iso.slice(0, 4))}年${Number(iso.slice(5, 7))}月`;
  const ymd = (iso: string) => `${Number(iso.slice(0, 4))}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
  const href = (id: string, format: 'pdf' | 'html') => `/p/${$page.params.token}/account/invoices/${id}?format=${format}`;
</script>

<svelte:head>
  <title>請求書 | アカウント | {data.portal.facilityName}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<section>
  <p class="text-sm leading-6 text-stone-600">
    毎月末日の15時ごろ、その月にチェックアウトしたご予約の請求書（利用明細書＋適格請求書）を発行し、メールでお送りします。ここからいつでもダウンロードできます。
  </p>

  {#if data.invoices.length === 0}
    <p class="mt-5 rounded-xl border border-stone-200 bg-white px-5 py-8 text-center text-stone-500">
      まだ発行された請求書はありません。<br />毎月末日の15時ごろ、その月にチェックアウトしたご予約の請求書を発行し、メールでお送りします。
    </p>
  {:else}
    <!-- PC は表、スマホはカード -->
    <div class="mt-5 hidden overflow-x-auto rounded-xl border border-stone-200 bg-white sm:block">
      <table class="w-full text-sm">
        <thead class="bg-stone-50 text-left text-stone-500">
          <tr>
            <th class="px-4 py-2.5 font-medium">対象月</th>
            <th class="px-4 py-2.5 font-medium">請求書番号</th>
            <th class="px-4 py-2.5 font-medium">発行日</th>
            <th class="px-4 py-2.5 text-right font-medium">ご請求額</th>
            <th class="px-4 py-2.5 font-medium">お支払期限</th>
            <th class="px-4 py-2.5 font-medium">ダウンロード</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-stone-100">
          {#each data.invoices as inv (inv.id)}
            <tr>
              <td class="whitespace-nowrap px-4 py-3 font-medium">{ym(inv.period)}</td>
              <td class="whitespace-nowrap px-4 py-3 font-mono text-xs">{inv.invoiceNo}</td>
              <td class="whitespace-nowrap px-4 py-3">{ymd(inv.issueDate)}</td>
              <td class="whitespace-nowrap px-4 py-3 text-right">
                {#if inv.billedTotal > 0}{yen(inv.billedTotal)}{:else}<span class="text-stone-500">0円（利用明細書のみ）</span>{/if}
              </td>
              <td class="whitespace-nowrap px-4 py-3">{inv.billedTotal > 0 ? ymd(inv.dueDate) : '—'}</td>
              <td class="whitespace-nowrap px-4 py-3">
                <a href={href(inv.id, 'pdf')} class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-500">PDF</a>
                <a href={href(inv.id, 'html')} target="_blank" rel="noopener noreferrer" class="ml-1 rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50">印刷用</a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <ul class="mt-5 space-y-3 sm:hidden">
      {#each data.invoices as inv (inv.id)}
        <li class="rounded-xl border border-stone-200 bg-white p-4">
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-bold">{ym(inv.period)}分</span>
            <span class="font-mono text-xs text-stone-500">{inv.invoiceNo}</span>
          </div>
          <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt class="text-stone-500">ご請求額</dt>
            <dd>{#if inv.billedTotal > 0}{yen(inv.billedTotal)}{:else}0円（利用明細書のみ）{/if}</dd>
            <dt class="text-stone-500">発行日</dt>
            <dd>{ymd(inv.issueDate)}</dd>
            {#if inv.billedTotal > 0}
              <dt class="text-stone-500">お支払期限</dt>
              <dd>{ymd(inv.dueDate)}</dd>
            {/if}
          </dl>
          <div class="mt-3 flex gap-2">
            <a href={href(inv.id, 'pdf')} class="flex-1 rounded-md bg-accent-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-accent-500">PDF</a>
            <a href={href(inv.id, 'html')} target="_blank" rel="noopener noreferrer" class="flex-1 rounded-md border border-stone-300 px-3 py-2 text-center text-sm text-stone-600 hover:bg-stone-50">印刷用</a>
          </div>
        </li>
      {/each}
    </ul>
    <p class="mt-3 text-xs leading-5 text-stone-500">「印刷用」はブラウザで開きます。PDF が開けないときは、印刷用を開いてブラウザの印刷から PDF に保存してください。</p>
  {/if}
</section>
