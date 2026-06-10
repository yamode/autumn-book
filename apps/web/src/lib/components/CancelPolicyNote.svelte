<script lang="ts">
	import { cancelPolicyLabel, type CancellationPolicy } from '@autumn-book/core';

	let { policy, checkin }: { policy: CancellationPolicy; checkin: string } = $props();
</script>

{cancelPolicyLabel(policy, checkin)}
