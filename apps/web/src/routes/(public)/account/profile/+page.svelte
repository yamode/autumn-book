<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head><title>プロフィール ｜ マイページ</title></svelte:head>

<div class="max-w-lg space-y-6">
	{#if form?.saved}
		<p class="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">保存しました。</p>
	{/if}
	{#if form?.message}
		<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{form.message}</p>
	{/if}

	<form method="POST" action="?/update" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
		<h2 class="font-medium text-brand-900">会員情報</h2>
		<div class="grid grid-cols-2 gap-3">
			<label class="block text-sm">
				<span class="text-stone-600">氏名</span>
				<input name="name" value={data.member.name} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
			</label>
			<label class="block text-sm">
				<span class="text-stone-600">フリガナ</span>
				<input name="kana" value={data.member.kana} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
			</label>
		</div>
		<label class="block text-sm">
			<span class="text-stone-600">電話番号</span>
			<input name="phone" value={data.member.phone} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
		</label>
		<div class="text-sm">
			<span class="text-stone-600">メールアドレス</span>
			<p class="mt-1 flex items-center justify-between rounded-md bg-stone-50 px-3 py-2">
				{data.member.email}
				<span class="text-xs text-stone-400">変更には再確認が必要です（準備中）</span>
			</p>
		</div>
		<label class="flex items-start gap-2 text-sm">
			<input type="checkbox" name="mailOptIn" checked={data.member.mailOptIn} class="mt-0.5 h-4 w-4" />
			<span>お得なプランやイベントのご案内メールを受け取る</span>
		</label>
		<button type="submit" class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">保存する</button>
	</form>

	<div class="rounded-2xl border border-stone-200 bg-white p-6 text-sm">
		<p class="text-stone-500">会員番号：{data.member.memberCode} ／ 入会日：{data.member.joinedAt}</p>
		<form method="POST" action="/auth/logout" class="mt-4">
			<button type="submit" class="rounded-lg border border-stone-300 px-5 py-2 hover:bg-stone-50">ログアウト</button>
		</form>
	</div>

	<div class="rounded-2xl border border-stone-200 bg-white p-6 text-xs text-stone-500">
		<p class="font-medium text-stone-600">退会について</p>
		<p class="mt-1">退会するとポイントは失効します。予約履歴は法令に基づき一定期間保持されます。退会をご希望の場合はお問い合わせください。</p>
	</div>
</div>
