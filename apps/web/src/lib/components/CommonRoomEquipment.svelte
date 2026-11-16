<script lang="ts">
  import PartnerContentBody from './PartnerContentBody.svelte';
  import type { ContentSection } from '$lib/partner-contents';

  let { equipment, label }: {
    equipment: { amenities: string[]; sections: ContentSection[] };
    label: string;
  } = $props();
</script>

{#if equipment.sections.length || equipment.amenities.length}
  <section class="mt-4 rounded-xl bg-stone-50 p-3 sm:px-5" aria-label={label}>
    <PartnerContentBody photos={[]} description="" specs={[]} {...equipment} detailLabel={label} />
  </section>
{/if}
