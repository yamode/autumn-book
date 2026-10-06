<script lang="ts">
  // 取引先予約をスタッフが取り消すときのキャンセル料の選択（2026-10-06）。
  // 予約詳細（/admin/reservations/[code]）と取引先詳細（/admin/partners/[id]）の取消フォームの中に置く。
  // 送る値: feeMode（rule / no_show / custom / waive）・customFee・feeNote・refund（支払済みのとき）
  type Preview = {
    base: number;
    rate: number;
    fee: number;
    basis: string;
    noShowRate: number;
    noShowFee: number;
    settlement: 'none' | 'invoice' | 'refund' | 'card';
    refund: { paid: number; kept: number; refund: number } | null;
  };
  // paid: 予約時決済で支払済み / card: チェックイン日決済でカード登録済み（未請求）
  let { preview, paid = false, card = false, invoiceMonth = '' }: { preview: Preview | null; paid?: boolean; card?: boolean; invoiceMonth?: string } = $props();

  let mode = $state<'rule' | 'no_show' | 'custom' | 'waive'>('rule');
  let custom = $state('');
  const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
  const fee = $derived(
    !preview ? 0 : mode === 'rule' ? preview.fee : mode === 'no_show' ? preview.noShowFee : mode === 'custom' ? Math.max(0, Math.round(Number(custom) || 0)) : 0
  );
  // 精算の見込み（サーバの settlementOf と同じ考え方。支払済みは差し引いて返金、カード登録はカードへ、それ以外は請求書）
  const how = $derived(
    !preview || fee <= 0
      ? ''
      : paid
        ? 'お支払い済みの金額から差し引いて返金します（直販と同じく予約時決済割引の分も差し引きます）'
        : card
          ? '登録カードへ請求します（失敗したら月末の請求書へ回します）'
          : `${invoiceMonth ? `${invoiceMonth}分の` : ''}月末の請求書でご請求します（不課税）`
  );
</script>

{#if preview}
  <fieldset class="space-y-1.5 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm">
    <legend class="px-1 text-xs text-stone-600">キャンセル料（基準: 予約金額 {yen(preview.base)}・割引前・入湯税を除く）</legend>
    <label class="flex items-center gap-2"><input type="radio" name="feeMode" value="rule" bind:group={mode} />規定どおり（{preview.basis} {preview.rate}% → {yen(preview.fee)}）</label>
    <label class="flex items-center gap-2"><input type="radio" name="feeMode" value="no_show" bind:group={mode} />不泊（{preview.noShowRate}% → {yen(preview.noShowFee)}）</label>
    <label class="flex flex-wrap items-center gap-2">
      <input type="radio" name="feeMode" value="custom" bind:group={mode} />金額を変える
      <input name="customFee" type="number" min="0" max={preview.base} step="1" inputmode="numeric" bind:value={custom} onfocus={() => (mode = 'custom')} class="w-28 rounded-md border border-stone-300 px-2 py-1 text-sm" />円
    </label>
    <label class="flex items-center gap-2"><input type="radio" name="feeMode" value="waive" bind:group={mode} />免除する（施設都合など）</label>
    {#if mode === 'custom' || mode === 'waive'}
      <input name="feeNote" maxlength="500" placeholder="変更・免除の理由（社内メモ）" class="w-full rounded-md border border-stone-300 px-2 py-1 text-sm" />
    {/if}
    <p class="text-xs text-stone-600">キャンセル料 <span class="font-bold">{fee > 0 ? yen(fee) : 'なし'}</span>{how ? `・${how}` : ''}</p>
  </fieldset>
{/if}
