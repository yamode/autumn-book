<script lang="ts">import NewsPostEditor from '$lib/components/admin/NewsPostEditor.svelte';let {data}=$props();</script>
<svelte:head><title>{data.post?.title??'新しいお知らせ'} | Autumn Book</title></svelte:head>
<div class="article-page">{#key data.post?.id??'new'}<NewsPostEditor post={data.post??undefined} facilityId={data.currentFacility.id} hpPreviewSupported={data.hpPreviewSupported} canEdit={data.user?.role==='admin'}/>{/key}</div>
<style>.article-page{width:100%;min-width:0;margin:0 auto}.article-page :global(.news-post-editor){border:1px solid #e2e6dc;border-radius:10px}</style>
