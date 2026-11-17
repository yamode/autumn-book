<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { values, required = false, error, inputClass }: {
		values?: { zip?: string; address?: string; address2?: string } | null;
		required?: boolean;
		error?: string;
		inputClass: string;
	} = $props();
</script>

<div class="grid gap-3 sm:grid-cols-2">
	<label class="block text-sm text-stone-600">
		{m.contact_zip()}
		<input name="zip" autocomplete="postal-code" maxlength="24" value={values?.zip ?? ''} class={inputClass} />
	</label>
	<label class="block text-sm text-stone-600 sm:col-span-2">
		{m.contact_address()}{#if required} <span class="text-red-600">{m.hold_required()}</span>{/if}
		<input name="address" autocomplete="address-line1" maxlength="250" {required} value={values?.address ?? ''} aria-invalid={error ? 'true' : undefined} class={inputClass} />
		{#if error}<span class="mt-1 block text-xs text-red-700">{error}</span>{/if}
	</label>
	<label class="block text-sm text-stone-600 sm:col-span-2">
		{m.contact_address2()}
		<input name="address2" autocomplete="address-line2" maxlength="250" value={values?.address2 ?? ''} class={inputClass} />
	</label>
</div>
