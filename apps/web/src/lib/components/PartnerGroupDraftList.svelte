<script lang="ts">
  // 団体予約の入力（/p/[token]/group/new）の右欄「送る照会の束」（docs/partner-group-booking.md §8.1）。
  // 行はチェックイン日の順（並べ替えは親が行う）。行の中で直せるのは日付・室数・大人の人数だけ（他は複製して直す）。
  // ⧉（または行にフォーカスして Ctrl+D）で、その行をフォームに戻してチェックイン日を +1 日にする。
  import { describeGroupStay, describeRoomAdults } from '$lib/partner-group';
  import type { GroupDraftEntry } from '$lib/partner-group-draft';

  let {
    entries,
    errors = {},
    warnings = {},
    maxRooms,
    maxNights,
    showFacility = false,
    disabled = false,
    onedit,
    onremove,
    onduplicate
  }: {
    entries: GroupDraftEntry[];
    errors?: Record<number, string[]>;
    warnings?: Record<number, string[]>;
    maxRooms: number;
    maxNights: number;
    showFacility?: boolean;
    disabled?: boolean;
    onedit: (index: number, patch: { checkIn?: string; adults?: number; roomCount?: number }) => void;
    onremove: (index: number) => void;
    onduplicate: (index: number) => void;
  } = $props();

  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const num = (v: string) => Math.round(Number(v)) || 0;
  const cell = 'rounded-md border border-stone-300 bg-white px-2 py-1 text-sm outline-none focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)] disabled:bg-stone-50';
</script>

{#if entries.length === 0}
  <p class="rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500">
    まだありません。左で条件を入れて「束に追加」（Ctrl+Enter）を押すと、ここに並びます。
  </p>
{:else}
  <ol class="grid gap-2">
    {#each entries as e, i (e.key)}
      {@const errs = errors[i] ?? []}
      {@const warns = warnings[i] ?? []}
      <li data-draft-index={i} class={`rounded-lg border bg-white p-3 text-sm ${errs.length ? 'border-rose-400' : 'border-stone-200'}`}>
        <div class="flex items-start justify-between gap-2">
          <p class="min-w-0 font-medium">
            <span class="mr-1 text-xs tabular-nums text-stone-500">{i + 1}.</span>{e.item.groupName || '（団体名なし）'}
            {#if showFacility && e.facilityName}<span class="ml-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal text-stone-700">{e.facilityName}</span>{/if}
          </p>
          <div class="flex shrink-0 gap-1">
            <button type="button" {disabled} onclick={() => onduplicate(i)} class="rounded-md border border-stone-300 px-2 py-0.5 text-xs hover:border-[var(--pt-accent)] disabled:opacity-50" title="日付を変えて複製（Ctrl+D）" aria-label={`${i + 1}件目を日付を変えて複製`}>⧉ 複製</button>
            <button type="button" {disabled} onclick={() => onremove(i)} class="rounded-md px-2 py-0.5 text-xs text-stone-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50" aria-label={`${i + 1}件目を束から外す`}>✕</button>
          </div>
        </div>
        <p class="mt-0.5 text-stone-600">{e.roomName} ・ {e.planLabel}</p>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label class="flex items-center gap-1.5">
            <span class="sr-only">{i + 1}件目のチェックイン日</span>
            <input type="date" value={e.item.checkIn} {disabled} onchange={(ev) => onedit(i, { checkIn: ev.currentTarget.value })} class={cell} />
          </label>
          <span class="text-stone-600">{e.item.nights}泊</span>
          <label class="flex items-center gap-1">
            <input type="number" min="1" max={maxRooms} value={e.item.rooms.length} {disabled} onchange={(ev) => onedit(i, { roomCount: num(ev.currentTarget.value) })} class={`${cell} w-16 tabular-nums`} aria-label={`${i + 1}件目の室数`} />
            <span>室</span>
          </label>
          <label class="flex items-center gap-1">
            <span>大人</span>
            <input type="number" min="1" max={maxRooms * 6} value={e.item.adults} {disabled} onchange={(ev) => onedit(i, { adults: num(ev.currentTarget.value) })} class={`${cell} w-16 tabular-nums`} aria-label={`${i + 1}件目の大人の人数`} />
            <span>名</span>
          </label>
        </div>
        <p class="mt-1 text-xs text-stone-500">{describeGroupStay(e.item.checkIn, e.item.nights)} ・ {describeRoomAdults(e.item.rooms)}{e.item.nights > maxNights ? `（泊数は${maxNights}泊まで）` : ''}</p>
        <p class="mt-1 text-right">
          {#if e.quote}
            <span class="font-bold tabular-nums">{yen(e.quote.total + e.quote.bathTax)}</span>
            <span class="block text-xs text-stone-500">宿泊料金 {yen(e.quote.total)}{e.quote.bathTax > 0 ? `・入湯税 ${yen(e.quote.bathTax)}` : ''}</span>
          {:else}
            <span class="text-xs text-stone-500">{e.quoteNote || '料金は宿からの回答でご案内します'}</span>
          {/if}
        </p>
        {#each errs as m}<p class="mt-1 text-xs text-rose-700" role="alert">{m}</p>{/each}
        {#each warns as m}<p class="mt-1 text-xs text-amber-800">{m}</p>{/each}
      </li>
    {/each}
  </ol>
{/if}
