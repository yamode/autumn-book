<script lang="ts">
 import {invalidateAll} from '$app/navigation';
 type Booking={id:string;group_code:string;guest_name:string;check_in:string|null;check_out:string|null;status:string;reservation_codes?:string;linked?:boolean;email_match?:boolean;pending_count?:number;copied_count?:number;copied_message_ids?:string[]};
 let {inquiryId,links,error=''}:{inquiryId:string;links:Booking[];error?:string}=$props();
 let open=$state(false),query=$state(''),busy=$state(false),searching=$state(false),searched=$state<string|null>(null),results=$state<Booking[]>([]),message=$state('');
 // 検索が一瞬で終わっても「探した」ことが目に見えるよう、表示は最短この時間だけ続ける
 const MIN_SEARCH_MS=450;
 const pmsUrl=(id:string)=>'https://autumn-pms.yamado.app/reservations/'+id+'?facility=yamado';
 async function api(action:string,extra:Record<string,unknown>={}){
  const res=await fetch('/admin/inquiries/'+inquiryId+'/pms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...extra})}),value=await res.json();
  if(!res.ok)throw Error(value.error??'連携できませんでした。');return value.data;
 }
 async function search(){
  if(busy)return;busy=true;searching=true;message='';const source=inquiryId,q=query.trim(),started=Date.now();
  try{
   const value=await api('search',{query});
   const wait=MIN_SEARCH_MS-(Date.now()-started);if(wait>0)await new Promise(r=>setTimeout(r,wait));
   if(source===inquiryId){results=value;searched=q;}
  }catch(e){message=String(e);}finally{busy=false;searching=false;}
 }
 async function link(id:string){if(busy)return;busy=true;message='';try{await api('link',{group:id});results=results.map(r=>r.id===id?{...r,linked:true}:r);await invalidateAll();message='予約に紐付けました。下の「やり取り」の各メールから、PMSの事前応対へ転記できます。';}catch(e){message=String(e);}finally{busy=false;}}

</script>
<section class="pms-link" aria-label="PMSの予約連携">
 <header><div><h2>予約・PMS連携</h2><p>予約に紐付けると、下の「やり取り」の各メールから事前応対記録へ転記できます。</p></div><button type="button" disabled={busy||!!error} onclick={()=>{open=!open;if(open&&!results.length)void search();}}>{open?'検索を閉じる':'予約を探す'}</button></header>
 {#if error}<p role="alert">{error}</p>{/if}
 {#each links as booking(booking.id)}
 <div class="booking-wrap">
 <div class="linked-booking"><div><a href={pmsUrl(booking.id)} target="_blank" rel="noopener noreferrer">#{booking.group_code} · {booking.guest_name} ↗</a><p>{booking.check_in??'宿泊日未設定'} ～ {booking.check_out??''}{booking.status==='cancelled'?' · 取消済み':''}</p><span>転記済み {booking.copied_count??0}件 · 未転記 {booking.pending_count??0}件</span></div></div>
</div>
 {/each}
 {#if open}<div class="search-panel"><form onsubmit={e=>{e.preventDefault();void search();}}><label for="pms-booking-search">予約番号・氏名・メールアドレス</label><div><input id="pms-booking-search" bind:value={query} maxlength="100" placeholder="空欄ならメールアドレスが一致する予約"/><button type="submit" class="search-btn" disabled={busy}>{#if searching}<span class="spinner" aria-hidden="true"></span>検索中…{:else}検索{/if}</button></div></form><div class="search-results" class:loading={searching} aria-busy={searching}>{#if searching}<div class="progress" aria-hidden="true"><span></span></div><p class="status" role="status">{query.trim()?`「${query.trim()}」で予約を探しています…`:'メールアドレスが一致する予約を探しています…'}</p>{#if !results.length}{#each [0,1,2] as i(i)}<div class="skeleton" aria-hidden="true"><span><i style="width:42%"></i><i style="width:64%"></i></span><i class="sk-btn"></i></div>{/each}{/if}{:else if searched!==null && results.length}<p class="status" role="status">{searched?`「${searched}」`:'メールアドレスの一致'}で {results.length}件見つかりました</p>{/if}{#each results as booking(booking.id)}<div><span><strong>#{booking.group_code} · {booking.guest_name}</strong><small>{booking.check_in??'宿泊日未設定'} ～ {booking.check_out??''} · {booking.reservation_codes??''}{booking.status==='cancelled'?' · 取消済み':''}</small>{#if booking.email_match}<small>メールアドレスが一致</small>{/if}</span><button type="button" disabled={busy||booking.linked||links.some(l=>l.id===booking.id)} onclick={()=>void link(booking.id)}>{booking.linked||links.some(l=>l.id===booking.id)?'紐付け済み':'この予約に紐付ける'}</button></div>{:else}{#if !searching && searched!==null}<p>該当する予約はありません。予約番号や氏名でも検索できます。</p>{/if}{/each}</div></div>{/if}
 {#if message}<p class="notice" role="status">{message}</p>{/if}
 <p class="footnote">メールの引用部分、送信前の下書き・受付控え・内部通知は転記しません。添付ファイルはBookの元のやりとりから確認できます。</p>
</section>
<style>
 .pms-link{padding:20px;border:1px solid #dfe6da;border-radius:12px;background:#fff;margin-bottom:24px;font-size:14px;color:#3a4d3e}header{display:flex;justify-content:space-between;gap:16px;align-items:center}h2{font-size:16px;font-weight:600}header p,.footnote{color:#788570;line-height:1.7;margin-top:5px}.footnote{margin-top:14px;font-size:14px}button{border:1px solid #cbd5c4;border-radius:7px;padding:9px 12px;background:#f8faf5;min-height:40px;font-size:14px;white-space:nowrap}button:hover{background:#e8efdf}button:disabled{opacity:.45;cursor:default}.linked-booking{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid #edf0e8}.linked-booking a{font-weight:600;text-decoration:underline;color:#365b3c}.linked-booking p,.linked-booking span{display:block;font-size:14px;margin-top:5px;color:#788570}.search-panel{margin-top:18px;padding-top:16px;border-top:1px solid #e5eadf}form label{display:block;margin-bottom:7px}form>div{display:flex;gap:10px}input{min-width:0;flex:1;padding:10px;border:1px solid #cbd5c4;border-radius:7px;background:white;font-size:14px}.search-results{margin-top:14px}.search-results>div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid #e4e9de;border-radius:7px;margin-top:8px}.search-results small{display:block;font-size:14px;color:#788570;margin-top:4px}.search-btn{display:inline-flex;align-items:center;gap:7px}.spinner{width:14px;height:14px;border:2px solid #cbd5c4;border-top-color:#365b3c;border-radius:50%;animation:spin .8s linear infinite}
 .search-results{position:relative}.status{font-size:13px;color:#788570}.search-results.loading>div:not(.skeleton):not(.progress){opacity:.4;transition:opacity .2s}
 .search-results>.progress{display:block;padding:0;border:0;margin:0 0 8px;height:3px;border-radius:2px;background:#edf0e8;overflow:hidden}.progress span{display:block;width:35%;height:100%;background:#7a9a6e;border-radius:2px;animation:slide 1.1s ease-in-out infinite}
 .skeleton i{display:block;height:12px;border-radius:4px;background:linear-gradient(90deg,#eef2ea 0%,#f8faf5 50%,#eef2ea 100%);background-size:200% 100%;animation:shimmer 1.2s ease-in-out infinite}.skeleton span{flex:1;display:flex;flex-direction:column;gap:9px}.skeleton .sk-btn{width:120px;height:40px;border-radius:7px}
 @keyframes spin{to{transform:rotate(360deg)}}@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(290%)}}@keyframes shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
 @media(prefers-reduced-motion:reduce){.spinner,.progress span,.skeleton i{animation-duration:2.4s}}
 .notice{margin-top:14px;padding:12px;background:#f2f6eb;border-radius:7px;line-height:1.7}@media(max-width:767px){.pms-link{padding:16px}header,.linked-booking,.search-results>div{align-items:flex-start;flex-direction:column}button{white-space:normal}input{width:100%}}
</style>
