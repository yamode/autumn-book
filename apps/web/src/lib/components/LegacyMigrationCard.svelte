<script lang="ts">
	// 以前の予約システム（tripla）の会員向けの会員移行の入口。ログイン・会員登録の画面の下に出す（2026-11-26）
	// 新規登録と取り違えないよう、ふつうの案内の行ではなく枠で分け、何ができるか（実績の引き継ぎ）を一文で書く
	import * as m from '$lib/paraglide/messages';
</script>

<section class="rounded-2xl border border-stone-200 bg-stone-50 p-5" aria-labelledby="legacy-migration-title">
	<p class="text-xs font-medium tracking-wide text-stone-500">{m.legacy_card_eyebrow()}</p>
	<h2 id="legacy-migration-title" class="mt-1 text-base font-semibold text-stone-800">{m.legacy_card_title()}</h2>
	<p class="mt-2 text-sm leading-relaxed text-stone-600">{m.legacy_card_body()}</p>
	<a
		href="/auth/migrate"
		class="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand-800 bg-white py-2.5 text-sm font-medium text-brand-800 hover:bg-brand-50"
	>
		{m.legacy_card_cta()}
		<span aria-hidden="true">→</span>
	</a>
</section>
