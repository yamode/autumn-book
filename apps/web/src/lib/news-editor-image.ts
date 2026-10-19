import Image from '@tiptap/extension-image';
import {Extension} from '@tiptap/core';
import {Plugin,PluginKey} from '@tiptap/pm/state';
import {Decoration,DecorationSet} from '@tiptap/pm/view';
import type {Node as ProseMirrorNode,DOMOutputSpec} from '@tiptap/pm/model';
import {newsImageSize,cleanImageCaption} from './news-image';
import type {ImageUploadProgress} from './news-image-upload';

export const NewsImage=Image.extend({
 addAttributes(){return {...this.parent?.(),size:{default:'large',rendered:false},caption:{default:'',rendered:false}};},
 parseHTML(){return [{tag:'figure[data-news-image]',getAttrs:element=>{const img=element.querySelector('img');if(!img)return false;return {src:img.getAttribute('src'),alt:img.getAttribute('alt')||'',title:img.getAttribute('title'),size:newsImageSize(element.getAttribute('data-news-image-size')),caption:cleanImageCaption(element.querySelector('figcaption')?.textContent||'')};}},...(this.parent?.()??[])];},
 renderHTML({node}){
  const children:DOMOutputSpec[]=[['img',{src:node.attrs.src,alt:node.attrs.alt||'',...(node.attrs.title?{title:node.attrs.title}:{})}]];
  if(node.attrs.caption)children.push(['figcaption',{},cleanImageCaption(node.attrs.caption)]);
  return ['figure',{class:'news-image','data-news-image':'true','data-news-image-size':newsImageSize(node.attrs.size)},...children];
 },
 addNodeView(){return ({node})=>{
  const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption'),loading=document.createElement('span');
  figure.className='news-image';figure.dataset.newsImage='true';figure.contentEditable='false';img.draggable=true;loading.className='image-loading';loading.textContent='画像を読み込み中…';loading.setAttribute('role','status');figure.append(img,caption,loading);
  const loaded=()=>{figure.classList.remove('image-pending');loading.hidden=true;};img.onload=loaded;img.onerror=()=>{figure.classList.remove('image-pending');loading.textContent='画像を読み込めませんでした';loading.hidden=false;};
  function update(next:ProseMirrorNode){if(next.type.name!=='image')return false;figure.dataset.newsImageSize=newsImageSize(next.attrs.size);img.alt=next.attrs.alt||'';if(next.attrs.title)img.title=next.attrs.title;else img.removeAttribute('title');caption.textContent=next.attrs.caption||'';caption.hidden=!next.attrs.caption;if(img.getAttribute('src')!==next.attrs.src){figure.classList.add('image-pending');loading.hidden=false;loading.textContent='画像を読み込み中…';img.src=next.attrs.src;if(img.complete&&img.naturalWidth)loaded();}return true;}
  update(node);return {dom:figure,update,selectNode(){figure.classList.add('ProseMirror-selectednode');},deselectNode(){figure.classList.remove('ProseMirror-selectednode');},ignoreMutation:()=>true,destroy(){img.onload=null;img.onerror=null;}};
 };}
}).configure({allowBase64:false});

export const imageUploadKey=new PluginKey<DecorationSet>('newsImageUpload');
export const ImageUploadPlaceholders=Extension.create({name:'newsImageUpload',addProseMirrorPlugins(){return [new Plugin({key:imageUploadKey,state:{init:()=>DecorationSet.empty,apply(transaction,previous){let decorations=previous.map(transaction.mapping,transaction.doc);const action=transaction.getMeta(imageUploadKey);if(action?.add)decorations=decorations.add(transaction.doc,[Decoration.widget(action.add.at,action.add.dom,{id:action.add.id,side:1})]);if(action?.remove)decorations=decorations.remove(decorations.find(undefined,undefined,spec=>spec.id===action.remove));return decorations;}},props:{decorations:state=>imageUploadKey.getState(state)}})];}});

export function createUploadCard(){
 const dom=document.createElement('span'),preview=document.createElement('img'),text=document.createElement('span'),name=document.createElement('strong'),status=document.createElement('span'),bar=document.createElement('progress');
 dom.className='news-upload-card';dom.contentEditable='false';dom.setAttribute('role','status');preview.alt='アップロードする画像';text.className='news-upload-copy';status.className='news-upload-label';bar.max=100;bar.value=0;bar.setAttribute('aria-label','画像のアップロード進捗');text.append(name,status,bar);dom.append(preview,text);
 let count='';return {dom,showFile(filename:string,url:string,index:number,total:number){name.textContent=filename;preview.src=url;count=index+' / '+total;status.textContent=count+' アップロード中…';bar.value=0;},progress(progress:ImageUploadProgress){bar.value=progress.percent;status.textContent=count+' '+(progress.processing?'画像を処理中…':'アップロード中 '+progress.percent+'%');}};
}
