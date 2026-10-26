<script lang="ts">
 // やり取り欄の各メールから、紐付け済み予約の事前応対記録へ1件ずつ転記する
 import {invalidateAll} from '$app/navigation';
 type Booking={id:string;group_code:string;guest_name:string;copied_message_ids?:string[]};
 type Email={id:string;subject:string;created_at:string;sent_at:string|null};
 let {inquiryId,email,links}:{inquiryId:string;email:Email;links:Booking[]}=$props();
 let busy=$state(''),message=$state('');
 const date=(value:string)=>new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
 const copied=(booking:Booking)=>booking.copied_message_ids?.includes(email.id)??false;
 async function copy(booking:Booking){
  if(busy||copied(booking))return;
  if(!confirm('予約 #'+booking.group_code+'（'+booking.guest_name+'）の事前応対記録に、このメールを転記します。\n'+date(email.sent_at??email.created_at)+' · '+(email.subject||'件名なし')+'\nよろしいですか？'))return;
  busy=booking.id;message='';
  try{
   const res=await fetch('/admin/inquiries/'+inquiryId+'/pms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'copy',group:booking.id,message:email.id})}),value=await res.json();
   if(!res.ok)throw Error(value.error??'転記できませんでした。');
   await invalidateAll();message=value.data?.copied===1?'PMSの事前応対記録に転記しました。':'このメールはすでに転記済みです。';
  }catch(e){message=e instanceof Error?e.message:'転記できませんでした。';}
  finally{busy='';}
 }
</script>
<div class="pms-copy">
 {#each links as booking(booking.id)}
  {#if copied(booking)}<span class="done">✓ PMS #{booking.group_code} へ転記済み</span>
  {:else}<button type="button" class="quiet-button" disabled={!!busy} onclick={()=>void copy(booking)}>{busy===booking.id?'転記中…':'PMS #'+booking.group_code+' の事前応対へ転記'}</button>{/if}
 {/each}
 {#if message}<p role="status">{message}</p>{/if}
</div>
<style>
 .pms-copy{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-top:1rem;padding-top:.8rem;border-top:1px solid #eeeae4}.quiet-button{font-size:.72rem;color:#365b3c;padding:.45rem .75rem;border:1px solid #cbd5c4;border-radius:.6rem;background:white;font-weight:600}.quiet-button:hover{background:#eef3e8}.done{font-size:.72rem;color:#6f8a62}p{width:100%;font-size:.72rem;color:#5f7254;line-height:1.7}
</style>
