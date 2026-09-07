<script lang="ts">
	// DATA_SOURCE / AUTH_MODE が supabase でない環境向けの案内（docs/ADMIN_APP_OPS.md §6.3）。
	let { authMode, dataSource }: { authMode: string; dataSource: string } = $props();
</script>

<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
	<p class="font-bold">この画面は本番データ専用です</p>
	<p class="mt-2">
		アプリ運用（クーポン・通知・好み登録項目・ダッシュボード）は Supabase の実データと実認証が必要です。
		現在: DATA_SOURCE={dataSource} / AUTH_MODE={authMode}
	</p>
	<p class="mt-2">
		ローカルで使うには <code class="rounded bg-white/60 px-1">.env</code> を DATA_SOURCE=supabase /
		AUTH_MODE=supabase にして、管理者アカウント（app_metadata.role=admin ＋ core.memberships の
		tenant_admin）でログインし直してください。
	</p>
</div>
