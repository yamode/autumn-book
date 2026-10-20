<script lang="ts">
 import {onMount} from 'svelte';
 import {Editor} from '@tiptap/core';
 import StarterKit from '@tiptap/starter-kit';
 import Link from '@tiptap/extension-link';
 import {safeUrl} from '$lib/newsletter';
 let {value=$bindable(''),disabled=false}:{value?:string;disabled?:boolean}=$props();
 let host:HTMLDivElement,editor:Editor|undefined=$state.raw();
 let revision=$state(0);
 onMount(()=>{editor=new Editor({element:host,content:value,editable:!disabled,extensions:[StarterKit.configure({link:false}),Link.configure({openOnClick:false,protocols:['https','http','mailto','tel']})],editorProps:{attributes:{'aria-label':'装飾付きの本文',role:'textbox','aria-multiline':'true'}},onUpdate:({editor:e})=>{value=e.getHTML();revision++;},onSelectionUpdate:()=>{revision++;}});return()=>editor?.destroy();});
 $effect(()=>{editor?.setEditable(!disabled);});
 $effect(()=>{if(editor&&value!==editor.getHTML())editor.commands.setContent(value,{emitUpdate:false});});
 function active(name:string){void revision;return editor?.isActive(name)??false;}
 function link(){const current=editor?.getAttributes('link').href??'',url=window.prompt('リンク先URL',current);if(url===null)return;if(!url){editor?.chain().focus().unsetLink().run();return;}if(!safeUrl(url)){window.alert('http(s)・mailto・telのURLを入力してください。');return;}editor?.chain().focus().extendMarkRange('link').setLink({href:url}).run();}
</script>
<div class="rich"><div role="toolbar" aria-label="文字の装飾" class="toolbar"><button type="button" class:active={active('bold')} aria-pressed={active('bold')} aria-label="太字" disabled={disabled} onclick={()=>editor?.chain().focus().toggleBold().run()}><b>B</b></button><button type="button" class:active={active('italic')} aria-pressed={active('italic')} aria-label="斜体" disabled={disabled} onclick={()=>editor?.chain().focus().toggleItalic().run()}><i>I</i></button><button type="button" disabled={disabled} onclick={link}>リンク</button><button type="button" disabled={disabled} onclick={()=>editor?.chain().focus().toggleBulletList().run()}>箇条書き</button><button type="button" disabled={disabled} onclick={()=>editor?.chain().focus().toggleOrderedList().run()}>番号</button></div><div bind:this={host} class="editor"></div></div>
<style>.rich{border:1px solid #d6d3d1;border-radius:8px;overflow:hidden;background:white}.toolbar{display:flex;flex-wrap:wrap;gap:4px;padding:6px;border-bottom:1px solid #e7e5e4}.toolbar button{padding:8px;min-height:40px;font-size:14px;border-radius:5px}.toolbar button:hover,.toolbar .active{background:#e7e5e4}.editor{padding:12px;min-height:160px;font-size:16px;line-height:1.8}.editor :global(.tiptap){outline:none;min-height:140px}.editor :global(p){margin-bottom:12px}.editor :global(ul){list-style:disc;padding-left:24px}.editor :global(ol){list-style:decimal;padding-left:24px}.editor :global(a){color:#8b282e;text-decoration:underline}</style>
