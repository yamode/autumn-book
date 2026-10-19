import {renderMarkdown} from './markdown';
/** Ordinary Markdown links with the reserved title cta/cta-outline become news buttons.
 * Only renderer-generated anchors with an already validated href can be promoted. */
export function renderNewsMarkdown(source:string):string{
 return renderMarkdown(source).replace(/<a href="([^"<>]*)" title="(cta|cta-outline)">/g,(_match,href:string,kind:string)=>'<a class="news-cta'+(kind==='cta-outline'?' news-cta--outline':'')+'" href="'+href+'">');
}
