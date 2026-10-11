<script lang="ts">
	// 公式マイページの予約詳細。本体は lib/components/booking/ReservationDetail.svelte（特別会員の専用ページの予約詳細と共用）。
	// 特別会員の専用ページ経由の予約（data.memberPage）は参照のみ（data.readOnly）: 取消・日程変更・オプションのボタンの代わりに
	// 専用ページの予約詳細へのリンクを出す（docs/vip-member-page.md §13.4.4）。
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import ReservationDetail from '$lib/components/booking/ReservationDetail.svelte';

	let { data, form } = $props();
	let b = $derived(data.booking);
</script>

<svelte:head><title>{m.reservation_title({ code: b.code })}</title></svelte:head>

<nav class="mb-4 text-xs text-stone-400"><a href="/account" class="hover:underline">{m.reservation_breadcrumb_list()}</a> / {b.code}</nav>

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
