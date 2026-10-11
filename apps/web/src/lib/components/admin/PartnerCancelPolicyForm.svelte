<script lang="ts">
  // 特別会員の専用ページ: 施設ごとのキャンセル方式と専用ページの規定（docs/vip-member-page.md §6.3・D1・§13.4.5）。
  //   方式: お客さまに有利な方（既定）／専用ページの規定／会員グレードの規定
  //   規定: 「○日前から ○%」の段（rate は 0〜1 で持つ。画面は %）。会員グレードの規定の方式では使わない
  // 予約の時点の方式と規定が予約（部屋ごとのキャンセル規定）に写るので、ここを変えても既に入った予約は変わらない。
  // 値は親（取引先詳細の施設タブ）が持ち、変更は onchange で返す（保存は施設タブの保存 ?/saveFacility の facility_booking）。
  import {
    CANCEL_POLICY_LABELS,
    CANCEL_POLICY_MODES,
    CANCEL_POLICY_NOTES,
    describeCancelRule,
    MAX_MEMBER_CANCEL_RULES,
    normalizeCancelPolicyMode,
    type CancelPolicyMode,
    type MemberCancelRule
  } from '$lib/partner-member-page';

  let {
    mode,
    rules,
    disabled = false,
    onchange
  }: {
    mode: CancelPolicyMode | undefined;
    rules: MemberCancelRule[] | undefined;
    disabled?: boolean;
    onchange: (mode: CancelPolicyMode, rules: MemberCancelRule[]) => void;
  } = $props();

  const current = $derived(normalizeCancelPolicyMode(mode));
  const list = $derived(rules ?? []);
  const DAYS = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90];
  const pct = (rate: number) => Math.round(rate * 1000) / 10;

  function setMode(m: CancelPolicyMode) {
    onchange(m, list);
  }
  function setRule(i: number, patch: Partial<MemberCancelRule>) {
    onchange(
      current,
      list.map((r, k) => (k === i ? { ...r, ...patch } : r))
    );
  }
  function addRule() {
    if (list.length >= MAX_MEMBER_CANCEL_RULES) return;
    // 今ある段より手前（日数の少ない方）の段から始める
    const used = new Set(list.map((r) => r.days_before));
    const days = DAYS.find((d) => !used.has(d)) ?? 0;
    onchange(current, [...list, { days_before: days, rate: days === 0 ? 1 : 0.2 }]);
  }
  function removeRule(i: number) {
    onchange(
      current,
      list.filter((_, k) => k !== i)
    );
  }
  // 表示用（日数の多い順）
  const sorted = $derived([...list].map((r, i) => ({ r, i })).sort((a, b) => b.r.days_before - a.r.days_before));
  const dupDays = $derived(new Set(list.map((r) => r.days_before)).size !== list.length);
</script>

<section class="rounded-lg border border-stone-200 bg-stone-50 p-4">
  <h3 class="text-[15px] font-bold text-stone-800">キャンセル規定 <span class="text-xs font-normal text-stone-500">（この施設・会員の公式予約のキャンセル料）</span></h3>
  <p class="mt-1 text-[11px] leading-5 text-stone-500">予約の時点の方式と規定が予約に写ります。変えても、すでに入っている予約のキャンセル料は変わりません。</p>
  <fieldset {disabled} class="mt-3 grid gap-2">
    {#each CANCEL_POLICY_MODES as m (m)}
      <label class={`flex cursor-pointer gap-2 rounded-md border bg-white p-2.5 text-sm ${current === m ? 'border-brand-800' : 'border-stone-200'}`}>
        <input type="radio" name="member_cancel_mode" value={m} checked={current === m} onchange={() => setMode(m)} class="mt-0.5" />
        <span>
          <span class="font-medium">{CANCEL_POLICY_LABELS[m]}{m === 'favorable' ? '（既定）' : ''}</span>
          <span class="block text-[11px] text-stone-500">{CANCEL_POLICY_NOTES[m]}</span>
        </span>
      </label>
    {/each}

    {#if current !== 'rank'}
      <div class="mt-2 rounded-md border border-stone-200 bg-white p-3">
        <p class="text-sm font-medium text-stone-800">専用ページの規定</p>
        {#if current === 'favorable'}
          <p class="mt-1 text-[11px] leading-5 text-stone-500">「お客さまに有利な方」では、専用ページの規定に当てはまる段が無い日（最初の段より前など）は、キャンセル料なし（0%）として会員グレードの規定（プランの規定があればそれ）と比べます。</p>
        {/if}
        {#if list.length === 0}
          <p class="mt-1 text-xs text-stone-500">段がありません（{current === 'page' ? '公式と同じ規定（プランの規定 → 会員グレードの規定）で計算します' : '会員グレードの規定（プランの規定があればそれ）で計算します'}）。</p>
        {:else}
          <ul class="mt-2 grid gap-1.5">
            {#each sorted as { r, i } (i)}
              <li class="flex flex-wrap items-center gap-2 text-sm">
                <select value={r.days_before} onchange={(e) => setRule(i, { days_before: Number(e.currentTarget.value) })} class="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm">
                  {#each [...new Set([...DAYS, r.days_before])].sort((a, b) => b - a) as d (d)}<option value={d}>{d === 0 ? '当日' : d === 1 ? '前日から' : `${d}日前から`}</option>{/each}
                </select>
                <span class="inline-flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={pct(r.rate)}
                    onchange={(e) => setRule(i, { rate: Math.min(100, Math.max(0, Number(e.currentTarget.value) || 0)) / 100 })}
                    class="w-20 rounded-md border border-stone-300 bg-white px-2 py-1 text-right text-sm tabular-nums"
                  />%
                </span>
                <button type="button" onclick={() => removeRule(i)} class="rounded-md border border-stone-300 bg-white px-2 py-0.5 text-xs text-stone-600 hover:bg-stone-50">削除</button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if dupDays}<p class="mt-1 text-xs text-rose-700">同じ日数の段があります。保存すると後の段だけが残ります。</p>{/if}
        {#if list.length < MAX_MEMBER_CANCEL_RULES}
          <button type="button" onclick={addRule} class="mt-2 rounded-md border border-dashed border-stone-300 bg-white px-3 py-1 text-xs hover:bg-stone-50">＋ 段を追加</button>
        {/if}
        {#if list.length}
          <p class="mt-2 text-[11px] text-stone-500">会員に見える形: {[...list].sort((a, b) => b.days_before - a.days_before).map(describeCancelRule).join('・')}</p>
        {/if}
      </div>
    {/if}
  </fieldset>
</section>
