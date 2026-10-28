<script lang="ts">
	// GA4 ローダー + Consent Mode v2 同意バナー（設計書 §9）。
	// バナーは EEA・英国・スイス・国不明からのアクセスだけに出す（2026-10-21。判定は $lib/consent-region・サーバーの国情報）。
	// それ以外の地域は確認を出さずに計測し、プライバシーポリシーの「停止する」（AnalyticsOptOut）で止められる。
	// PUBLIC_GA4_MEASUREMENT_ID 未設定なら何も描画・ロードしない。
	// 文言はメンテナンスページと同じ自己完結ロケール分岐（messages/*.json には持たない）。
	import { browser } from '$app/environment';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';
	import { getLocale } from '$lib/paraglide/runtime';
	import { dbg } from '$lib/debug';
	import { gaPageLocation } from '$lib/ga-page-location';
	import {
		CONSENT_CHANGE_EVENT,
		consent as effectiveConsent,
		discardGaEvents,
		flushGaEvents,
		saveConsent,
		setConsentRegion
	} from '$lib/analytics';
	import type { ExperimentAssignment } from '$lib/experiments';

	const gaId = env.PUBLIC_GA4_MEASUREMENT_ID ?? '';

	// 'ssr'=hydration 前（バナー非表示）→ 'unset'（未回答・バナー表示）/ 'granted' / 'denied'
	let consent = $state<'ssr' | 'unset' | 'granted' | 'denied'>('ssr');

	const texts: Record<string, { msg: string; accept: string; decline: string }> = {
		ja: {
			msg: '当サイトはサービス改善のため Google Analytics によるアクセス解析を使用します。同意いただける場合は「同意する」を押してください。',
			accept: '同意する',
			decline: '同意しない'
		},
		en: {
			msg: 'We use Google Analytics to improve our services. Please choose whether to allow analytics cookies.',
			accept: 'Accept',
			decline: 'Decline'
		},
		'zh-TW': {
			msg: '本網站使用 Google Analytics 以改善服務品質。請選擇是否允許分析 Cookie。',
			accept: '同意',
			decline: '不同意'
		}
	};
	const t = texts[getLocale()] ?? texts.ja;

	// 計測対象は公開面のみ。/admin（社内）と /r（滞在トークンが URL に載る）・/p（取引先の限定トークン）は除外。
	function isExcluded(path: string): boolean {
		const p = path.replace(/^\/(en|zh-TW)(?=\/|$)/, '');
		return /^\/(admin|r|p)(\/|$)/.test(p);
	}

	function gtag(..._args: unknown[]) {
		// gtag.js は Arguments オブジェクトを期待するため rest ではなく arguments を積む
		// eslint-disable-next-line prefer-rest-params
		(window as any).dataLayer.push(arguments);
	}

	function initGtag() {
		const w = window as any;
		if (w.gtag) return;
		w.dataLayer = w.dataLayer ?? [];
		w.gtag = gtag;
		// Google のタグは解析への同意後にだけ読み込む。広告系は常に denied。
		gtag('consent', 'default', {
			ad_storage: 'denied',
			ad_user_data: 'denied',
			ad_personalization: 'denied',
			analytics_storage: 'granted'
		});
		gtag('js', new Date());
		// SPA 遷移は afterNavigate で手動送信するため自動 page_view は無効化
		gtag('config', gaId, { send_page_view: false });
		const s = document.createElement('script');
		s.async = true;
		s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
		document.head.appendChild(s);
		flushGaEvents();
		dbg('ga4 loaded', gaId);
	}

	function ensureInit() {
		if (!browser || !gaId || isExcluded(location.pathname)) return;
		// 本人の選択（localStorage）が最優先。選んでいなければ地域で決まる（同意の要らない地域は granted）
		setConsentRegion(page.data.consentRequired !== false);
		const c = effectiveConsent();
		if (c === 'granted') initGtag();
		if (consent === 'ssr') consent = c;
	}

	// プライバシーポリシーの「停止する／再開する」から変わったとき（読み込み済みの GA もその場で止める）
	function applyConsentChange() {
		const w = window as any;
		const next = effectiveConsent();
		consent = next;
		if (next === 'granted') {
			delete w[`ga-disable-${gaId}`];
			if (w.gtag) w.gtag('consent', 'update', { analytics_storage: 'granted' });
		} else {
			w[`ga-disable-${gaId}`] = true;
			if (w.gtag) w.gtag('consent', 'update', { analytics_storage: 'denied' });
			discardGaEvents();
		}
	}
	$effect(() => {
		if (!browser || !gaId) return;
		window.addEventListener(CONSENT_CHANGE_EVENT, applyConsentChange);
		return () => window.removeEventListener(CONSENT_CHANGE_EVENT, applyConsentChange);
	});

	function pageLocation() {
		// GA に予約コードや URL の検索条件・トークンを送らない（utm_* だけは流入元の計測に残す）。
		return gaPageLocation(location.origin, location.pathname, location.search);
	}

	function trackPage() {
		if (!browser || !gaId || consent !== 'granted' || isExcluded(location.pathname)) return;
		if ((page.data.abExperiments ?? []).some((assignment: ExperimentAssignment) => assignment.preview)) return;
		initGtag();
		const assignments = ((page.data.abExperiments ?? []) as ExperimentAssignment[]).filter((assignment) => !assignment.preview);
		gtag('event', 'page_view', {
			page_location: pageLocation(),
			page_title: document.title,
			...(assignments.length ? { experiment_assignments: assignments.map((item) => `${item.id}:${item.revision}:${item.variant}`).join(',') } : {})
		});
		for (const assignment of assignments) {
			const key = `ab_exposure_${assignment.id}_${assignment.revision}_${assignment.variant}`;
			try {
				if (sessionStorage.getItem(key)) continue;
				sessionStorage.setItem(key, '1');
			} catch {
				// sessionStorage が使えなくても計測する。
			}
			gtag('event', 'experiment_exposure', {
				experiment_id: assignment.id,
				experiment_revision: assignment.revision,
				experiment_variant: assignment.variant,
				page_location: pageLocation()
			});
		}
	}

	$effect(() => {
		ensureInit();
	});

	afterNavigate(() => {
		if (!browser || !gaId || isExcluded(location.pathname)) return;
		ensureInit();
		trackPage();
	});

	function choose(granted: boolean) {
		saveConsent(granted ? 'granted' : 'denied');
		consent = granted ? 'granted' : 'denied';
		if (granted) trackPage();
		else discardGaEvents();
		dbg('ga4 consent', consent);
	}
</script>

{#if gaId && consent === 'unset' && !isExcluded(page.url.pathname)}
	<div
		class="fixed inset-x-0 bottom-0 z-[60] border-t border-stone-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur"
		role="dialog"
		aria-live="polite"
	>
		<div class="mx-auto flex max-w-3xl flex-col items-center gap-2 sm:flex-row sm:justify-between">
			<p class="text-xs leading-relaxed text-stone-600">{t.msg}</p>
			<div class="flex shrink-0 gap-2">
				<button
					class="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50"
					onclick={() => choose(false)}>{t.decline}</button
				>
				<button
					class="rounded-lg bg-brand-900 px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
					onclick={() => choose(true)}>{t.accept}</button
				>
			</div>
		</div>
	</div>
{/if}
