<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	// 未ログイン向けの会員登録 CTA バナー（設計書 §6）。
	// CTA は ?next=/otayori を付け、登録/ログイン後に投稿フォームへ戻す。
	let { showBanner = true }: { showBanner?: boolean } = $props();
</script>

{#if showBanner}
	<div class="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
		<p class="text-sm text-stone-700">{m.otayori_cta_banner()}</p>
		<div class="mt-3 flex flex-wrap gap-2">
			<a href="/auth/register?next={encodeURIComponent('/otayori')}" class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500">{m.otayori_cta_register()}</a>
			<a href="/auth/login?next={encodeURIComponent('/otayori')}" class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">{m.otayori_cta_login()}</a>
		</div>
	</div>
{/if}
