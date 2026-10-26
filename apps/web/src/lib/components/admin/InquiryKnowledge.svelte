<script lang="ts">
 import { enhance } from '$app/forms';
 import type { SubmitFunction } from '@sveltejs/kit';
 import type { Message } from '$lib/server/inquiries';
 let {message,revision,submit}: {message:Message;revision:number;submit:SubmitFunction}=$props();
 // Book から送った返信は、承認しなくても自動でAI下書きの参考になる（停止したものを除く）
 const bookReply=$derived(!message.history_source?.account);
</script>
<details class="knowledge">
 <summary>{message.reusable?'承認済みの回答例':message.history_source?.account?'過去メールの参考設定':message.ai_reference_off?'AIの参考設定（停止中）':'AIの参考設定'}</summary>
 <div class="knowledge-body">
 {#if message.history_source?.account}
  <p>過去メールの参考本文です。現在のルールとして承認した回答とは区別されます。</p>
  <form method="post" use:enhance={submit} data-no-guard>
   <input type="hidden" name="revision" value={revision}/><input type="hidden" name="messageId" value={message.id}/>
   <button name="action" value={message.history_reference||message.reusable?'history_disable':'history_enable'} disabled={!message.knowledge_question||!message.knowledge_answer}>{message.history_reference||message.reusable?'AIの参考利用を停止':'AIの参考利用を再開'}</button>
  </form>
 {:else if bookReply&&!message.reusable}
  <p>{message.ai_reference_off?'この返信はAIの参考にしていません。':'この返信は、直前のお客様のメールとあわせて、自動でAI下書きの参考にしています（お名前・連絡先などは伏せます）。'}</p>
  <form method="post" use:enhance={submit} data-no-guard>
   <input type="hidden" name="revision" value={revision}/><input type="hidden" name="messageId" value={message.id}/>
   <button name="action" value={message.ai_reference_off?'sent_enable':'sent_disable'}>{message.ai_reference_off?'AIの参考利用を再開':'AIの参考利用を停止'}</button>
  </form>
  <p>質問と回答を整えて承認すると、参考例として優先して使われます。</p>
 {/if}
 <p>氏名・予約番号・個別の特別対応を除き、再利用できる質問と回答に整えてください。</p>
 <form method="post" use:enhance={submit}>
  <input type="hidden" name="revision" value={revision}/><input type="hidden" name="messageId" value={message.id}/>
  <label>質問<textarea name="question" maxlength="1000" required rows="2">{message.knowledge_question??''}</textarea></label>
  <label>回答<textarea name="answer" maxlength="10000" required rows="4">{message.knowledge_answer??''}</textarea></label>
  <label>有効期限（任意）<input type="date" name="until" value={message.valid_until??''}/></label>
  <div class="actions"><button name="action" value="approve">承認して登録</button>{#if message.reusable}<button name="action" value="revoke" formnovalidate>承認を取り消す</button>{/if}</div>
 </form>
 </div>
</details>
<style>
 .knowledge{border-top:1px solid #eeeae4;margin-top:1.2rem;padding-top:.8rem;font-size:.75rem;color:#647067}.knowledge summary{cursor:pointer;font-weight:600}.knowledge-body{display:grid;gap:.8rem;padding-top:.8rem}.knowledge-body p{line-height:1.7}.knowledge form{display:grid;gap:.75rem}.knowledge label{display:grid;gap:.35rem}.knowledge textarea,.knowledge input{width:100%;border:1px solid #deded6;border-radius:.6rem;padding:.65rem;color:#25372f;background:#fff}.knowledge button{border:1px solid #d9dfd9;padding:.5rem .8rem;border-radius:.6rem;background:#fff;color:#264539;font-weight:600}.actions{display:flex;gap:.5rem;flex-wrap:wrap}
</style>
