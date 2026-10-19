import {renderMarkdown} from './markdown';
import {parseImageTitle,escapeImageText} from './news-image';
/** Ordinary Markdown links with the reserved title cta/cta-outline become news buttons.
 * Only renderer-generated anchors with an already validated href can be promoted. */
export function renderNewsMarkdown(source:string):string{
 const html=renderMarkdown(source).replace(/<a href="([^"<>]*)" title="(cta|cta-outline)">/g,(_match,href:string,kind:string)=>'<a class="news-cta'+(kind==='cta-outline'?' news-cta--outline':'')+'" href="'+href+'">');
 return html.replace(/<img\b[^>]*>/g,img=>{
  const title=/\btitle="([^"]*)"/.exec(img);const meta=title?parseImageTitle(title[1]):null;if(!meta)return img;
  return '<figure class="news-image" data-news-image="true" data-news-image-size="'+meta.size+'">'+img.replace(/\s+title="[^"]*"/,'')+(meta.caption?'<figcaption>'+escapeImageText(meta.caption)+'</figcaption>':'')+'</figure>';
 }).replace(/<p>\s*((?:<figure class="news-image"[^>]*><img\b[^>]*>(?:<figcaption>[^<]*<\/figcaption>)?<\/figure>\s*)+)<\/p>/g,'$1');
}
