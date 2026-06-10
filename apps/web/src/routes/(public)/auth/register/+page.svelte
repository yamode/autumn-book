<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head><title>会員登録 ｜ 山人</title></svelte:head>

<div class="mx-auto max-w-md px-4 py-12">
	<h1 class="font-display mb-2 text-center text-2xl text-brand-900">会員登録（無料）</h1>
	<p class="mb-6 text-center text-sm text-stone-500">全施設共通の1つのIDで、ポイント還元・会員価格・予約管理をご利用いただけます。入会で<strong class="text-accent-600">500pt</strong>プレゼント。</p>

	<form method="POST" action="?/register" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
		<label class="block text-sm">
			<span class="text-stone-600">メールアドレス <span class="text-red-500">*</span></span>
			<input type="email" name="email" value={form?.values?.email ?? data.prefill.email} required class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.email ? 'border-red-400' : 'border-stone-300'}" />
			{#if form?.errors?.email}<span class="text-xs text-red-600">{form.errors.email}</span>{/if}
		</label>
		<label class="block text-sm">
			<span class="text-stone-600">パスワード（8文字以上） <span class="text-red-500">*</span></span>
			<input type="password" name="password" required class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.password ? 'border-red-400' : 'border-stone-300'}" />
			{#if form?.errors?.password}<span class="text-xs text-red-600">{form.errors.password}</span>{/if}
		</label>
		<div class="grid grid-cols-2 gap-3">
			<label class="block text-sm">
				<span class="text-stone-600">氏名 <span class="text-red-500">*</span></span>
				<input name="name" value={form?.values?.name ?? data.prefill.name} required class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.name ? 'border-red-400' : 'border-stone-300'}" placeholder="山田 太郎" />
			</label>
			<label class="block text-sm">
				<span class="text-stone-600">フリガナ <span class="text-red-500">*</span></span>
				<input name="kana" value={form?.values?.kana ?? ''} required class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.kana ? 'border-red-400' : 'border-stone-300'}" placeholder="ヤマダ タロウ" />
			</label>
		</div>
		<label class="block text-sm">
			<span class="text-stone-600">電話番号</span>
			<input name="phone" value={form?.values?.phone ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder="090-0000-0000" />
		</label>
		<label class="flex items-start gap-2 text-sm">
			<input type="checkbox" name="mailOptIn" class="mt-0.5 h-4 w-4" />
			<span class="text-stone-600">お得なプランやイベントのご案内メールを受け取る<span class="block text-xs text-stone-400">いつでも配信停止できます（特定電子メール法に基づくオプトイン）</span></span>
		</label>
		<button type="submit" class="w-full rounded-lg bg-accent-600 py-2.5 font-medium text-white hover:bg-accent-500">登録する</button>
		<p class="text-center text-xs text-stone-400">登録により <a href="/legal/privacy" class="underline">プライバシーポリシー</a> に同意したものとみなされます。</p>
	</form>

	<p class="mt-6 text-center text-sm text-stone-600">
		既に会員の方は <a href="/auth/login" class="text-accent-600 underline">ログイン</a>
	</p>
</div>
