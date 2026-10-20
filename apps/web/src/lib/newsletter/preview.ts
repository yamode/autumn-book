import {renderDocument,type MailDocument} from './document';
export function editorPreview(doc:MailDocument,preheader:string,token:string):string{
 const html=renderDocument(doc,preheader);
 const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; script-src 'nonce-${token}';">`;
 if(!token)return html.replace('<head>','<head>'+csp);
 const script=`<script nonce="${token}">
 const token=${JSON.stringify(token)};
 const send=(type,extra={})=>parent.postMessage({type,token,...extra},'*');
 const select=id=>{document.querySelectorAll('[data-mail-block]').forEach(el=>el.classList.toggle('editor-selected',el.dataset.mailBlock===id));};
 document.querySelectorAll('[data-mail-block]').forEach(el=>{el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label',el.querySelector('h2')?.textContent||el.querySelector('img')?.alt||'ブロックを編集');});
 document.addEventListener('click',event=>{event.preventDefault();const el=event.target.closest('[data-mail-block]');if(el){select(el.dataset.mailBlock);send('book-mail-select',{id:el.dataset.mailBlock});}});
 document.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){const el=event.target.closest('[data-mail-block]');if(el){event.preventDefault();select(el.dataset.mailBlock);send('book-mail-select',{id:el.dataset.mailBlock});}}});
 window.addEventListener('message',event=>{if(event.source!==parent||event.data?.token!==token)return;if(event.data.type==='book-mail-highlight')select(event.data.id);if(event.data.type==='book-mail-locate'){const el=Array.from(document.querySelectorAll('[data-mail-block]')).find(n=>n.dataset.mailBlock===event.data.id);if(el)send('book-mail-position',{top:el.getBoundingClientRect().top+scrollY});}});
 let pending=false;const resize=()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;send('book-mail-height',{height:document.body.scrollHeight});});};
 new ResizeObserver(resize).observe(document.body);window.addEventListener('load',resize);resize();
 </script>`;
 const styles='<style>[data-mail-block]{cursor:pointer;outline-offset:-2px;}[data-mail-block]:hover{outline:2px dashed #b28a4c;}[data-mail-block].editor-selected{outline:2px solid #8b282e;}[data-mail-block]:focus-visible{outline:3px solid #8b282e;}</style>';
 return html.replace('<head>','<head>'+csp+styles).replace('</body>',script+'</body>');
}
