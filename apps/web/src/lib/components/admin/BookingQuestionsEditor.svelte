<script lang="ts">
  // 予約時に聞く項目の編集欄（項目名・種類・選択肢・必須・聞く条件）。
  // 取引先設定（この取引先だけ追加で聞く項目）・テンプレート（/admin/booking-questions）・プラン独自（/admin/plans/[id]）で使う。
  // 聞く条件（2026-11-02）: 「宿までの交通手段」か、この項目より上の選択肢・チェックの項目の回答で、聞くかどうかを分ける
  import { conditionValuesOf, MAX_BOOKING_QUESTIONS, newBookingQuestion, TRANSPORT_FIELD, type BookingQuestion } from '$lib/booking-questions';

  let {
    questions = $bindable(),
    disabled = false,
    transportChoices = ['JR', '車', 'その他'],
    transportLabel = '宿までの交通手段'
  }: { questions: BookingQuestion[]; disabled?: boolean; transportChoices?: string[]; transportLabel?: string } = $props();

  // 条件にできる項目（交通手段と、この項目より上の選択肢・チェックの項目）
  const sourcesFor = (i: number) => [
    { id: TRANSPORT_FIELD, label: transportLabel, values: transportChoices },
    ...questions.slice(0, i).filter((q) => q.label && conditionValuesOf(q).length).map((q) => ({ id: q.id, label: q.label, values: conditionValuesOf(q) }))
  ];
  function setField(o: BookingQuestion, field: string) {
    o.showIf = field ? { field, values: [] } : null;
  }
  function toggleValue(o: BookingQuestion, v: string, on: boolean) {
    if (!o.showIf) return;
    const values = on ? [...new Set([...o.showIf.values, v])] : o.showIf.values.filter((x) => x !== v);
    o.showIf = { ...o.showIf, values };
  }

  const inputClass = 'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm disabled:bg-stone-50 disabled:text-stone-500';
  const smallBtn = 'rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50 disabled:opacity-50';

  const add = () => (questions = [...questions, newBookingQuestion()]);
  const remove = (i: number) => (questions = questions.filter((_, k) => k !== i));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j], next[i]];
    questions = next;
  };
</script>

<div class="grid gap-2">
  {#each questions as o, i (o.id)}
    {@const sources = sourcesFor(i)}
    {@const src = o.showIf ? sources.find((x) => x.id === o.showIf?.field) : undefined}
    <div class="grid gap-2 rounded-lg border border-stone-200 bg-white p-2.5 sm:grid-cols-[1fr_120px_120px_1fr_auto_auto] sm:items-center">
      <input bind:value={o.label} maxlength="60" placeholder="例: 送迎希望 / 夕食時間 / 記念日" class={inputClass} {disabled} />
      <select bind:value={o.type} class={inputClass} {disabled}>
        <option value="check">チェック</option>
        <option value="select">選択肢</option>
        <option value="text">自由入力</option>
      </select>
      <select bind:value={o.scope} class={inputClass} {disabled} title="複数室の予約で、部屋ごとに聞くか">
        <option value="booking">予約ごと</option>
        <option value="room">部屋ごと</option>
      </select>
      {#if o.type === 'select'}
        <input
          value={o.choices.join('、')}
          oninput={(e) => (o.choices = e.currentTarget.value.split(/[、,]/).map((c) => c.trim()).filter(Boolean))}
          placeholder="選択肢を「、」区切りで（例: 18:00、18:30、19:00）"
          class={inputClass}
          {disabled}
        />
      {:else}
        <span class="text-[11px] text-stone-500">{o.type === 'check' ? '「あり」にチェックする項目' : '文字で入力する項目'}</span>
      {/if}
      <label class="flex items-center gap-1.5 text-xs"><input type="checkbox" bind:checked={o.required} {disabled} />必須</label>
      <div class="flex gap-1">
        <button type="button" class={smallBtn} onclick={() => move(i, -1)} disabled={disabled || i === 0} aria-label="上へ">↑</button>
        <button type="button" class={smallBtn} onclick={() => move(i, 1)} disabled={disabled || i === questions.length - 1} aria-label="下へ">↓</button>
        <button type="button" class={smallBtn} onclick={() => remove(i)} {disabled}>削除</button>
      </div>
      <!-- 聞く条件（条件に合わないときは、必須でも聞かない） -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-stone-600 sm:col-span-6">
        <span class="shrink-0">聞く条件</span>
        <select value={o.showIf?.field ?? ''} onchange={(e) => setField(o, e.currentTarget.value)} class="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs" {disabled}>
          <option value="">いつも聞く</option>
          {#each sources as x (x.id)}<option value={x.id}>「{x.label}」が次のとき</option>{/each}
          {#if o.showIf && !src}<option value={o.showIf.field}>（条件の項目が見つかりません）</option>{/if}
        </select>
        {#if o.showIf && src}
          {#each src.values as v (v)}
            <label class="flex items-center gap-1"><input type="checkbox" checked={o.showIf.values.includes(v)} onchange={(e) => toggleValue(o, v, e.currentTarget.checked)} {disabled} />{v}</label>
          {/each}
          {#if !o.showIf.values.length}<span class="text-amber-700">どれかにチェックを入れてください（入れないと、いつも聞きます）</span>{/if}
        {/if}
      </div>
    </div>
  {/each}
  {#if questions.length < MAX_BOOKING_QUESTIONS}
    <button type="button" onclick={add} {disabled} class="justify-self-start rounded-md border border-dashed border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50 disabled:opacity-50">＋ 項目を追加</button>
  {/if}
</div>
