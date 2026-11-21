<script lang="ts">
	// 公式マイページの予約詳細。本体は lib/components/booking/ReservationDetail.svelte（特別会員の専用ページの予約詳細と共用）。
	// 特別会員の専用ページ経由の予約（data.memberPage）は参照のみ（data.readOnly）: 取消・日程変更・オプションのボタンの代わりに
	// 専用ページの予約詳細へのリンクを出す（docs/vip-member-page.md §13.4.4）。
	import BackLink from '$lib/components/BackLink.svelte';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import ReservationDetail from '$lib/components/booking/ReservationDetail.svelte';

	let { data, form } = $props();
	let b = $derived(data.booking);
</script>

<svelte:head><title>{m.reservation_title({ code: b.code })}</title></svelte:head>

<BackLink href="/account/reservations" target={m.reservation_breadcrumb_list()} />

{#if page.url.searchParams.get('amend') === 'prepaid'}
	<p class="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{m.amend_prepaid_blocked()}</p>
{/if}

<ReservationDetail
	data={data}
	{form}
	facility={data.facility}
	hrefs={{ amend: `/account/reservations/${b.code}/amend`, options: `/account/reservations/${b.code}/options` }}
	readOnly={data.readOnly}
	memberPage={data.memberPage ? { pageName: data.memberPage.pageName, cancelMode: data.memberPage.cancelMode, href: data.memberPage.href } : null}
/>

{#if b.guest.address}
	<section class="mt-4 rounded-xl border border-stone-200 bg-white p-4">
		<h2 class="font-medium text-brand-900">{m.contact_address()}</h2>
		<p class="mt-1 break-words text-sm text-stone-700">{[b.guest.zip, b.guest.address, b.guest.address2].filter(Boolean).join(' ')}</p>
	</section>
{/if}

{#if data.receipt}
	<!-- 領収書（カードのオンライン決済分・山人名義の PDF。宛名は入れ直せる・番号は毎回同じ） -->
	<section class="mt-4 rounded-xl border border-stone-200 bg-white p-4">
		<h2 class="font-medium text-brand-900">{m.reservation_receipt_title()}</h2>
		<p class="mt-1 text-xs text-stone-500">{m.reservation_receipt_note()}</p>
		<form method="GET" action={data.receipt.href} class="mt-3 flex flex-wrap items-end gap-2">
			<label class="min-w-0 flex-1 text-sm">
				<span class="text-stone-600">{m.reservation_receipt_addressee()}</span>
				<input name="name" value={data.receipt.addressee} maxlength="60" class="mt-1 block min-h-11 w-full rounded-lg border border-stone-300 px-3 text-sm" />
			</label>
			<button type="submit" class="inline-flex min-h-11 items-center rounded-lg bg-brand-900 px-4 text-sm font-medium text-white hover:bg-brand-800">
				{m.reservation_receipt_download()}
			</button>
		</form>
	</section>
{/if}

{#if data.canPrebookBath}
	<a href={`/r/bath?booking=${encodeURIComponent(b.code)}`} class="mt-4 inline-flex min-h-11 items-center rounded-lg border border-stone-300 px-4 text-sm font-medium text-brand-900 hover:bg-stone-50">
		{m.membership_bath_title()}
	</a>
{/if}
