import {error} from '@sveltejs/kit';
import type {PageServerLoad} from './$types';
import {load as listLoad} from '../+page.server';
export const load:PageServerLoad=async event=>{const result=await listLoad(event as never);const data=result as {posts:import('$lib/types').NewsPost[];hpPreviewSupported:boolean;publicNewsBase:string|null};if(event.params.id==='new')return {post:null,hpPreviewSupported:data.hpPreviewSupported,publicNewsBase:data.publicNewsBase};const post=data.posts.find(p=>p.id===event.params.id);if(!post)error(404,'お知らせが見つかりません。');return {post,hpPreviewSupported:data.hpPreviewSupported,publicNewsBase:data.publicNewsBase};};
