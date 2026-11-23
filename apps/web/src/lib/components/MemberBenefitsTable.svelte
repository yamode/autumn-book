<script lang="ts">
	import { tick } from 'svelte';
	import { rankName } from '$lib/rank-name';
	import { memberDisplayRanks, rankCondition, type MemberDisplayRank } from '$lib/member-rank';
	import { favoriteRoomMinRank, forumWriteMinRank, limitedSaleMinRank, stayPersonalizationMinRank } from '$lib/member-benefits';
	// 会員先行予約と限定販売プランは実装が同じ（会員限定プラン＋グレード＋販売期間）なので 1 行にまとめた（2026-11-23）
	import * as m from '$lib/paraglide/messages';
	import { siteText, type SiteTexts } from '$lib/member-benefit-texts';
	import { enhance } from '$lib/enhance';
	import { page } from '$app/state';

	// texts: 管理画面で上書きした文言（book.site_texts・無ければ元の文言）
	// edit: 管理画面だけ。特典を押すと開く窓で、その場で文言（3言語）を編集できる（2026-11-23）
	type EditItem = { label: string; multiline?: boolean; defaults: Record<string, string>; values: Record<string, string> };
	let {
		printable = false,
		texts = {},
		edit = null
	}: {
		printable?: boolean;
		texts?: SiteTexts;
		edit?: { items: Record<string, EditItem>; canEdit: boolean; extra?: { id: string; title: string; keys: string[] }[] } | null;
	} = $props();
	const EDIT_LOCALES = [
		{ code: 'ja', label: '日本語' },
		{ code: 'en', label: 'English' },
		{ code: 'zh-TW', label: '繁體中文' }
	] as const;
	let editLocale = $state<'ja' | 'en' | 'zh-TW'>('ja');
	const tx = (key: string, fallback: () => string) => siteText(texts, key, fallback);

	const rates: Record<MemberDisplayRank, number> = { standard: 1, silver: 2, gold: 3 };

	// id: 窓を開き直しても最新の文言を出すための目印。keys: 管理画面で編集する文言のキー（並び順どおりに出す）
	type Detail = { id: string; title: string; body: string; sections?: { title: string; body: string }[]; keys: string[] };
	type Perk = Detail & { key: string; minRank: MemberDisplayRank; availableToGuests?: boolean; guestNote?: string };

	const points: Detail = $derived({ id: 'points', keys: ['membership_rate_label', 'membership_how_body'], title: tx('membership_rate_label', m.membership_rate_label), body: tx('membership_how_body', m.membership_how_body) });
	const qualification: Detail = $derived({
		id: 'qualification',
		keys: ['membership_condition_label', 'membership_rank_note', 'membership_rank_grace_title', 'membership_rank_grace'],
		title: tx('membership_condition_label', m.membership_condition_label),
		body: tx('membership_rank_note', m.membership_rank_note),
		sections: [{ title: tx('membership_rank_grace_title', m.membership_rank_grace_title), body: tx('membership_rank_grace', m.membership_rank_grace) }]
	});
	const perks: Perk[] = $derived([
		{ key: 'booking-cancel', id: 'booking-cancel', keys: ['membership_booking_cancel_t', 'membership_booking_cancel_b'], minRank: 'standard', availableToGuests: true, title: tx('membership_booking_cancel_t', m.membership_booking_cancel_t), body: tx('membership_booking_cancel_b', m.membership_booking_cancel_b) },
		{ key: 'onsite-payment', id: 'onsite-payment', keys: ['membership_onsite_payment_t', 'membership_onsite_payment_b', 'membership_card_only'], minRank: 'standard', guestNote: tx('membership_card_only', m.membership_card_only), title: tx('membership_onsite_payment_t', m.membership_onsite_payment_t), body: tx('membership_onsite_payment_b', m.membership_onsite_payment_b) },
		{ key: 'early-payment', id: 'early-payment', keys: ['membership_early_payment_title', 'membership_early_payment_body'], minRank: 'standard', title: tx('membership_early_payment_title', m.membership_early_payment_title), body: tx('membership_early_payment_body', m.membership_early_payment_body) },
		{ key: 'bath', id: 'bath', keys: ['membership_bath_title', 'membership_bath_body'], minRank: 'standard', title: tx('membership_bath_title', m.membership_bath_title), body: tx('membership_bath_body', m.membership_bath_body) },
		{ key: 'upgrade', id: 'upgrade', keys: ['membership_upgrade_title', 'membership_upgrade_body'], minRank: 'gold', title: tx('membership_upgrade_title', m.membership_upgrade_title), body: tx('membership_upgrade_body', m.membership_upgrade_body) },
		{ key: 'advance', id: 'advance', keys: ['membership_benefit_advance_t', 'membership_advance_silver_body'], minRank: limitedSaleMinRank, title: tx('membership_benefit_advance_t', m.membership_benefit_advance_t), body: tx('membership_advance_silver_body', m.membership_advance_silver_body) },
		{ key: 'room', id: 'room', keys: ['membership_room_designation', 'membership_room_designation_body'], minRank: favoriteRoomMinRank, title: tx('membership_room_designation', m.membership_room_designation), body: tx('membership_room_designation_body', m.membership_room_designation_body) },
		{ key: 'cancellation', id: 'cancellation', keys: ['membership_benefit_cancel_t', 'membership_benefit_cancel_b'], minRank: 'gold', title: tx('membership_benefit_cancel_t', m.membership_benefit_cancel_t), body: tx('membership_benefit_cancel_b', m.membership_benefit_cancel_b) },
		{ key: 'personalize', id: 'personalize', keys: ['membership_benefit_personalize_t', 'membership_personalize_body'], minRank: stayPersonalizationMinRank, title: tx('membership_benefit_personalize_t', m.membership_benefit_personalize_t), body: tx('membership_personalize_body', m.membership_personalize_body) },
		{
			key: 'changes', id: 'changes', keys: ['membership_basic_changes', 'membership_basic_changes_body', 'membership_change_date_t', 'membership_change_date_b', 'membership_change_guests_t', 'membership_change_guests_b', 'membership_change_room_t', 'membership_change_room_b'], minRank: 'standard', title: tx('membership_basic_changes', m.membership_basic_changes), body: tx('membership_basic_changes_body', m.membership_basic_changes_body),
			sections: [
				{ title: tx('membership_change_date_t', m.membership_change_date_t), body: tx('membership_change_date_b', m.membership_change_date_b) },
				{ title: tx('membership_change_guests_t', m.membership_change_guests_t), body: tx('membership_change_guests_b', m.membership_change_guests_b) },
				{ title: tx('membership_change_room_t', m.membership_change_room_t), body: tx('membership_change_room_b', m.membership_change_room_b) }
			]
		},
		{ key: 'community', id: 'community', keys: ['membership_benefit_community_t', 'membership_benefit_community_b'], minRank: forumWriteMinRank, title: tx('membership_benefit_community_t', m.membership_benefit_community_t), body: tx('membership_benefit_community_b', m.membership_benefit_community_b) },
		{ key: 'otayori', id: 'otayori', keys: ['membership_benefit_otayori_t', 'membership_benefit_otayori_b'], minRank: 'standard', title: tx('membership_benefit_otayori_t', m.membership_benefit_otayori_t), body: tx('membership_benefit_otayori_b', m.membership_benefit_otayori_b) }
	]);
	const orderedPerks = $derived([...perks].sort((a, b) => memberDisplayRanks.indexOf(a.minRank) - memberDisplayRanks.indexOf(b.minRank)));

	function perkAudience(perk: Perk) {
		if (perk.availableToGuests) return m.membership_all_bookings();
		if (perk.minRank === 'standard') return m.membership_all_members();
		const rank = rankName(perk.minRank);
		return perk.minRank === memberDisplayRanks.at(-1) ? rank : m.membership_rank_and_above({ rank });
	}

	let detailId = $state<string | null>(null);
	const extraDetails = $derived<Detail[]>((edit?.extra ?? []).map((x) => ({ id: x.id, title: x.title, body: '', keys: x.keys })));
	const detail = $derived<Detail | null>(
		detailId === null ? null : ([points, qualification, ...perks, ...extraDetails].find((d) => d.id === detailId) ?? null)
	);
	// 保存できたキー（窓の中に「保存しました」を出す）
	const savedKeys = $derived(((page.form as { savedKeys?: string[] } | null)?.savedKeys ?? []) as string[]);
	const saveError = $derived(((page.form as { textError?: string } | null)?.textError ?? '') as string);
	let dialog: HTMLDialogElement | undefined = $state();

	$effect(() => {
		const element = dialog;
		if (!element) return;
		function closeOutside(event: MouseEvent) {
			if (event.target !== element) return;
			const bounds = element!.getBoundingClientRect();
			if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) element!.close();
		}
		element.addEventListener('click', closeOutside);
		return () => element.removeEventListener('click', closeOutside);
	});
	async function openDetail(item: Detail) {
		detailId = item.id;
		await tick();
		if (dialog && !dialog.open) dialog.showModal();
	}
</script>

{#snippet perkStatus(included: boolean)}
	{#if included}
		<span class="benefit-check" aria-hidden="true">✓</span><span class="sr-only">{m.membership_included()}</span>
	{:else}
		<span class="benefit-dash" aria-hidden="true">—</span><span class="sr-only">{m.membership_not_included()}</span>
	{/if}
{/snippet}

{#snippet mobileDetail(item: Detail)}
	<button type="button" class="mobile-detail" onclick={() => openDetail(item)} aria-haspopup="dialog">
		<span>{item.title}</span><span class="detail-chevron" aria-hidden="true"></span>
	</button>
{/snippet}

{#if !printable}
	<div class="mobile-comparison mt-5 space-y-5">
		<section class="mobile-panel" aria-labelledby="mobile-membership-rates">
			<h3 id="mobile-membership-rates" class="mobile-heading">{@render mobileDetail(points)}</h3>
			<ul class="rate-grid">
				<li class="rate-card guest-card tier-guest">
					<span class="mobile-rank-name">{m.membership_guest_booking()}</span>
					<span class="rate">0<span class="rate-unit">%</span></span>
				</li>
				{#each memberDisplayRanks as rank (rank)}
					<li class="rate-card tier-{rank}">
						<span class="mobile-rank-name">{rankName(rank)}</span>
						<span class="rate">{rates[rank]}<span class="rate-unit">%</span></span>
						<span class="condition">{rankCondition(rank)}</span>
					</li>
				{/each}
			</ul>
			<div class="condition-detail">{@render mobileDetail(qualification)}</div>
		</section>

		<section class="mobile-panel" aria-labelledby="mobile-membership-perks">
			<h3 id="mobile-membership-perks" class="mobile-heading px-4 py-3.5">{tx('membership_benefits_heading', m.membership_benefits_heading)}</h3>
			<ul class="perk-list">
				{#each orderedPerks as perk (perk.key)}
					<li>
						<button type="button" class="mobile-detail perk-detail" onclick={() => openDetail(perk)} aria-haspopup="dialog">
							<span class="min-w-0">
								<span class="block">{perk.title}</span>
								{#if perk.guestNote}
									<span class="mt-1 block text-xs font-normal text-stone-600">{m.membership_guest_booking()} · {perk.guestNote}</span>
								{/if}
							</span>
							<span class="perk-audience tier-{perk.availableToGuests ? 'guest' : perk.minRank}">{perkAudience(perk)}</span>
							<span class="detail-chevron" aria-hidden="true"></span>
						</button>
					</li>
				{/each}
			</ul>
		</section>
	</div>
{/if}

<div class:printable class="comparison-frame mt-2 overflow-x-auto rounded-2xl border border-stone-200 bg-white md:mt-6">
	<table class="grade-table w-full table-fixed text-sm">
		<colgroup>
			<col class="feature-col" />
			<col span={memberDisplayRanks.length + 1} />
		</colgroup>
		<thead>
			<tr>
				<th scope="col" class="row-head text-left font-medium">{tx('membership_benefits_heading', m.membership_benefits_heading)}</th>
				<th scope="col" class="tier-head tier-guest">{m.membership_guest_booking()}</th>
				{#each memberDisplayRanks as rank (rank)}
					<th scope="col" class="tier-head tier-{rank}">
						<span class="rank-mark" aria-hidden="true"></span>
						<span>{rankName(rank)}</span>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			<tr>
				<th scope="row" class="row-head">
					<button type="button" class="detail-link" onclick={() => openDetail(points)} aria-haspopup="dialog">
						{points.title}{#if edit}<span class="ml-1.5 text-xs font-normal text-stone-400" aria-hidden="true">✎</span>{/if}
					</button>
				</th>
				<td class="guest-value"><span class="rate">0<span class="rate-unit">%</span></span></td>
				{#each memberDisplayRanks as rank (rank)}
					<td><span class="rate">{rates[rank]}<span class="rate-unit">%</span></span></td>
				{/each}
			</tr>
			<tr>
				<th scope="row" class="row-head">
					<button type="button" class="detail-link" onclick={() => openDetail(qualification)} aria-haspopup="dialog">
						{qualification.title}{#if edit}<span class="ml-1.5 text-xs font-normal text-stone-400" aria-hidden="true">✎</span>{/if}
					</button>
				</th>
				<td class="guest-value">{@render perkStatus(false)}</td>
				{#each memberDisplayRanks as rank (rank)}<td class="condition">{rankCondition(rank)}</td>{/each}
			</tr>
			{#each orderedPerks as perk (perk.key)}
				<tr>
					<th scope="row" class="row-head">
						<button type="button" class="detail-link" onclick={() => openDetail(perk)} aria-haspopup="dialog">
							{perk.title}{#if edit}<span class="ml-1.5 text-xs font-normal text-stone-400" aria-hidden="true">✎</span>{/if}
						</button>
					</th>
					<td class="guest-value">
						{#if perk.guestNote}
							<span class="text-xs font-medium">{perk.guestNote}</span>
						{:else}
							{@render perkStatus(perk.availableToGuests === true)}
						{/if}
					</td>
					{#each memberDisplayRanks as rank, index (rank)}
						<td>
							{@render perkStatus(index >= memberDisplayRanks.indexOf(perk.minRank))}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

{#if edit && extraDetails.length}
	<!-- 管理画面: 表の外の文言（ページの見出し・導入文など）も同じ窓で編集する -->
	<div class="mt-4 flex flex-wrap gap-2 print:hidden">
		{#each extraDetails as d (d.id)}
			<button type="button" onclick={() => openDetail(d)} class="inline-flex min-h-10 items-center rounded-full border border-stone-300 bg-white px-4 text-sm text-brand-800 hover:bg-stone-50">{d.title}を編集</button>
		{/each}
	</div>
{/if}

<dialog bind:this={dialog} aria-labelledby="membership-detail-title" class="perk-dialog">
	{#if detail}
		<div class="flex items-start justify-between gap-3">
			<h2 id="membership-detail-title" class="text-xl font-semibold text-brand-900">{detail.title}</h2>
			<form method="dialog">
				<button type="submit" class="grid h-10 w-10 place-items-center rounded-full border border-stone-200 text-xl text-stone-700 hover:bg-stone-100" aria-label={m.membership_detail_close()}>×</button>
			</form>
		</div>
		{#if edit}
			<!-- 管理画面: その場で編集（空欄にすると元の文言に戻る・保存先は book.site_texts） -->
			<div class="mt-4 flex gap-1 rounded-lg bg-stone-100 p-1 text-sm" role="tablist" aria-label="言語">
				{#each EDIT_LOCALES as l (l.code)}
					<button type="button" role="tab" aria-selected={editLocale === l.code} onclick={() => (editLocale = l.code)}
						class="min-h-9 flex-1 rounded-md px-3 {editLocale === l.code ? 'bg-white font-semibold text-brand-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}">{l.label}</button>
				{/each}
			</div>
			<form method="POST" action="?/saveTexts" use:enhance class="mt-4 space-y-4">
				{#each detail.keys as k (k)}
					{@const item = edit.items[k]}
					{#if item}
						<input type="hidden" name="keys" value={k} />
						{#each EDIT_LOCALES as l (l.code)}
							<label class="block text-sm" class:hidden={editLocale !== l.code}>
								<span class="flex items-center gap-2 font-medium text-stone-700">
									{item.label}
									{#if item.values[l.code]?.trim()}<span class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">変更あり</span>{/if}
								</span>
								{#if item.multiline}
									<textarea name={`value_${k}_${l.code}`} rows="4" maxlength="4000" disabled={!edit.canEdit}
										class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm leading-7 focus:border-brand-600 focus:outline-none">{item.values[l.code] || item.defaults[l.code]}</textarea>
								{:else}
									<input name={`value_${k}_${l.code}`} value={item.values[l.code] || item.defaults[l.code]} maxlength="4000" disabled={!edit.canEdit}
										class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none" />
								{/if}
							</label>
						{/each}
					{/if}
				{/each}
				<p class="text-xs leading-5 text-stone-500">今の文言が入っています。そのまま直して保存してください。空欄にして保存すると、元の文言に戻ります。お客様の画面に出るまで最大1分ほどかかります。</p>
				{#if saveError}<p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</p>{/if}
				<!-- 長い特典でも保存ボタンが見えるよう、窓の下に貼りつける -->
				<div class="sticky -bottom-6 -mx-1 flex items-center gap-3 border-t border-stone-200 bg-[#fffefa] px-1 py-3">
					{#if edit.canEdit}<button type="submit" class="min-h-11 rounded-full bg-brand-800 px-6 text-sm font-medium text-white hover:bg-brand-700">保存</button>{/if}
					{#if detail.keys.some((k) => savedKeys.includes(k))}<span class="text-sm text-emerald-700" role="status">保存しました</span>{/if}
				</div>
			</form>
		{:else}
			<p class="mt-4 text-sm leading-7 text-stone-700">{detail.body}</p>
			{#each detail.sections ?? [] as section (section.title)}
				<section class="mt-4 rounded-xl bg-stone-50 p-4">
					<h3 class="text-sm font-semibold text-brand-900">{section.title}</h3>
					<p class="mt-1 text-sm leading-7 text-stone-700">{section.body}</p>
				</section>
			{/each}
		{/if}
	{/if}
</dialog>

<style>
	.comparison-frame {
		contain: inline-size paint;
		box-shadow: 0 16px 38px -28px #514a38a6;
	}
	.grade-table {
		min-width: 39rem;
		border-collapse: separate;
		border-spacing: 0;
		color: #302d27;
	}
	.feature-col { width: 27%; }
	.tier-guest { --metal: #d3d0ca; --light: #f4f3f0; }
	.tier-standard { --metal: #ab9b86; --light: #faf8f4; }
	.tier-silver { --metal: #8294a6; --light: #f1f5f8; }
	.tier-gold { --metal: #ae8742; --light: #fcf6e7; }
	.tier-head {
		border-top: 3px solid var(--metal);
		padding: 1rem .25rem .75rem;
		background: linear-gradient(145deg, #fff 0%, var(--light) 53%, #fff 100%);
		font-weight: 650;
		vertical-align: bottom;
		overflow-wrap: anywhere;
	}
	.rank-mark {
		display: block;
		width: 1.05rem;
		height: 1.05rem;
		margin: 0 auto .65rem;
		clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
		background: conic-gradient(from 45deg, var(--metal), #fff, var(--metal), var(--light), var(--metal));
	}
	th, td { border-bottom: 1px solid #eae7e1; }
	tbody tr:last-child > * { border-bottom: 0; }
	td { padding: .54rem .36rem; text-align: center; }
	td:last-child { background: #fcf9ef; }
	.guest-value { background: #faf9f7; }
	.row-head {
		position: sticky;
		left: 0;
		z-index: 1;
		background: #fffdf9;
		box-shadow: 1px 0 #eae7e1;
		padding: .32rem .65rem;
		text-align: left;
	}
	.detail-link {
		display: flex;
		width: 100%;
		min-height: 2.3rem;
		align-items: center;
		border-radius: .35rem;
		cursor: pointer;
		text-align: left;
		font-weight: 550;
	}
	.detail-link:hover { color: #775b2f; text-decoration: underline; }
	.detail-link:focus-visible { outline: 2px solid #78603b; outline-offset: 2px; }
	.rate { font-size: 1.9rem; font-weight: 650; font-variant-numeric: tabular-nums; }
	.rate-unit { margin-inline-start: .07em; font-size: .55em; }
	.condition { color: #5b554c; font-size: .75rem; }
	.benefit-check {
		display: inline-grid;
		width: 1.3rem;
		height: 1.3rem;
		place-items: center;
		border-radius: 100%;
		background: #f2eee6;
		color: #6c542d;
		font-weight: 700;
	}
	.benefit-dash { color: #817c74; }
	.perk-dialog {
		position: fixed;
		width: min(32rem, calc(100% - 2rem));
		max-height: calc(100dvh - 2rem);
		margin: auto;
		padding: clamp(1rem, 4vw, 1.6rem);
		overflow-y: auto;
		border: 1px solid #e7dfcf;
		border-radius: 1rem;
		background: #fffefa;
		box-shadow: 0 20px 70px #211a1240;
	}
	.perk-dialog::backdrop { background: #211a1266; }

	.mobile-comparison { display: none; }
	.mobile-panel {
		border: 1px solid #eae7e1;
		border-radius: 1rem;
		background: white;
		color: #302d27;
	}
	.mobile-heading { font-size: 1rem; font-weight: 650; }
	.mobile-detail {
		display: flex;
		width: 100%;
		min-height: 2.75rem;
		align-items: center;
		justify-content: space-between;
		gap: .75rem;
		padding: .75rem 1rem;
		border-radius: .5rem;
		text-align: left;
		cursor: pointer;
		overflow-wrap: anywhere;
	}
	.mobile-detail:hover { background: #faf8f4; }
	.mobile-detail:focus-visible { outline: 2px solid #78603b; outline-offset: -3px; }
	.detail-chevron {
		width: .42rem;
		height: .42rem;
		flex-shrink: 0;
		border-block-start: 1px solid currentColor;
		border-inline-end: 1px solid currentColor;
		color: #78603b;
		transform: rotate(45deg);
	}
	.rate-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: .5rem;
		padding-inline: .75rem;
	}
	.rate-card {
		display: grid;
		align-content: start;
		gap: .18rem;
		padding: .65rem .7rem;
		border: 1px solid #eae7e1;
		border-radius: .65rem;
		background: var(--light);
		overflow-wrap: anywhere;
	}
	.guest-card {
		grid-column: 1 / -1;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
	}
	.rate-card:last-child { grid-column: 1 / -1; }
	.rate-card .rate { line-height: 1.1; }
	.rate-card .condition { font-size: .8125rem; }
	.guest-card .rate { font-size: 1.35rem; }
	.mobile-rank-name { font-size: .875rem; font-weight: 650; }
	.condition-detail { font-size: .875rem; color: #5b554c; }
	.perk-list > li { border-top: 1px solid #eae7e1; }
	.perk-detail {
		display: grid;
		grid-template-columns: minmax(0, 1fr) fit-content(37%) auto;
		gap: .55rem;
		font-size: .875rem;
		font-weight: 550;
	}
	.perk-audience {
		justify-self: end;
		padding: .2rem .5rem;
		border-radius: .5rem;
		background: var(--light);
		font-size: .75rem;
		text-align: center;
	}

	@media screen and (width < 48rem) {
		.mobile-comparison { display: block; }
		.comparison-frame:not(.printable) { display: none; }
	}

	@media print {
		.comparison-frame.printable { margin: 0; contain: none; overflow: visible; box-shadow: none; border-radius: 0; }
		.printable .grade-table { min-width: 0; font-size: 10.5pt; }
		.printable .tier-head { padding: 2mm 1mm; background: white; border-top-color: #535049; }
		.printable .rank-mark { display: none; }
		.printable .row-head { position: static; padding: 0.7mm 2mm; background: white; box-shadow: none; }
		.printable th, .printable td { border-color: #c3bfb6; }
		.printable td { padding: 0.65mm 1mm; background: white; }
		.printable tr { break-inside: avoid; }
		.printable .condition { font-size: 9.5pt; }
		.printable .detail-link { min-height: 0; text-decoration: none; }
		.printable .rate { font-size: 15pt; }
		.printable .benefit-check { color: #292620; background: none; }
		.perk-dialog { display: none !important; }
	}
</style>
