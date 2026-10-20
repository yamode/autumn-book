import type {PageServerLoad} from './$types';
import {newsletterContext} from '$lib/server/newsletter';
export const load:PageServerLoad=async event=>{
 const {db,facility}=await newsletterContext(event);
 const {data,error}=await db.rpc('admin_newsletter_report',{p_facility:facility});
 if(error)throw Error('レポートを取得できませんでした。');
 return {reports:(data??[]) as {id:string;name:string;subject:string;status:string;total:number;sent:number;delivered:number;opened:number;clicked:number;failed:number;queued:number}[]};
};
