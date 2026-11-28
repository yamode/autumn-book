<script lang="ts">
	// 旧会員（tripla）の会員移行の確認。確認待ちを PMS の顧客に紐づける・紐づけない・紐づけを解除する。
	import { enhance } from '$lib/enhance';
	import type { SubmitFunction } from '@sveltejs/kit';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';

	let { data, form } = $props();

	const MATCH_LABEL: Record<string, string> = {
		auto: 'メール・氏名が一致',
		candidate: '候補あり',
		none: '該当なし'
	};
	const MATCH_CLASS: Record<string, string> = {
		auto: 'bg-amber-50 text-amber-800 border-amber-200',
		candidate: 'bg-sky-50 text-sky-800 border-sky-200',
		none: 'bg-stone-100 text-stone-600 border-stone-200'
	};

	// 失敗の文言（legacyId があればそのカードの中に出す）
	const failure = $derived(
		form && 'message' in form && form.message ? { message: String(form.message), legacyId: 'legacyId' in form ? (form.legacyId as string | undefined) : undefined } : null
	);
	const pending = $derived(data.items.filter((i) => i.claim === 'pending_review'));
	const linked = $derived(data.items.filter((i) => i.claim === 'linked'));

	// 電話・氏名の比べ方（数字だけ／空白を除く）。食い違いは赤で示す
	const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');
	const compact = (s: string | null) => (s ?? '').replace(/[\s　]/g, '');
	const differs = (a: string | null, b: string | null, norm: (s: string | null) => string) => !!norm(a) && !!norm(b) && norm(a) !== norm(b);

	const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('ja-JP') : '—');
	const DONE_LABEL = { link: '紐づけました。', unlink: '紐づけを解除して元に戻しました。', reject: '紐づけない（却下）にしました。' } as const;

	// 紐づけは会員のマイページの表示が変わるので、送る前に確かめる
	const confirmLink =
		(name: string | null): SubmitFunction =>
		({ cancel }) => {
			if (!confirm(`「${name ?? '（氏名なし）'}」に紐づけます。PMS で氏名・電話・住所を照らし合わせ、食い違いがあるときはご本人に電話で確かめましたか？`)) cancel();
		};
</script>

<svelte:head><title>旧会員の確認 ｜ 山人管理</title></svelte:head>

<PageHeader title="旧会員の確認" description="旧会員（tripla）から移行した会員の紐づけを確認します。自動で紐づけたものも、ここで解除できます。" />

<p class="mb-3 text-sm">
	<a href="/admin/members/legacy/pre" class="text-accent-600 hover:underline">手続き前の旧会員（候補あり）を先に確かめる →</a>
</p>

<section class="mb-5 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
	<p>
		紐づけると、選んだ PMS の顧客のプロフィールと予約が、その会員のマイページに表示されます。別人に紐づけると他のお客様の情報が見えてしまうため、
		<strong>紐づける前に必ず PMS で氏名・電話番号・住所を照らし合わせてください。</strong>
		「手続きで入力」が以前の登録や候補と食い違う（赤字）ときは、<strong>PMS に残っている電話番号へ宿から電話して、ご本人か確かめてから</strong>紐づけてください（メールの返信では確かめません）。
		確信が持てないときは紐づけず、「紐づけない（却下）」にしてください。
	</p>
</section>

{#if !data.live}
	<div class="mb-4 rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-500">
		この環境では使えません（DATA_SOURCE / AUTH_MODE が supabase ではありません）。
	</div>
{/if}
{#if data.error}
	<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{data.error}</div>
{/if}
{#if failure && !failure.legacyId}
	<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{failure.message}</div>
{/if}
{#if form && 'done' in form && form.done}
	<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{DONE_LABEL[form.done]}</div>
{/if}

{#snippet person(item: (typeof data.items)[number])}
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div class="min-w-0">
			<p class="font-medium text-stone-900">
				{item.name ?? '（氏名なし）'}
				{#if item.kana}<span class="ml-1 text-xs font-normal text-stone-500">{item.kana}</span>{/if}
			</p>
			<p class="mt-0.5 text-xs text-stone-500">{item.email ?? '—'}</p>
			{#if item.claim === 'pending_review'}
				<p class="mt-0.5 text-xs text-stone-500">以前の登録：{item.phone ?? '電話なし'}</p>
			{/if}
			<p class="mt-0.5 text-xs text-stone-600">
				手続きで入力：
				<span class={differs(item.entered_name, item.name, compact) ? 'font-medium text-red-700' : ''}>{item.entered_name ?? '—'}</span>
				{#if item.entered_kana}<span class="text-stone-400">（{item.entered_kana}）</span>{/if}
				・<span class={item.claim === 'pending_review' && differs(item.entered_phone, item.phone, digits) ? 'font-medium text-red-700' : ''}>{item.entered_phone ?? '電話なし'}</span>
			</p>
			<p class="mt-0.5 text-xs text-stone-400">
				会員番号
				{#if item.member_user_id}
					<a href="/admin/members/{item.member_user_id}" class="font-mono text-accent-600 hover:underline">{item.member_code ?? '—'}</a>
				{:else}
					<span class="font-mono">{item.member_code ?? '—'}</span>
				{/if}
				・移行日 {fmtDate(item.migrated_at)}
			</p>
		</div>
		<span class="shrink-0 rounded-full border px-2.5 py-0.5 text-xs {MATCH_CLASS[item.match] ?? MATCH_CLASS.none}">{MATCH_LABEL[item.match] ?? item.match}</span>
	</div>
	{#if failure && failure.legacyId === item.id}
		<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{failure.message}</p>
	{/if}
{/snippet}

<h2 class="mb-2 text-sm font-medium text-stone-700">確認待ち（{pending.length} 件）</h2>
<div class="mb-8 space-y-4">
	{#each pending as item (item.id)}
		<article class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
			{@render person(item)}

			{#if item.member_guest_stays > 0}
				<p class="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600">
					確認待ちの間の宿泊・予約が {item.member_guest_stays} 件あります。紐づけると、この予約ごと選んだ顧客に統合します（統合したあとは「解除して元に戻す」はできません）。
				</p>
			{/if}

			<h3 class="mb-1 mt-4 text-xs font-medium text-stone-500">PMS の顧客の候補</h3>
			{#if item.candidates.length === 0}
				<p class="text-xs text-stone-400">候補はありません。</p>
			{:else}
				<div class="overflow-x-auto rounded-lg border border-stone-200">
					<table class="w-full min-w-[760px] text-xs">
						<thead>
							<tr class="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
								<th class="px-2 py-1.5">氏名</th>
								<th class="px-2">フリガナ</th>
								<th class="px-2">電話</th>
								<th class="px-2">メール</th>
								<th class="px-2 text-right">公式・直販の利用回数</th>
								<th class="px-2">会員</th>
								<th class="px-2">紐づけ</th>
							</tr>
						</thead>
						<tbody>
							{#each item.candidates as c (c.guest_id)}
								<tr class="border-b border-stone-100 align-top last:border-0">
									<td class="px-2 py-2 font-medium text-stone-800">{c.name ?? '—'}</td>
									<td class="px-2 py-2">{c.kana ?? '—'}</td>
									<td class="px-2 py-2 {differs(c.phone, item.entered_phone, digits) ? 'font-medium text-red-700' : ''}">{c.phone ?? '—'}</td>
									<td class="px-2 py-2 break-all">{c.email ?? '—'}</td>
									<td class="px-2 py-2 text-right">{c.direct_visits.toLocaleString()} 回</td>
									<td class="px-2 py-2">{c.has_member ? '別の会員あり' : '—'}</td>
									<td class="px-2 py-2">
										{#if c.has_member}
											<span class="text-stone-400">紐づけられません（別の会員が紐づいています）</span>
										{:else}
											<form method="POST" action="?/link" use:enhance={confirmLink(c.name)} class="flex flex-col gap-1.5">
												<input type="hidden" name="legacyId" value={item.id} />
												<input type="hidden" name="guestId" value={c.guest_id} />
												<input name="note" placeholder="メモ（任意）" maxlength="500" class="w-48 rounded-md border border-stone-300 px-2 py-1" />
												<button class="w-fit rounded-md bg-brand-800 px-3 py-1.5 text-white hover:bg-brand-700">この顧客に紐づける</button>
											</form>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			<form method="POST" action="?/reject" use:enhance class="mt-4 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3">
				<input type="hidden" name="legacyId" value={item.id} />
				<label class="block min-w-0 flex-1">
					<span class="text-xs text-stone-500">紐づけない理由（必須）</span>
					<input name="note" required maxlength="500" placeholder="例: 候補はいずれも別人（電話・住所が一致しない）" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5" />
				</label>
				<button class="min-h-9 rounded-md border border-stone-300 bg-white px-4 text-sm text-stone-700 hover:border-stone-500">紐づけない（却下）</button>
			</form>
		</article>
	{:else}
		<p class="rounded-xl border border-stone-200 bg-white px-4 py-8 text-center text-sm text-stone-400">確認待ちはありません</p>
	{/each}
</div>

<h2 class="mb-2 text-sm font-medium text-stone-700">紐づけ済み（{linked.length} 件）</h2>
<div class="space-y-4">
	{#each linked as item (item.id)}
		<article class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
			{@render person(item)}
			<p class="mt-3 text-xs text-emerald-700">
				{item.reviewed_at ? `紐づけ済み（スタッフが紐づけました。手続き前に決めたものを含む・${fmtDate(item.reviewed_at)}）` : '紐づけ済み（メール・氏名が一致したため自動で紐づけました。手続きで入れた電話は連絡先に追加）'}
			</p>
			<!-- 候補が複数ある旧会員（手続き前に職員が決めたもの等）は、実際の紐づけ先だけを出す -->
			{#each item.candidates.filter((c) => !item.member_guest_id || c.guest_id === item.member_guest_id) as c (c.guest_id)}
				<p class="mt-1 text-xs text-stone-500">紐づけ先：{c.name ?? '—'}・{c.phone ?? '—'}・公式・直販 {c.direct_visits.toLocaleString()} 回</p>
			{/each}
			{#if !(item.can_unlink ?? !!item.previous_guest_id)}
				<p class="mt-2 text-xs text-stone-400">予約ごと顧客を統合して紐づけたため（または元の顧客の記録が無いため）、ここでは解除できません。</p>
			{:else}
			<form method="POST" action="?/unlink" use:enhance class="mt-3 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3">
				<input type="hidden" name="legacyId" value={item.id} />
				<label class="block min-w-0 flex-1">
					<span class="text-xs text-stone-500">解除する理由（必須）</span>
					<input name="note" required maxlength="500" placeholder="例: 別人に紐づけていた" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5" />
				</label>
				<button class="min-h-9 rounded-md border border-red-300 bg-white px-4 text-sm text-red-700 hover:border-red-500">解除して元に戻す</button>
			</form>
			{/if}
		</article>
	{:else}
		<p class="rounded-xl border border-stone-200 bg-white px-4 py-8 text-center text-sm text-stone-400">紐づけ済みはありません</p>
	{/each}
</div>
