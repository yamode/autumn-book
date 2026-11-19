<script lang="ts">
	// 会員移行のリンクが使えないとき（期限切れ・形が違う・受付を閉じている）の案内。使えるときはサーバが手続きの画面へ転送する
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.migrate_title()}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-md px-4 py-12">
	<h1 class="font-display mb-2 text-center text-2xl text-brand-900">{m.migrate_heading()}</h1>
	<div class="space-y-3 rounded-2xl border border-stone-200 bg-white p-6 text-sm leading-6 text-stone-700">
		<p>{m.migrate_link_invalid()}</p>
		<a href="/auth/migrate" class="inline-block text-accent-600 underline">{m.migrate_again()}</a>
	</div>
</div>
