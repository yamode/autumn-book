<script lang="ts">
	import AccountOverview from '../AccountOverview.svelte';
	let { data } = $props();
</script>

<AccountOverview {data} reservationsOnly />
