<script lang="ts">import MailStudio from '$lib/components/newsletter/MailStudio.svelte';let {data}=$props();</script>
{#key data.campaign.id}<MailStudio {data}/>{/key}
