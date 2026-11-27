<script lang="ts">
	// Autumn Live の人の流れの送り手（docs/autumn-live.md §7.1）。根のレイアウトに 1 つだけ置く。
	// 送るのは「タブごとの匿名の番号・段・施設・流入元」だけ。計測の同意（GA4 と同じ consent()）が granted のときだけ送る。
	// 画面の移動ごと・見えている間 60 秒ごと・閉じるとき（離れた）に送る。失敗しても何もしない（画面の動きに影響させない）。
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { CONSENT_CHANGE_EVENT, consent } from '$lib/analytics';
	import { LIVE_BEACON_PATH, isLiveTrackedPath, liveSourceOf, liveStageOf, newLiveSid, type LiveSource } from '$lib/live-beacon';

	const SID_KEY = 'ab_live_sid';
	const SRC_KEY = 'ab_live_src';
	const HEARTBEAT_MS = 60_000;

	// 最初に開いた画面の URL（utm を読む）。クライアント遷移の後でも、流入元は最初の画面で決める
	const landing = typeof location !== 'undefined' ? location.href : '';
	let sid: string | null = null;
	let source: LiveSource = 'direct';
	let current: { stage: number; facility: string | null } | null = null;

	function session(): boolean {
		if (sid) return true;
		try {
			sid = sessionStorage.getItem(SID_KEY);
			const src = sessionStorage.getItem(SRC_KEY) as LiveSource | null;
			if (!sid) {
				sid = newLiveSid();
				source = liveSourceOf(new URL(landing || location.href), document.referrer);
				sessionStorage.setItem(SID_KEY, sid);
				sessionStorage.setItem(SRC_KEY, source);
			} else if (src) {
				source = src;
			}
			return true;
		} catch {
			sid = null; // 保存できないブラウザ（プライベートモード等）では送らない
			return false;
		}
	}

	function send(leave = false) {
		if (!current || consent() !== 'granted' || !isLiveTrackedPath(location.pathname) || !session() || !sid) return;
		const body = JSON.stringify({ sid, stage: current.stage, facility: current.facility, source, leave });
		try {
			const ok = navigator.sendBeacon?.(LIVE_BEACON_PATH, new Blob([body], { type: 'application/json' }));
			if (!ok) void fetch(LIVE_BEACON_PATH, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
		} catch {
			/* noop */
		}
	}

	afterNavigate(() => {
		current = liveStageOf(page.route.id, page.params as Record<string, string | undefined>);
		send();
	});

	onMount(() => {
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') send();
		}, HEARTBEAT_MS);
		const onVisible = () => {
			if (document.visibilityState === 'visible') send();
		};
		const onHide = () => send(true);
		const onConsent = () => send();
		document.addEventListener('visibilitychange', onVisible);
		window.addEventListener('pagehide', onHide);
		window.addEventListener(CONSENT_CHANGE_EVENT, onConsent);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
			window.removeEventListener('pagehide', onHide);
			window.removeEventListener(CONSENT_CHANGE_EVENT, onConsent);
		};
	});
</script>
