<script lang="ts">
  // 予約時に聞く項目の編集欄（項目名・種類・選択肢・必須）。
  // 取引先設定（この取引先だけ追加で聞く項目）・テンプレート（/admin/booking-questions）・プラン独自（/admin/plans/[id]）で使う。
  import { MAX_BOOKING_QUESTIONS, newBookingQuestion, type BookingQuestion } from '$lib/booking-questions';

  let { questions = $bindable(), disabled = false }: { questions: BookingQuestion[]; disabled?: boolean } = $props();

  const inputClass = 'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm disabled:bg-stone-50 disabled:text-stone-500';
  const smallBtn = 'rounded-md border border-stone-300 bg-white px-3 py-1 text-xs hover:bg-stone-50 disabled:opacity-50';

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
    <div class="grid gap-2 rounded-lg border border-stone-200 bg-white p-2.5 sm:grid-cols-[1fr_130px_1fr_auto_auto] sm:items-center">
      <input bind:value={o.label} maxlength="60" placeholder="例: 送迎希望 / 夕食時間 / 記念日" class={inputClass} {disabled} />
      <select bind:value={o.type} class={inputClass} {disabled}>
        <option value="check">チェック</option>
        <option value="select">選択肢</option>
        <option value="text">自由入力</option>
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
    </div>
  {/each}
  {#if questions.length < MAX_BOOKING_QUESTIONS}
    <button type="button" onclick={add} {disabled} class="justify-self-start rounded-md border border-dashed border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50 disabled:opacity-50">＋ 項目を追加</button>
  {/if}
</div>
