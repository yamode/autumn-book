<script lang="ts">
 let {name,preview,percent,processing,index,total}:{name:string;preview:string;percent:number;processing:boolean;index:number;total:number}=$props();
</script>
<div class="news-upload-card" role="status">
 <img src={preview} alt="アップロードする画像"/>
 <div class="news-upload-copy"><strong>{name}</strong><span class="news-upload-label">{index} / {total} {processing?'画像を処理中…':'アップロード中 '+percent+'%'}</span><progress max="100" value={percent} aria-label="画像のアップロード進捗"></progress></div>
</div>
