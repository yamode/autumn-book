<div class="flex min-h-screen items-center justify-center bg-brand-900 px-4">
	<div class="w-full max-w-sm rounded-2xl bg-white p-8">
		<p class="font-display text-center text-2xl text-brand-900">山人 管理画面</p>
		<p class="mt-2 text-center text-xs text-stone-500">施設スタッフ専用。本実装では社内認証（パスキー/SSO）に置き換わります。</p>
		<form method="POST" class="mt-6 space-y-3">
			<button formaction="?/admin" class="w-full rounded-lg bg-brand-800 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
				管理者としてログイン（デモ）
			</button>
			<button formaction="?/staff" class="w-full rounded-lg border border-stone-300 py-2.5 text-sm hover:bg-stone-50">
				スタッフとしてログイン（デモ・閲覧のみ）
			</button>
		</form>
		<a href="/" class="mt-6 block text-center text-xs text-stone-400 hover:underline">← 顧客サイトへ戻る</a>
	</div>
</div>
