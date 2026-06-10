<script lang="ts">
	import '../app.css';
	import DebugPanel from '$lib/components/DebugPanel.svelte';

	let { children } = $props();
</script>

{@render children()}
<DebugPanel />
