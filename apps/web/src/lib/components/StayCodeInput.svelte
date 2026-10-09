<script lang="ts">
	// 客室案内の手入力コード（6桁）の入力欄（2026-10-09）。
	// 見た目は6つのマス。実体は1つの <input>（数字キーボード・ワンタイムコードの自動入力・貼り付けに対応）をマスの上に
	// 透明で重ね、打った数字をマスに映す。6桁そろったら少し待って自動で送る（2026-10-09 以前に発行した8桁の番号は
	// 続けて打てばマスが8つに増え、8桁そろった時点で送る）。違っていたら揺らして消し、すぐ打ち直せるようにする。
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import * as m from '$lib/paraglide/messages';

	let { autofocus = false }: { autofocus?: boolean } = $props();

	const LEN = 6;
	const LEGACY_LEN = 8;
	// 6桁そろってから送るまでの間（8桁の旧番号を打ち続ける人の分だけ待つ）
	const SUBMIT_DELAY_MS = 450;

	let value = $state('');
	let focused = $state(false);
	let submitting = $state(false);
	let shake = $state(false);
	let inputEl = $state<HTMLInputElement | null>(null);
	let formEl = $state<HTMLFormElement | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;

	const slots = $derived(Math.max(LEN, Math.min(value.length, LEGACY_LEN)));
	const ready = $derived(value.length === LEN || value.length === LEGACY_LEN);

	$effect(() => {
		if (autofocus && inputEl) inputEl.focus({ preventScroll: true });
	});

	function onInput(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		const digits = el.value.replace(/\D/g, '').slice(0, LEGACY_LEN);
		value = digits;
		el.value = digits;
		clearTimeout(timer);
		if (submitting) return;
		if (digits.length === LEGACY_LEN) submit();
		else if (digits.length === LEN) timer = setTimeout(submit, SUBMIT_DELAY_MS);
	}

	function submit() {
		clearTimeout(timer);
		if (!ready || submitting) return;
		formEl?.requestSubmit();
	}

	async function fail() {
		value = '';
		if (inputEl) inputEl.value = '';
		shake = true;
		try {
			navigator.vibrate?.(60);
		} catch {
			/* 振動できない端末は何もしない */
		}
		setTimeout(() => (shake = false), 450);
		await tick();
		inputEl?.focus({ preventScroll: true });
	}
</script>

<form
	bind:this={formEl}
	method="POST"
	action="?/claim"
	class="mt-4 space-y-3"
	use:enhance={() => {
		submitting = true;
		return async ({ result, update }) => {
			submitting = false;
			if (result.type === 'failure') {
				await update({ reset: false });
				await fail();
				return;
			}
			await update();
		};
	}}
>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="relative mx-auto w-fit" class:shake onclick={() => inputEl?.focus()}>
		<div class={`flex ${slots > LEN ? 'gap-1.5' : 'gap-2'}`} aria-hidden="true">
			{#each Array.from({ length: slots }) as _, i}
				{@const active = focused && !submitting && (i === value.length || (i === slots - 1 && value.length >= slots))}
				<div
					class={`flex h-14 ${slots > LEN ? 'w-8' : 'w-11'} items-center justify-center rounded-lg border-2 bg-white font-mono text-2xl font-semibold tabular-nums text-stone-900 transition ${
						active ? 'border-stone-800 shadow-[0_0_0_3px_rgba(41,37,36,0.12)]' : value[i] ? 'border-stone-400' : 'border-stone-200'
					} ${submitting ? 'opacity-50' : ''}`}
				>
					{#if value[i]}
						<span class="pop">{value[i]}</span>
					{:else if active}
						<span class="caret h-7 w-0.5 rounded bg-stone-800"></span>
					{/if}
				</div>
			{/each}
		</div>
		<!-- 実体の入力欄（マスの上に透明で重ねる。16px 以上にして iOS の拡大を防ぐ） -->
		<input
			bind:this={inputEl}
			name="code"
			type="text"
			inputmode="numeric"
			pattern="[0-9]*"
			autocomplete="one-time-code"
			enterkeyhint="go"
			maxlength={LEGACY_LEN}
			aria-label={m.inroom_code_aria()}
			readonly={submitting}
			oninput={onInput}
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					submit();
				}
			}}
			class="absolute inset-0 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent opacity-0 outline-none"
		/>
	</div>
	<button
		type="submit"
		disabled={!ready || submitting}
		class="w-full rounded-md bg-stone-800 py-3 text-sm font-medium text-white transition hover:bg-stone-700 disabled:bg-stone-300"
	>
		{submitting ? m.inroom_code_checking() : m.inroom_code_submit()}
	</button>
</form>

<style>
	.caret {
		animation: blink 1s steps(1) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
	.pop {
		animation: pop 0.14s ease-out;
	}
	@keyframes pop {
		from {
			transform: scale(0.6);
			opacity: 0.3;
		}
	}
	.shake {
		animation: shake 0.42s ease-in-out;
	}
	@keyframes shake {
		20%,
		60% {
			transform: translateX(-8px);
		}
		40%,
		80% {
			transform: translateX(8px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.caret,
		.pop,
		.shake {
			animation: none;
		}
	}
</style>
