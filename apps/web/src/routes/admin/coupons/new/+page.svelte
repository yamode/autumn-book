<script lang="ts">
	import { enhance } from '$lib/enhance';

	import CouponFields from '$lib/components/admin/CouponFields.svelte';
	import Unavailable from '$lib/components/admin/Unavailable.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';

	let { data, form } = $props();
</script>

<svelte:head><title>新しいクーポン ｜ 山人管理</title></svelte:head>

<p class="mb-2 text-xs text-stone-500"><a href="/admin/coupons" class="hover:underline">← クーポン一覧</a></p>
<PageHeader title="新しいクーポン" description="作成しただけでは誰にも届きません。作成後の詳細画面から配布します。" />

{#if data.unavailable}
	<Unavailable authMode={data.authMode} dataSource={data.dataSource} />
{:else}
	{#if form?.message}
		<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
			{form.message}
		</div>
	{/if}

	<form
		method="POST"
		action="?/create"
		use:enhance
		class="max-w-3xl rounded-xl border border-stone-200 bg-white p-4"
	>
		<CouponFields facilities={data.facilities ?? []} />

		<div class="mt-5 flex flex-wrap items-center gap-2">
			<a
				href="/admin/coupons"
				class="inline-flex min-h-10 items-center rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">キャンセル</a
			>
			<button type="submit" class="min-h-10 rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white hover:bg-accent-500">
				作成する
			</button>
		</div>
		<p class="mt-2 text-xs text-stone-400">
			作成しただけでは誰にも届きません。作成後の詳細画面から配布します。
		</p>
	</form>
{/if}
