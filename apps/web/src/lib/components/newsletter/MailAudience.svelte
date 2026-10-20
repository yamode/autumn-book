<script lang="ts">
 import type {AudienceFilter} from '$lib/newsletter-audience';
 let {value=$bindable({}),disabled=false}:{value:AudienceFilter;disabled?:boolean}=$props();
 $effect(()=>{if(value.engagement&&!value.days)value.days='30';});
</script>
<fieldset {disabled} class="space-y-3">
 <p class="text-sm text-stone-500">指定した条件をすべて満たす配信可能な方が対象です。空欄は条件に含めません。</p>
 <label>メールアドレスを含む<input bind:value={value.email}/></label><label>名前を含む<input bind:value={value.name}/></label>
 <div class="grid gap-3 sm:grid-cols-2"><label>カスタム項目名<input bind:value={value.field}/></label><label>値（完全一致）<input bind:value={value.value}/></label></div>
 <div class="grid gap-3 sm:grid-cols-2"><label>Book登録日・開始<input type="date" bind:value={value.after}/></label><label>Book登録日・終了<input type="date" bind:value={value.before}/></label></div>
 <label>配信への反応<select bind:value={value.engagement}><option value="">指定なし</option><option value="opened">開封あり</option><option value="not_opened">開封なし（未配信も含む）</option><option value="clicked">クリックあり</option><option value="not_clicked">クリックなし（未配信も含む）</option></select></label>
 {#if value.engagement}<label>対象期間<select bind:value={value.days}><option value="30">30日</option><option value="60">60日</option><option value="90">90日</option></select></label>{/if}
 <p class="text-sm text-stone-500">登録日は日本時間。反応はBookでの本配信のみを参照します。受信環境や追跡設定により実際の閲覧とは異なる場合があります。</p>
</fieldset>
<style>fieldset{border:0;padding:0;min-width:0}label{display:block;font-size:14px}input,select{display:block;width:100%;margin-top:6px;border:1px solid #d6d3d1;border-radius:7px;padding:10px;background:white;font-size:14px}</style>
