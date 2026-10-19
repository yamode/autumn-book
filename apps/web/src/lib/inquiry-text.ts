// Plain display text only. Never executes or renders mail HTML.
export function cleanInquiryText(source:string):string{
 let text=source.replace(/\r\n?/g,'\n').replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<!--[^]*?-->/g,'').trim();
 // Some mail clients put an HTML stylesheet in the plain-text MIME alternative.
 // Remove only leading complete CSS rules with recognized declarations.
 for(let n=0;n<100;n++){
  const m=/^\s*([^{}]{1,240})\{([^{}]{1,8000})\}\s*/.exec(text);
  if(!m||!/(?:^|[;\s])(?:font-(?:size|family|weight|style)|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|color|background(?:-[a-z]+)?|text-decoration|line-height|display|border(?:-[a-z]+)?)\s*:/i.test(m[2]))break;
  if(!/^[\sA-Za-z0-9_#.*:,\[\]=\x22\x27()>\-+~|^$]+$/.test(m[1]))break;text=text.slice(m[0].length);
 }
 return text.trim();
}
export function inquiryHtmlText(html:string):string{
 const visible=html.replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
 return cleanInquiryText(visible.replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:p|div|tr|li|h[1-6]|blockquote)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').replace(/&quot;/gi,'"').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,hex,dec)=>{const n=parseInt(hex||dec,hex?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&amp;/gi,'&').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n'));
}
export function inquiryMailText(mail:{text?:string;html?:string|false}){return cleanInquiryText(mail.text?.trim()|| (typeof mail.html==='string'?inquiryHtmlText(mail.html):''));}
export function cleanInquiryNotice(body:string){return body.split(/(【日本語訳[^\n]*】|【受信原文】|【お問い合わせ内容】)/).map((part,index)=>index>0&&index%2===0?'\n'+cleanInquiryText(part)+'\n':part).join('');}

