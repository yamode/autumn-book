<script lang="ts">
 import {invalidateAll} from '$app/navigation';
 type Booking={id:string;group_code:string;guest_name:string;check_in:string|null;check_out:string|null;status:string;reservation_codes?:string;linked?:boolean;email_match?:boolean;pending_count?:number;copied_count?:number};
 let {inquiryId,links,error=''}:{inquiryId:string;links:Booking[];error?:string}=$props();
 let open=$state(false),query=$state(''),busy=$state(false),results=$state<Booking[]>([]),message=$state('');
 const pmsUrl=(id:string)=>'https://autumn-pms.yamado.app/reservations/'+id+'?facility=yamado';
 async function api(action:string,extra:Record<string,unknown>={}){
  const res=await fetch('/admin/inquiries/'+inquiryId+'/pms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...extra})}),value=await res.json();
  if(!res.ok)throw Error(value.error??'連携できませんでした。');return value.data;
 }
 async function search(){if(busy)return;busy=true;message='';const source=inquiryId;try{const value=await api('search',{query});if(source===inquiryId)results=value;}catch(e){message=String(e);}finally{busy=false;}}
 async function link(id:string){if(busy)return;busy=true;message='';try{await api('link',{group:id});results=results.map(r=>r.id===id?{...r,linked:true}:r);await invalidateAll();message='予約に紐付けました。やりとりは「転記する」で事前応対記録に追加できます。';}catch(e){message=String(e);}finally{busy=false;}}
 async function copy(booking:Booking){
  if(busy||!confirm('予約 #'+booking.group_code+'（'+booking.guest_name+'）の事前応対記録に、未転記の受信・送信済みメッセージを追加します。よろしいですか？'))return;
  busy=true;message='';try{const value=await api('copy',{group:booking.id});await invalidateAll();message=value.copied+'件を事前応対記録に転記しました。';}catch(e){message=String(e);}finally{busy=false;}
 }
</script>
<section class="pms-link" aria-label="PMSの予約連携">
 <header><div><h2>予約・PMS連携</h2><p>やりとりを予約の事前応対記録へ引き継げます。</p></div><button type="button" disabled={busy||!!error} onclick={()=>{open=!open;if(open&&!results.length)void search();}}>{open?'検索を閉じる':'予約を探す'}</button></header>
 {#if error}<p role="alert">{error}</p>{/if}
 {#each links as booking(booking.id)}<div class="linked-booking"><div><a href={pmsUrl(booking.id)} target="_blank" rel="noopener noreferrer">#{booking.group_code} · {booking.guest_name} ↗</a><p>{booking.check_in??'宿泊日未設定'} ～ {booking.check_out??''}{booking.status==='cancelled'?' · 取消済み':''}</p><span>転記済み {booking.copied_count??0}件 · 未転記 {booking.pending_count??0}件</span></div><button type="button" disabled={busy||!booking.pending_count||!!error} onclick={()=>void copy(booking)}>{busy?'処理中…':'未転記のやりとりを転記する'}</button></div>{/each}
 {#if open}<div class="search-panel"><form onsubmit={e=>{e.preventDefault();void search();}}><label for="pms-booking-search">予約番号・氏名・メールアドレス</label><div><input id="pms-booking-search" bind:value={query} maxlength="100" placeholder="空欄ならメールアドレスが一致する予約"/><button type="submit" disabled={busy}>{busy?'検索中…':'検索'}</button></div></form><div class="search-results">{#each results as booking(booking.id)}<div><span><strong>#{booking.group_code} · {booking.guest_name}</strong><small>{booking.check_in??'宿泊日未設定'} ～ {booking.check_out??''} · {booking.reservation_codes??''}{booking.status==='cancelled'?' · 取消済み':''}</small>{#if booking.email_match}<small>メールアドレスが一致</small>{/if}</span><button type="button" disabled={busy||booking.linked||links.some(l=>l.id===booking.id)} onclick={()=>void link(booking.id)}>{booking.linked||links.some(l=>l.id===booking.id)?'紐付け済み':'この予約に紐付ける'}</button></div>{:else}<p>{busy?'予約を検索しています。':'該当する予約はありません。予約番号や氏名でも検索できます。'}</p>{/each}</div></div>{/if}
 {#if message}<p class="notice" role="status">{message}</p>{/if}
 <p class="footnote">送信前の下書き・受付控え・内部通知は転記しません。添付ファイルはBookの元のやりとりから確認できます。</p>
</section>
<style>
 .pms-link{padding:20px;border:1px solid #dfe6da;border-radius:12px;background:#fff;margin-bottom:24px;font-size:14px;color:#3a4d3e}header{display:flex;justify-content:space-between;gap:16px;align-items:center}h2{font-size:16px;font-weight:600}header p,.footnote{color:#788570;line-height:1.7;margin-top:5px}.footnote{margin-top:14px;font-size:14px}button{border:1px solid #cbd5c4;border-radius:7px;padding:9px 12px;background:#f8faf5;min-height:40px;font-size:14px;white-space:nowrap}button:hover{background:#e8efdf}button:disabled{opacity:.45;cursor:default}.linked-booking{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid #edf0e8}.linked-booking a{font-weight:600;text-decoration:underline;color:#365b3c}.linked-booking p,.linked-booking span{display:block;font-size:14px;margin-top:5px;color:#788570}.search-panel{margin-top:18px;padding-top:16px;border-top:1px solid #e5eadf}form label{display:block;margin-bottom:7px}form>div{display:flex;gap:10px}input{min-width:0;flex:1;padding:10px;border:1px solid #cbd5c4;border-radius:7px;background:white;font-size:14px}.search-results{margin-top:14px}.search-results>div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid #e4e9de;border-radius:7px;margin-top:8px}.search-results small{display:block;font-size:14px;color:#788570;margin-top:4px}.notice{margin-top:14px;padding:12px;background:#f2f6eb;border-radius:7px;line-height:1.7}@media(max-width:767px){.pms-link{padding:16px}header,.linked-booking,.search-results>div{align-items:flex-start;flex-direction:column}button{white-space:normal}input{width:100%}}
</style>
