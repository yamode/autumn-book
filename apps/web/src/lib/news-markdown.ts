import {renderMarkdown} from './markdown';
import {parseImageTitle,escapeImageText} from './news-image';

/** リンクの開き方。blank＝新しいタブ、self＝同じタブ、null＝指定なし（これまでのリンク：HP は新しいタブ・Book は同じタブ） */
export type NewsLinkTarget='blank'|'self'|null;
export type NewsLinkKind='cta'|'cta-outline'|null;
const TOKENS=new Set(['cta','cta-outline','blank','self']);

/** Markdown のリンクの title に書く予約語（例: "cta blank"）。何も無ければ空文字 */
export function newsLinkTitle(kind:NewsLinkKind,target:NewsLinkTarget):string{
 return [kind,target].filter(Boolean).join(' ');
}
/** title の予約語を読む。予約語以外が混ざっていたら null（ふつうの title として扱う） */
export function parseNewsLinkTitle(title:string):{kind:NewsLinkKind;target:NewsLinkTarget}|null{
 const tokens=title.trim().split(/\s+/).filter(Boolean);
 if(!tokens.length||tokens.some(t=>!TOKENS.has(t)))return null;
 return {kind:tokens.includes('cta-outline')?'cta-outline':tokens.includes('cta')?'cta':null,target:tokens.includes('blank')?'blank':tokens.includes('self')?'self':null};
}

/** Ordinary Markdown links with the reserved title tokens become news buttons / get their target.
 * 予約語: cta / cta-outline（ボタン）、blank / self（新しいタブ／同じタブ）。
 * Only renderer-generated anchors with an already validated href can be promoted. */
export function renderNewsMarkdown(source:string):string{
 const html=renderMarkdown(source).replace(/<a href="([^"<>]*)" title="([^"<>]*)">/g,(match,href:string,title:string)=>{
  const meta=parseNewsLinkTitle(title);if(!meta)return match;
  const cls=meta.kind?' class="news-cta'+(meta.kind==='cta-outline'?' news-cta--outline':'')+'"':'';
  const target=meta.target==='blank'?' target="_blank" rel="noopener noreferrer"':meta.target==='self'?' target="_self"':'';
  return '<a'+cls+' href="'+href+'"'+target+'>';
 });
 return html.replace(/<img\b[^>]*>/g,img=>{
  const title=/\btitle="([^"]*)"/.exec(img);const meta=title?parseImageTitle(title[1]):null;if(!meta)return img;
  return '<figure class="news-image" data-news-image="true" data-news-image-size="'+meta.size+'">'+img.replace(/\s+title="[^"]*"/,'')+(meta.caption?'<figcaption>'+escapeImageText(meta.caption)+'</figcaption>':'')+'</figure>';
 }).replace(/<p>\s*((?:<figure class="news-image"[^>]*><img\b[^>]*>(?:<figcaption>[^<]*<\/figcaption>)?<\/figure>\s*)+)<\/p>/g,'$1');
}
