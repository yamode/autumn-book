<script lang="ts">
	import { APP_VERSION } from '$lib/version';

	// 管理画面の右下に常時表示するバージョン表記。
	// DBG パネル（画面下端いっぱいの固定バー・z-9999）と重ならないよう bottom-8 に置く。
	// クリックを邪魔しないよう pointer-events は無効。
</script>

<div
	class="pointer-events-none fixed bottom-8 right-2 z-40 rounded bg-stone-900/60 px-1.5 py-0.5 font-mono text-[10px] leading-none text-white/90 select-none"
	aria-label="バージョン {APP_VERSION}"
>
	v{APP_VERSION}
</div>
