<script lang="ts">
	// 客室内線の通話シート（全画面）。エンジンは $lib/intercom/guest-call.ts。
	// 相手の音声は非 muted の隠し <video playsinline autoplay> に結線する
	// （taskul-one build 7 の「音声通話が無音」対策と同じ。<audio> だけだと iOS WebView で鳴らないことがあった）。
	import { onDestroy } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { GuestCall, type GuestCallEnd, type GuestCallState } from '$lib/intercom/guest-call';
	import { RemoteVolume, loadVolume } from '$lib/intercom/remote-volume';

	let { open = $bindable(false), phone }: { open: boolean; phone?: string } = $props();

	let phase = $state<GuestCallState>('idle');
	let end = $state<GuestCallEnd | undefined>(undefined);
	let reconnecting = $state(false);
	let muted = $state(false);
	let startedAt = $state<number | null>(null);
	let now = $state(Date.now());
	let media = $state<HTMLVideoElement | null>(null);
	let call: GuestCall | null = null;
	// 音量スライダー（0〜2・端末に保存）。声は RemoteVolume、呼出音などは GuestCall が受け持つ
	let volume = $state(1);
	let voiceBroken = $state(false);
	let rv: RemoteVolume | null = null;
	let tick: ReturnType<typeof setInterval> | null = null;

	const endText: Record<GuestCallEnd, () => string> = {
		hangup: m.intercom_end_hangup,
		remote: m.intercom_end_remote,
		declined: m.intercom_end_declined,
		missed: m.intercom_end_missed,
		failed: m.intercom_end_failed,
		mic: m.intercom_end_mic,
		out_of_hours: m.intercom_end_out_of_hours,
		busy: m.intercom_end_busy,
		rate_limited: m.intercom_end_rate_limited,
		disabled: m.intercom_end_error,
		offline: m.intercom_end_offline,
		error: m.intercom_end_error
	};

	const elapsed = $derived.by(() => {
		if (!startedAt) return '00:00';
		const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
		return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
	});

	/** 「フロントを呼ぶ」から呼ぶ（ユーザー操作の中で getUserMedia を呼ぶ） */
	export function dial() {
		open = true;
		end = undefined;
		muted = false;
		reconnecting = false;
		startedAt = null;
		rv?.dispose();
		rv = new RemoteVolume(
			() => call?.inboundAudioLevel() ?? Promise.resolve(null),
			() => (voiceBroken = true)
		);
		// ユーザー操作の中で AudioContext を用意する（iOS）
		rv.prime();
		volume = rv.value;
		voiceBroken = rv.broken;
		call = new GuestCall({
			onState: (s, e) => {
				phase = s;
				if (s === 'active' && !startedAt) {
					startedAt = Date.now();
					tick = setInterval(() => (now = Date.now()), 500);
				}
				if (s === 'ended') {
					end = e;
					if (tick) clearInterval(tick);
					tick = null;
					rv?.dispose();
					rv = null;
				}
			},
			onRemoteStream: (stream) => {
				if (!media) return;
				rv?.attach(media, stream);
			},
			onReconnecting: (r) => (reconnecting = r)
		});
		call.setToneLevel(volume);
		void call.start();
	}

	function onVolume(e: Event) {
		const v = Number((e.currentTarget as HTMLInputElement).value) / 100;
		volume = v;
		rv?.set(v);
		call?.setToneLevel(v);
	}

	function hangup() {
		void call?.hangup();
	}
	function toggleMute() {
		muted = !muted;
		call?.setMuted(muted);
	}
	function close() {
		if (phase !== 'ended' && phase !== 'idle') hangup();
		open = false;
		phase = 'idle';
	}

	// 画面を閉じられたら呼を片付ける（ページ遷移・タブを閉じる）
	onDestroy(() => {
		if (tick) clearInterval(tick);
		void call?.hangup();
		rv?.dispose();
	});

	const tel = $derived(phone ? 'tel:' + phone.replace(/[^0-9+]/g, '') : '');
	const canRetry = $derived(end === 'missed' || end === 'failed' || end === 'declined' || end === 'remote' || end === 'hangup');
</script>

<svelte:window onpagehide={() => void call?.hangup()} />

{#if open}
	<div class="fixed inset-0 z-[1000] mx-auto flex max-w-md flex-col items-center justify-between bg-stone-900 px-6 pb-10 pt-16 text-white" role="dialog" aria-modal="true" aria-label={m.intercom_call()}>
		<!-- 相手の音声（非 muted の隠し要素） -->
		<video bind:this={media} autoplay playsinline class="pointer-events-none absolute h-px w-px opacity-0"></video>

		<div class="flex flex-col items-center gap-4 text-center">
			<div class="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 {phase === 'ringing' ? 'animate-pulse' : ''}">
				<svg viewBox="0 0 24 24" class="h-11 w-11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 6.2 2 2 0 0 1 6.5 3z" />
				</svg>
			</div>
			<p class="text-lg font-medium">{m.intercom_call()}</p>
			<p class="min-h-[3rem] text-sm text-white/80" aria-live="polite">
				{#if phase === 'starting'}{m.intercom_starting()}
				{:else if phase === 'ringing'}{m.intercom_ringing()}
				{:else if phase === 'connecting'}{m.intercom_connecting()}
				{:else if phase === 'active'}{reconnecting ? m.intercom_reconnecting() : `${m.intercom_active()}  ${elapsed}`}
				{:else if phase === 'ended' && end}{endText[end]()}
				{/if}
			</p>
			{#if phase === 'active' || phase === 'connecting' || phase === 'ringing'}
				<p class="text-xs text-white/60">{m.intercom_keep_open()}</p>
			{/if}
		</div>

		<div class="flex w-full flex-col items-center gap-4">
			{#if phase === 'ringing' || phase === 'connecting' || phase === 'active'}
				<label class="flex w-full items-center gap-3 text-xs text-white/80">
					<svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M4 9h3l5-4v14l-5-4H4z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
					</svg>
					<input type="range" min="0" max="200" step="10" value={Math.round(volume * 100)} oninput={onVolume} aria-label={m.intercom_volume()} class="h-2 flex-1 accent-emerald-500" />
					<span class="w-11 text-right tabular-nums">{Math.round(volume * 100)}%</span>
				</label>
				{#if voiceBroken}
					<p class="-mt-2 text-[11px] text-white/50">{m.intercom_volume_voice_unavailable()}</p>
				{/if}
			{/if}
			{#if phase === 'ended'}
				{#if canRetry}
					<button type="button" onclick={dial} class="w-full rounded-full bg-emerald-600 py-3 text-base font-medium">{m.intercom_retry()}</button>
				{/if}
				{#if tel && (end === 'failed' || end === 'missed' || end === 'mic' || end === 'error' || end === 'disabled' || end === 'offline')}
					<a href={tel} class="w-full rounded-full border border-white/40 py-3 text-center text-base">{m.intercom_fallback_tel()}</a>
				{/if}
				<button type="button" onclick={close} class="w-full rounded-full bg-white/10 py-3 text-base">{m.intercom_close()}</button>
			{:else}
				<div class="flex items-center justify-center gap-10">
					{#if phase === 'active'}
						<button type="button" onclick={toggleMute} class="flex flex-col items-center gap-1.5" aria-pressed={muted}>
							<span class="flex h-16 w-16 items-center justify-center rounded-full {muted ? 'bg-white text-stone-900' : 'bg-white/15'}">
								<svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
									<rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
									{#if muted}<path d="M4 4l16 16" />{/if}
								</svg>
							</span>
							<span class="text-xs">{muted ? m.intercom_unmute() : m.intercom_mute()}</span>
						</button>
					{/if}
					<button type="button" onclick={hangup} class="flex flex-col items-center gap-1.5">
						<span class="flex h-16 w-16 items-center justify-center rounded-full bg-red-600">
							<svg viewBox="0 0 24 24" class="h-7 w-7 rotate-[135deg]" fill="currentColor" aria-hidden="true">
								<path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 6.2 2 2 0 0 1 6.5 3z" />
							</svg>
						</span>
						<span class="text-xs">{phase === 'active' ? m.intercom_hangup() : m.intercom_cancel()}</span>
					</button>
				</div>
			{/if}
			<p class="text-[11px] text-white/50">{m.intercom_emergency()}</p>
		</div>
	</div>
{/if}
