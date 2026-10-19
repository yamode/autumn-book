import {json} from '@sveltejs/kit';
import type {RequestHandler} from './$types';
import {verifyNewsPreview,NEWS_PREVIEW_FACILITY} from '$lib/server/news/preview';
import {partnerServiceClient} from '$lib/server/partners/admin-client';
import {newsBodyHtml} from '$lib/server/news/public';
export const GET:RequestHandler=async({params,url})=>{
 const headers={'cache-control':'private, no-store, max-age=0','x-robots-tag':'noindex, nofollow, noarchive','referrer-policy':'no-referrer'};
 if(!await verifyNewsPreview(url.searchParams.get('token')??'',params.id))return json({error:'not_found'},{status:404,headers});
 const db=partnerServiceClient();if(!db)return json({error:'unavailable'},{status:503,headers});
 const {data:post,error}=await db.schema('book').from('news_posts').select('id,title,body,published_at').eq('id',params.id).eq('facility_id',NEWS_PREVIEW_FACILITY).maybeSingle();
 if(error)return json({error:'unavailable'},{status:503,headers});
 if(!post)return json({error:'not_found'},{status:404,headers});
 return json({preview:true,facility:'nishiwaga',post:{id:post.id,title:post.title,publishedAt:post.published_at,bodyHtml:newsBodyHtml(post.body??'')},prev:null,next:null},{headers});
};
