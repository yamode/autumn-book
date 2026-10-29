<script lang="ts">
	// 事前チェックインの状況一覧（P2）。送信はメールの手動ボタンと、携帯番号のときの「SMSで送る／再送」（P4）。
	import { enhance } from '$lib/enhance';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import { DEMO_PRECHECKIN_TOKEN } from '$lib/precheckin';
	import { channelBadgeClass, channelLabel } from '$lib/booking-channel';
	import { formatDateJa, addDays } from '$lib/format';
	import {
		PRECHECKIN_STATE_CLASS,
		PRECHECKIN_STATE_LABEL,
		canSend,
		expiresAtOf,
		isBefore,
		isMobileJp,
		maskEmail,
		maskPhone,
		precheckinState,
		shortJst
	} from '$lib/precheckin';
	import { SMS_STATUS_CLASS, SMS_STATUS_LABEL, smsTarget, type SmsStatusRow } from '$lib/precheckin-sms';

	let { data, form } = $props();

	const PRESETS = $derived([
		{ label: '本日', from: data.filters.today, to: data.filters.today },
		{ label: '明日', from: data.filters.tomorrow, to: data.filters.tomorrow },
		{ label: '本日〜7日後', from: data.filters.today, to: addDays(data.filters.today, 7) }
	]);
	const isPreset = (p: { from: string; to: string }) => p.from === data.filters.from && p.to === data.filters.to;
	const smsOf = $derived(new Map<string, SmsStatusRow>((data.sms ?? []).map((x) => [x.precheckin_id, x])));
	// 携帯番号があれば SMS で送れるので「連絡先なし」にしない
	const rows = $derived(
		data.list.map((r) => {
			const base = precheckinState(r);
			const mobile = Boolean(smsTarget(r.phone));
			return {
				...r,
				mobile,
				sms: r.precheckin_id ? (smsOf.get(r.precheckin_id) ?? null) : null,
				state: base === 'no_contact' && mobile ? ('unsent' as const) : base
			};
		})
	);
	const canSms = (r: { mobile: boolean; check_out_date: string }) => r.mobile && isBefore(expiresAtOf(r.check_out_date));
	const confirmSmsSend = (e: MouseEvent, lastHour: number) => {
		const msg =
			lastHour > 0
				? '直近 1 時間以内に SMS を送っています。新しいリンクでもう一度送りますか？（前のリンクは使えなくなります）'
				: 'SMS を送ります。前に送ったリンクがあれば使えなくなります。よろしいですか？';
		if (!confirm(msg)) e.preventDefault();
	};
	const counts = $derived(
		(['unsent', 'sent', 'opened', 'answered', 'failed', 'no_contact'] as const).map((s) => ({ s, n: rows.filter((r) => r.state === s).length }))
	);
	const capsOf = (type: 'dinner' | 'breakfast', time: string) =>
		data.caps?.caps.find((c) => c.type === type && c.time === time)?.max_rooms ?? '';
	const confirmResend = (e: MouseEvent, resend: boolean) => {
		if (resend && !confirm('新しいリンクでもう一度送ります。前に送ったメールのリンクは使えなくなります。よろしいですか？')) e.preventDefault();
	};
</script>

<PageHeader
	title="事前チェックイン"
	description="チェックイン日のご予約に、事前チェックイン（連絡先の確認・夕食と朝食の時間）のご案内をメール、または携帯番号へ SMS で送ります。取引先経由・取消済みは出ません。複数室のご予約は代表者へ 1 通です。"
/>

<p class="mb-3 text-sm">
	<a href="/ci/{DEMO_PRECHECKIN_TOKEN}" target="_blank" rel="noopener" class="text-stone-700 underline underline-offset-2">お客様フォームの見本を開く ↗</a>
	<span class="text-xs text-stone-500">（SMS・メールのリンク先と同じ画面。見本の予約で、入力しても実際の予約・PMS には反映されません）</span>
</p>

{#if !data.live}
	<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
		この環境では実際のご予約を出せません（管理画面が本番データに繋がっていません）。お客様側の画面は見本（/ci/demo-precheckin-…）で確かめられます。
	</div>
{:else}
	<form method="GET" class="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm">
		{#each PRESETS as p (p.label)}
			<a
				href="?from={p.from}&to={p.to}"
				class="rounded-full px-3 py-1.5 ring-1 {isPreset(p) ? 'bg-stone-900 text-white ring-stone-900' : 'bg-white text-stone-700 ring-stone-300'}"
			>{p.label}</a>
		{/each}
		<label class="ml-2">チェックイン日 <input type="date" name="from" value={data.filters.from} class="rounded border border-stone-300 px-2 py-1" /></label>
		<label>〜 <input type="date" name="to" value={data.filters.to} class="rounded border border-stone-300 px-2 py-1" /></label>
		<button class="rounded-lg bg-stone-800 px-3 py-1.5 text-white">表示</button>
	</form>

	{#if data.error}
		<p class="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{data.error}</p>
	{/if}
	{#if form && 'sendError' in form && form.sendError}
		<p class="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{form.sendError}</p>
	{:else if form && 'sentTo' in form && form.sentTo}
		<p class="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{maskEmail(form.sentTo)} へ送りました。</p>
	{:else if form && 'smsSentTo' in form && form.smsSentTo}
		<p class="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{form.smsSentTo} へ SMS を送りました。届いたかは「SMS 到達」の印で確かめられます。</p>
	{/if}
	{#if form && 'smsConfirmStay' in form && form.smsConfirmStay}
		<div class="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
			<span>直近 1 時間以内（{form.smsLastAt ? shortJst(form.smsLastAt) : '—'}）に SMS を送っています。同じ番号へ続けて送ると届かないことがあります。それでも送りますか？</span>
			<form method="POST" action="?/sms" use:enhance>
				<input type="hidden" name="stay_id" value={form.smsConfirmStay} />
				<input type="hidden" name="force" value="1" />
				<button class="rounded-lg bg-amber-700 px-3 py-1.5 text-xs text-white">それでも送る</button>
			</form>
		</div>
	{/if}
	{#if !data.smsReady}
		<p class="mb-4 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
			SMS未設定: NTT CPaaS の接続情報（NTT_CPAAS_BASE_URL / NTT_CPAAS_API_KEY / NTT_CPAAS_SENDER）が登録されていないため、SMS は送れません。メールは送れます。
		</p>
	{/if}

	<div class="mb-3 flex flex-wrap gap-2 text-xs">
		{#each counts as c (c.s)}
			<span class="rounded-full px-2.5 py-1 ring-1 {PRECHECKIN_STATE_CLASS[c.s]}">{PRECHECKIN_STATE_LABEL[c.s]} {c.n}</span>
		{/each}
	</div>

	<ul class="space-y-2">
		{#each rows as r (r.stay_id)}
			<li class="rounded-xl border border-stone-200 bg-white p-3.5 text-sm shadow-sm">
				<div class="flex flex-wrap items-start justify-between gap-2">
					<div class="min-w-0">
						<a href="/admin/precheckin/{r.stay_id}" class="font-medium text-stone-900 underline-offset-2 hover:underline">{r.guest_name || '（名前なし）'}</a>
						<span class="ml-1 text-xs text-stone-500">{r.guest_kana ?? ''}</span>
						<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
							<span>{formatDateJa(r.check_in_date)}〜{formatDateJa(r.check_out_date)}（{r.nights}泊）</span>
							<span>{r.room_count}室・大人{r.adults}名</span>
							<span class="rounded px-1.5 py-0.5 {channelBadgeClass(r)}">{channelLabel(r)}</span>
							<span class="text-stone-400">{r.booking_code ?? ''}</span>
						</div>
						<div class="mt-1 flex flex-wrap gap-x-3 text-xs text-stone-500">
							<span>メール: {r.email ? maskEmail(r.email) : 'なし'}</span>
							<span>電話: {r.phone ? maskPhone(r.phone) : 'なし'}{#if isMobileJp(r.phone)}<span class="ml-1 rounded bg-stone-100 px-1">携帯</span>{/if}</span>
						</div>
					</div>
					<div class="flex shrink-0 flex-col items-end gap-1.5">
						<span class="rounded-full px-2.5 py-0.5 text-xs ring-1 {PRECHECKIN_STATE_CLASS[r.state]}">{PRECHECKIN_STATE_LABEL[r.state]}</span>
						{#if r.sms?.sms_status}
							<span class="rounded-full px-2.5 py-0.5 text-xs ring-1 {SMS_STATUS_CLASS[r.sms.sms_status]}">{SMS_STATUS_LABEL[r.sms.sms_status]}</span>
						{/if}
						{#if r.sms && r.sms.inbound_count > 0}
							<a href="/admin/precheckin/{r.stay_id}" class="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs text-violet-800 ring-1 ring-violet-200">返信あり {r.sms.inbound_count}</a>
						{/if}
						<div class="flex flex-wrap justify-end gap-1.5">
							{#if canSms(r)}
								<form method="POST" action="?/sms" use:enhance>
									<input type="hidden" name="stay_id" value={r.stay_id} />
									<button
										class="rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50 {r.sms?.sms_count ? 'bg-white text-stone-700 ring-1 ring-stone-300' : 'bg-sky-800 text-white'}"
										disabled={!data.smsReady}
										title={data.smsReady ? '' : 'SMS未設定のため送れません'}
										onclick={(e) => confirmSmsSend(e, r.sms?.sms_last_hour ?? 0)}
									>{r.sms?.sms_count ? 'SMSで再送' : 'SMSで送る'}</button>
								</form>
							{/if}
							{#if canSend(r)}
								<form method="POST" action="?/send" use:enhance>
									<input type="hidden" name="stay_id" value={r.stay_id} />
									<button
										class="rounded-lg px-3 py-1.5 text-xs {r.sent_at || r.precheckin_id ? 'bg-white text-stone-700 ring-1 ring-stone-300' : 'bg-stone-900 text-white'}"
										onclick={(e) => confirmResend(e, Boolean(r.sent_at || r.precheckin_id))}
									>{r.sent_at || r.precheckin_id ? 'メールで再送' : 'メールで送る'}</button>
								</form>
							{/if}
						</div>
					</div>
				</div>
				{#if r.sent_at || r.first_opened_at || r.answered_at || r.send_error || r.sms?.sms_error}
					<div class="mt-2 flex flex-wrap gap-x-3 border-t border-stone-100 pt-2 text-xs text-stone-500">
						{#if r.sent_at}<span>送信 {shortJst(r.sent_at)}（{r.send_count}回）</span>{/if}
						{#if r.first_opened_at}<span>開封 {shortJst(r.first_opened_at)}</span>{/if}
						{#if r.answered_at}<span class="text-emerald-700">回答 {shortJst(r.answered_at)}</span>{/if}
						{#if r.status === 'failed' && r.send_error}<span class="text-red-700">失敗: {r.send_error}</span>{/if}
						{#if r.sms && (r.sms.sms_status === 'failed' || r.sms.sms_status === 'undeliverable') && r.sms.sms_error}<span class="text-red-700">SMS: {r.sms.sms_error}</span>{/if}
					</div>
				{/if}
			</li>
		{:else}
			<li class="rounded-xl border border-dashed border-stone-300 bg-white px-3 py-8 text-center text-sm text-stone-500">この日にチェックインのご予約はありません。</li>
		{/each}
	</ul>

	{#if data.caps}
		<section class="mt-8 rounded-xl border border-stone-200 bg-white p-4 text-sm">
			<h2 class="font-semibold">食事の時間枠ごとの受付上限（室数）</h2>
			<p class="mt-1 text-xs text-stone-500">
				事前チェックインで選べる室数の上限です。PMS ですでにその時間に入っているご予約も数えます。空欄は上限なし。時間の一覧は PMS の「食事時間」マスタです。
			</p>
			{#if form && 'capsError' in form && form.capsError}
				<p class="mt-2 text-sm text-red-700" role="alert">{form.capsError}</p>
			{/if}
			<form method="POST" action="?/caps" use:enhance class="mt-3 space-y-3">
				{#each [['dinner', '夕食'], ['breakfast', '朝食']] as const as [type, label] (type)}
					<div class="flex flex-wrap items-center gap-3">
						<span class="w-10 font-medium">{label}</span>
						{#each data.caps.times[type] as time (time)}
							<label class="flex items-center gap-1">
								<span class="text-stone-600">{time}</span>
								<input
									name="cap|{type}|{time}"
									type="number"
									min="0"
									max="999"
									inputmode="numeric"
									value={capsOf(type, time)}
									class="w-16 rounded border border-stone-300 px-2 py-1"
								/>
							</label>
						{:else}
							<span class="text-xs text-stone-400">マスタに時間がありません</span>
						{/each}
					</div>
				{/each}
				<button class="rounded-lg bg-stone-800 px-3 py-1.5 text-white">上限を保存</button>
			</form>
		</section>
	{/if}
{/if}
