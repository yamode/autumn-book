<script lang="ts">
	// 事前チェックインの OTA 誘導バナー（P3・docs/pre-checkin.md §8）。公式サイト予約・取引先経由には出さない（呼び出し側で showOtaBanner）。
	//   variant='card'  … 完了画面のカード（特典つき）
	//   variant='strip' … 各ステップの下の控えめな帯
	// 特典はコード/DB に実在するものだけ: ポイント還元（1pt=1円で次回の予約に使える）・入会ボーナス（book.member_program_settings）。
	// 文言は固定（管理画面での編集はしない）。
	import * as m from '$lib/paraglide/messages';

	let { href, variant = 'card', welcomeBonus = 0 }: { href: string; variant?: 'card' | 'strip'; welcomeBonus?: number } = $props();
</script>

{#if variant === 'strip'}
	<a {href} class="mt-6 block rounded-xl bg-white/70 px-4 py-2.5 text-center text-xs text-stone-600 ring-1 ring-stone-200">
		{m.ci_ota_strip()} <span class="underline">{m.ci_ota_cta()}</span>
	</a>
{:else}
	<section class="mt-4 rounded-2xl bg-white p-5 text-sm shadow-sm ring-1 ring-amber-200">
		<h2 class="text-base font-semibold">{m.ci_ota_title()}</h2>
		<ul class="mt-2 list-disc space-y-1 pl-5 leading-relaxed text-stone-700">
			<li>{m.ci_ota_points()}</li>
			{#if welcomeBonus > 0}<li>{m.ci_ota_welcome({ points: welcomeBonus.toLocaleString('ja-JP') })}</li>{/if}
		</ul>
		<a {href} class="mt-4 block w-full rounded-xl bg-amber-600 py-3 text-center text-sm font-medium text-white">{m.ci_ota_cta()}</a>
	</section>
{/if}
