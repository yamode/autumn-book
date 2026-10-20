// Capability is scoped to one article and facility; no service credentials leave Book.
import {env} from '$env/dynamic/private';
import {base64url,fromBase64url} from '$lib/server/partners/crypto';
export const NEWS_PREVIEW_TTL=3600;
const sites:Record<string,{slug:string;origin:string}>={
 '10000000-0000-0000-0000-000000000001':{slug:'nishiwaga',origin:'https://www.yamado.co.jp'},
 '10000000-0000-0000-0000-000000000002':{slug:'oga',origin:'https://oga.yamado.co.jp'}
};
export function newsPreviewSite(facility:string){return Object.hasOwn(sites,facility)?sites[facility]:null;}
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const enc=new TextEncoder();
async function key(){const secret=env.SUPABASE_SERVICE_ROLE_KEY?.trim();if(!secret)return null;return crypto.subtle.importKey('raw',enc.encode('autumn-book/news-preview/v1:'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function issueNewsPreview(id:string,facility:string){
 if(!uuid.test(id)||!newsPreviewSite(facility))return null;
 const k=await key();if(!k)return null;
 const payload=id+'.'+facility+'.'+(Math.floor(Date.now()/1000)+NEWS_PREVIEW_TTL);
 const signature=base64url(new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(payload))));
 return payload+'.'+signature;
}
export async function verifyNewsPreview(token:string,id:string){
 if(token.length>240||!uuid.test(id))return null;
 const parts=token.split('.');if(parts.length!==4)return null;
 const [post,facility,exp,signature]=parts,now=Math.floor(Date.now()/1000);
 if(post!==id||!newsPreviewSite(facility)||!/^\d{10}$/.test(exp)||Number(exp)<=now||Number(exp)>now+NEWS_PREVIEW_TTL)return null;
 try{const k=await key();return k&&await crypto.subtle.verify('HMAC',k,fromBase64url(signature) as Uint8Array<ArrayBuffer>,enc.encode(parts.slice(0,3).join('.')))?facility:null;}catch{return null;}
}
