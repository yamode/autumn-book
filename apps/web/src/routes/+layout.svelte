<script lang="ts">
	import '../app.css';
	import DebugPanel from '$lib/components/DebugPanel.svelte';
	import AnalyticsConsent from '$lib/components/AnalyticsConsent.svelte';

	let { children } = $props();
</script>

{@render children()}
<AnalyticsConsent />
<DebugPanel />
