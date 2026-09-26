<script lang="ts">
	import { page } from '$app/state';

	// 管理画面共通のトースト。form action の戻り値（page.form）を見て、保存などの結果を画面右下に短く出す。
	// 各画面のインライン表示はそのまま残し、スクロールして見えない位置にいても結果がわかるようにする。
	// 成功は { saved: true } のような「真の boolean」、失敗は fail() の message / error を拾う。

	const SUCCESS_LABEL: Record<string, string> = {
		saved: '保存しました',
		added: '追加しました',
		translationSaved: '翻訳を保存しました',
		paymentSaved: '決済設定を保存しました',
		cancelled: 'キャンセルしました',
		tested: 'テスト送信しました',
		resent: '再送しました',
		refundRetried: '返金を再実行しました',
		toggled: '切り替えました',
		adjusted: '調整しました',
		rankChanged: 'ランクを変更しました',
		guideDeleted: '削除しました',
		revoked: '無効にしました',
		keyRevoked: '無効にしました',
		rotated: '再発行しました',
		urlRegenerated: 'URL を再発行しました',
		otayoriGranted: '付与しました',
		ok: '完了しました'
	};

	let toast = $state<{ text: string; error: boolean; id: number } | null>(null);
	let seq = 0;

	$effect(() => {
		const f = page.form as Record<string, unknown> | null;
		if (!f) return;
		let next: { text: string; error: boolean } | null = null;
		if (page.status >= 400) {
			const msg = f.message ?? f.error ?? f.paymentError;
			if (typeof msg === 'string' && msg) next = { text: msg, error: true };
		} else {
			const key = Object.keys(SUCCESS_LABEL).find((k) => f[k] === true);
			if (key) next = { text: SUCCESS_LABEL[key], error: false };
		}
		if (!next) return;
		const id = ++seq;
		toast = { ...next, id };
		// 失敗は読み切れるよう長めに出す
		const t = setTimeout(() => {
			if (toast?.id === id) toast = null;
		}, next.error ? 8000 : 3000);
		return () => clearTimeout(t);
	});
</script>

<div class="pointer-events-none fixed right-4 bottom-14 z-50 flex justify-end" aria-live="polite" role="status">
	{#if toast}
		<div
			class="pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg px-4 py-2.5 text-sm shadow-lg {toast.error
				? 'bg-red-600 text-white'
				: 'bg-emerald-600 text-white'}"
		>
			<span>{toast.error ? '⚠' : '✔'} {toast.text}</span>
			<button type="button" class="text-white/70 hover:text-white" aria-label="閉じる" onclick={() => (toast = null)}>×</button>
		</div>
	{/if}
</div>
