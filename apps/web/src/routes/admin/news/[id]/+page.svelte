<script lang="ts">import NewsPostEditor from '$lib/components/admin/NewsPostEditor.svelte';let {data}=$props();</script>
<svelte:head><title>{data.post?.title??'新しいお知らせ'} | Autumn Book</title></svelte:head>
<div class="article-page"><a class="back" href="/admin/news">← お知らせ一覧</a>{#key data.post?.id??'new'}<NewsPostEditor post={data.post??undefined} facilityId={data.currentFacility.id} hpPreviewSupported={data.hpPreviewSupported} canEdit={data.user?.role==='admin'}/>{/key}</div>
<style>.article-page{max-width:1180px;margin:0 auto}.back{display:inline-block;font-size:13px;color:#7d8972;margin:0 0 20px}.back:hover{color:#3c5134;text-decoration:underline}.article-page :global(.news-post-editor){border:1px solid #e2e6dc;border-radius:12px}</style>
