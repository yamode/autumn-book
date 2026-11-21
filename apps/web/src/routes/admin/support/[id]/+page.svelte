<script lang="ts">
	// 会員サポートの詳細: やりとり（お客様 / 宿の返信 / メモ を色分け・引用は折りたたみ）・返信・メモ・状態・会員番号
	import { enhance } from '$lib/enhance';
	import type { SubmitFunction } from '@sveltejs/kit';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import { canResendReply, SUPPORT_EMAIL, SUPPORT_STATUSES, SUPPORT_STATUS_LABELS, splitQuoted, supportCategoryLabel, supportReplySubject } from '$lib/support';

	let { data, form } = $props();

	const t = $derived(data.ticket);
	const failure = $derived(form && 'message' in form && form.message ? String(form.message) : null);
	const DONE_LABEL = { reply: '返信を送りました。', resend: '返信を送り直しました。', note: 'メモを残しました。', status: '状態を変えました。' } as const;
	const warning = $derived(form && 'warning' in form && form.warning ? String(form.warning) : null);
	const done = $derived(!warning && form && 'done' in form && form.done ? DONE_LABEL[form.done as keyof typeof DONE_LABEL] : null);
	// 返信欄は画面で持つ（メモ・状態の送信で消えないように）。送れたら空にし、返信の送信が失敗したときだけサーバの値で上書きする
	let reply = $state('');
	// 送信中（結果の記録が無い）の返信を送り直すときの、画面内の確認（どの返信か）
	let confirmResendId = $state<string | null>(null);
	const noteBody = $derived(form && 'noteBody' in form ? String(form.noteBody ?? '') : '');

	const fmt = (s: string) =>
		new Date(s).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

	const BOX: Record<string, string> = {
		in: 'border-stone-200 bg-white',
		out: 'border-sky-200 bg-sky-50',
		note: 'border-amber-200 bg-amber-50'
	};
	const SEND_LABEL: Record<string, string> = { sending: '送信中（未確認）', sent: '送信済み', failed: '送信できませんでした' };

	const fromLabel = $derived(data.mailEnabled ? SUPPORT_EMAIL : '既定の差出人（返信できないメール）');
	const submitReply: SubmitFunction = ({ cancel }) => {
		if (!confirm(`${t?.email ?? 'お客様'} に返信を送ります。よろしいですか？`)) {
			cancel();
			return;
		}
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') reply = '';
			else if (result.type === 'failure' && typeof result.data?.replyBody === 'string') reply = result.data.replyBody;
		};
	};
	const afterResend: SubmitFunction = () => async ({ update }) => {
		confirmResendId = null;
		await update();
	};
</script>

<svelte:head><title>{t ? `${t.code} ` : ''}会員サポート ｜ 山人管理</title></svelte:head>

<p class="mb-2 text-sm"><a href="/admin/support" class="text-accent-600 hover:underline">← 会員サポートの一覧</a></p>

{#if !data.live}
	<PageHeader title="会員サポート" />
	<div class="mb-4 rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-500">
		この環境では使えません（DATA_SOURCE / AUTH_MODE が supabase ではありません）。
	</div>
{:else if data.error || !t}
	<PageHeader title="会員サポート" />
	<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{data.error ?? '読み込めませんでした。'}</div>
{:else}
	<PageHeader title={t.subject || '（件名なし）'} description={`${t.code} ・ ${supportCategoryLabel(t.category)} ・ ${t.source === 'form' ? 'ヘルプページのフォーム' : 'メール'}から ・ 受付 ${fmt(t.created_at)}`} />

	{#if failure}
		<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{failure}</div>
	{/if}
	{#if warning}
		<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{warning}</div>
	{/if}
	{#if done}
		<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{done}</div>
	{/if}

	<div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
		<div class="min-w-0 space-y-3">
			{#each data.messages as msg (msg.id)}
				{@const parts = splitQuoted(msg.body)}
				<article class="rounded-xl border p-4 text-sm {BOX[msg.direction] ?? BOX.in}">
					<header class="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
						<span class="font-medium text-stone-700">
							{msg.direction === 'in' ? `お客様（${msg.from_email ?? t.email}）` : msg.direction === 'out' ? `宿の返信${msg.author ? `・${msg.author}` : ''}` : `メモ（お客様には送りません）${msg.author ? `・${msg.author}` : ''}`}
						</span>
						<time class="ml-auto">{fmt(msg.created_at)}</time>
					</header>
					<p class="leading-6 whitespace-pre-wrap break-words text-stone-800">{parts.main}</p>
					{#if parts.quoted}
						<details class="mt-2">
							<summary class="cursor-pointer text-xs text-stone-400">引用を表示</summary>
							<p class="mt-1 border-l-2 border-stone-200 pl-3 text-xs leading-5 whitespace-pre-wrap break-words text-stone-500">{parts.quoted}</p>
						</details>
					{/if}
					{#if msg.direction === 'out' && msg.send_status}
						<div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
							<span class={msg.send_status === 'sent' ? 'text-emerald-700' : msg.send_status === 'failed' ? 'text-red-700' : 'text-amber-700'}>{SEND_LABEL[msg.send_status] ?? msg.send_status}</span>
							{#if msg.send_status === 'failed' && msg.send_error}<span class="text-stone-500">{msg.send_error}</span>{/if}
							{#if msg.send_status === 'failed'}
								<form method="POST" action="?/resend" use:enhance={afterResend}>
									<input type="hidden" name="messageId" value={msg.id} />
									<button class="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-stone-700 hover:border-stone-500">再送</button>
								</form>
							{:else if msg.send_status === 'sending' && canResendReply(msg)}
								<!-- 送信中のまま結果が残っていない返信（作成から 5 分たったものだけ）。届いている可能性があるので、画面内で確かめてから送る -->
								{#if confirmResendId === msg.id}
									<form method="POST" action="?/resend" use:enhance={afterResend} class="flex w-full flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
										<input type="hidden" name="messageId" value={msg.id} />
										<input type="hidden" name="confirmSending" value="1" />
										<span class="min-w-0 flex-1 text-amber-900">この返信はお客様に届いている可能性があります（送信の結果が記録されていません）。送り直すと二重に届くことがあります。</span>
										<button class="rounded-md bg-amber-600 px-2.5 py-1 text-white hover:bg-amber-500">それでも送り直す</button>
										<button type="button" onclick={() => (confirmResendId = null)} class="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-stone-700">やめる</button>
									</form>
								{:else}
									<button type="button" onclick={() => (confirmResendId = msg.id)} class="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-stone-700 hover:border-stone-500">再送</button>
								{/if}
							{/if}
						</div>
					{/if}
				</article>
			{:else}
				<p class="rounded-xl border border-stone-200 bg-white px-4 py-8 text-center text-sm text-stone-400">やりとりはありません</p>
			{/each}

			<form method="POST" action="?/reply" use:enhance={submitReply} class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
				<h2 class="mb-1 font-medium text-stone-800">返信する</h2>
				<p class="mb-2 text-xs text-stone-500">
					{fromLabel} から {t.email} へ送ります。件名「{supportReplySubject(t.subject, t.code)}」。宛名（{t.name || 'お客様'} 様）と、問い合わせ先の署名は自動で付きます。{#if !data.mailEnabled}本文の末尾に「このメールには返信できません。ご返信はヘルプページのフォームから」の案内が付きます。{/if}
				</p>
				<textarea name="body" rows="8" maxlength="10000" required bind:value={reply} class="w-full rounded-md border border-stone-300 px-3 py-2"></textarea>
				<div class="mt-2 flex justify-end">
					<button class="rounded-md bg-brand-800 px-4 py-2 text-white hover:bg-brand-700">返信を送る</button>
				</div>
			</form>

			<form method="POST" action="?/note" use:enhance data-reset class="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-sm">
				<h2 class="mb-1 font-medium text-stone-800">メモを残す</h2>
				<p class="mb-2 text-xs text-stone-500">宿の中だけの記録です。お客様には送りません。</p>
				<textarea name="body" rows="3" maxlength="10000" required value={noteBody} class="w-full rounded-md border border-stone-300 bg-white px-3 py-2"></textarea>
				<div class="mt-2 flex justify-end">
					<button class="rounded-md border border-stone-300 bg-white px-4 py-2 text-stone-700 hover:border-stone-500">メモを残す</button>
				</div>
			</form>
		</div>

		<aside class="space-y-3">
			<section class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
				<h2 class="mb-2 text-xs font-medium text-stone-500">お客様</h2>
				<p class="font-medium text-stone-900">{t.name || '（お名前なし）'}</p>
				<p class="mt-0.5 break-all text-xs text-stone-600">{t.email}</p>
				{#if t.member_user_id}
					<p class="mt-2 text-xs text-stone-600">
						会員番号
						<a href="/admin/members/{t.member_user_id}" class="font-mono text-accent-600 hover:underline">{t.member_code ?? '（退会済み）'}</a>
					</p>
				{:else}
					<p class="mt-2 text-xs text-stone-400">会員としての問い合わせではありません</p>
				{/if}
			</section>
			<section class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
				<h2 class="mb-2 text-xs font-medium text-stone-500">状態</h2>
				<p class="mb-2">
					<span class="font-medium text-stone-900">{SUPPORT_STATUS_LABELS[t.status] ?? t.status}</span>
					{#if t.needs_reply && t.status !== 'closed'}<span class="ml-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] text-white">未返信</span>{/if}
				</p>
				<div class="flex flex-wrap gap-1.5">
					{#each SUPPORT_STATUSES as s (s)}
						{#if s !== t.status}
							<form method="POST" action="?/status" use:enhance>
								<input type="hidden" name="status" value={s} />
								<button class="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-700 hover:border-stone-500">{SUPPORT_STATUS_LABELS[s]}にする</button>
							</form>
						{/if}
					{/each}
				</div>
				<p class="mt-2 text-xs leading-5 text-stone-400">返信すると「返事待ち」になり、お客様から返事が届くと「対応中」に戻ります。</p>
			</section>
		</aside>
	</div>
{/if}
