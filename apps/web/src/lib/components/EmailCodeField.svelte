<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';

	let input: HTMLInputElement;
	const hintId = $props.id();

	onMount(() => {
		input.focus();
	});

	function pasteCode(event: ClipboardEvent) {
		const code = event.clipboardData?.getData('text').normalize('NFKC').replace(/\s+/g, '');
		if (!code || !/^\d{8}$/.test(code)) return;
		event.preventDefault();
		input.value = code;
	}
</script>

<div>
	<label class="block text-sm">
		<span class="text-stone-600">{m.auth_otp_code_label()}</span>
		<input bind:this={input} type="text" name="token" inputmode="numeric" autocomplete="one-time-code"
			autocapitalize="off" spellcheck={false} maxlength="8" required placeholder={m.auth_otp_code_placeholder()}
			aria-describedby={hintId} onpaste={pasteCode}
			class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-center text-lg tracking-[0.4em]" />
	</label>
	<p id={hintId} class="mt-2 text-sm text-stone-600">{m.auth_otp_autofill_hint()}</p>
</div>
