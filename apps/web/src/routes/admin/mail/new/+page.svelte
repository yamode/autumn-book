<script lang="ts">import MailStudio from '$lib/components/newsletter/MailStudio.svelte';let {data}=$props();</script>
{#key data.facility+data.templateId}<MailStudio {data}/>{/key}
