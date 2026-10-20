<script lang="ts">
	// プライバシーポリシーに置く「アクセス解析を停止する／再開する」（2026-10-21）。
	// 同意バナーを出さない地域（日本など）では確認なしで計測するので、ここでいつでも止められるようにする。
	// 選択はこのブラウザに保存（ab_consent）。読み込み済みの GA も AnalyticsConsent がその場で止める。
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';
	import { getLocale } from '$lib/paraglide/runtime';
	import { CONSENT_CHANGE_EVENT, consent, saveConsent, setConsentRegion, type ConsentState } from '$lib/analytics';

	const texts: Record<string, { title: string; on: string; off: string; unset: string; stop: string; start: string }> = {
		ja: {
			title: 'アクセス解析の設定（このブラウザ）',
			on: 'いまは Google アナリティクスによるアクセス解析を使っています。',
			off: 'いまはアクセス解析を止めています。',
			unset: 'アクセス解析には、まだ同意いただいていません（解析は行っていません）。',
			stop: 'アクセス解析を停止する',
			start: 'アクセス解析を許可する'
		},
		en: {
			title: 'Analytics settings (this browser)',
			on: 'Google Analytics is currently enabled.',
			off: 'Analytics is currently turned off.',
			unset: 'You have not consented to analytics yet (no analytics is collected).',
			stop: 'Turn off analytics',
			start: 'Allow analytics'
		},
		'zh-TW': {
			title: '流量分析設定（此瀏覽器）',
			on: '目前正在使用 Google Analytics 進行流量分析。',
			off: '目前已停止流量分析。',
			unset: '您尚未同意流量分析（目前未進行分析）。',
			stop: '停止流量分析',
			start: '允許流量分析'
		}
	};
	const t = texts[getLocale()] ?? texts.ja;

	let state = $state<ConsentState | null>(null);
	$effect(() => {
		if (!browser) return;
		setConsentRegion(page.data.consentRequired !== false);
		state = consent();
		const onChange = () => (state = consent());
		window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
		return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
	});
</script>

{#if env.PUBLIC_GA4_MEASUREMENT_ID && state}
	<section class="mt-10 rounded-xl border border-stone-200 bg-white p-5">
		<h2 class="text-base font-semibold text-brand-900">{t.title}</h2>
		<p class="mt-2 text-sm text-stone-600">{state === 'granted' ? t.on : state === 'denied' ? t.off : t.unset}</p>
		<button
			type="button"
			class="mt-3 min-h-10 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:bg-stone-50"
			onclick={() => saveConsent(state === 'granted' ? 'denied' : 'granted')}
		>{state === 'granted' ? t.stop : t.start}</button>
	</section>
{/if}
