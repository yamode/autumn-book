<script lang="ts">
	// 事前チェックインの回答の詳細（P2）。修正差分・到着予定・ご要望・部屋ごとの食事の時間。
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import { formatDateJa } from '$lib/format';
	import { contactDiff, precheckinState, PRECHECKIN_STATE_CLASS, PRECHECKIN_STATE_LABEL, shortJst } from '$lib/precheckin';
	import { SMS_STATUS_CLASS, SMS_STATUS_LABEL } from '$lib/precheckin-sms';

	let { data } = $props();
	const d = $derived(data.detail);
	const p = $derived(d?.precheckin ?? null);
	const a = $derived(p?.answers ?? {});
	const diff = $derived(d ? contactDiff(d.summary.guest, a.contact) : []);
	const state = $derived(
		d
			? precheckinState({
					email: d.summary.guest.email || null,
					precheckin_id: p?.id ?? null,
					status: p?.status ?? null,
					sent_at: p?.sent_at ?? null,
					first_opened_at: p?.first_opened_at ?? null,
					answered_at: p?.answered_at ?? null
				})
			: 'unsent'
	);
	const chosen = (stayId: string, type: string, date: string) =>
		a.meals?.find((x) => x.stay_id === stayId && x.type === type && x.date === date)?.time ?? null;
</script>

<a href="/admin/precheckin" class="mb-3 inline-block text-sm text-stone-500 hover:underline">← 事前チェックインの一覧</a>

{#if data.error || !d}
	<p class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{data.error ?? '見つかりません'}</p>
{:else}
	<PageHeader title="{d.summary.guest.name || '（名前なし）'} 様" description="予約番号 {d.summary.booking_code}・{formatDateJa(String(d.summary.check_in))}〜{formatDateJa(String(d.summary.check_out))}（{d.summary.nights}泊・{d.summary.room_count}室）" />

	<div class="grid gap-4 md:grid-cols-2">
		<section class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
			<div class="flex items-center justify-between">
				<h2 class="font-semibold">状態</h2>
				<span class="rounded-full px-2.5 py-0.5 text-xs ring-1 {PRECHECKIN_STATE_CLASS[state]}">{PRECHECKIN_STATE_LABEL[state]}</span>
			</div>
			<dl class="mt-3 grid grid-cols-[7rem_1fr] gap-y-1 text-stone-700">
				<dt class="text-stone-500">送信先</dt><dd>{p?.sent_to ?? '—'}</dd>
				<dt class="text-stone-500">送信</dt><dd>{p?.sent_at ? `${shortJst(p.sent_at)}（${p.send_count}回）` : '—'}</dd>
				<dt class="text-stone-500">開封</dt><dd>{p?.first_opened_at ? shortJst(p.first_opened_at) : '—'}{p?.last_opened_at && p.last_opened_at !== p.first_opened_at ? `（最後 ${shortJst(p.last_opened_at)}）` : ''}</dd>
				<dt class="text-stone-500">回答</dt><dd>{p?.answered_at ? shortJst(p.answered_at) : '—'}</dd>
				<dt class="text-stone-500">リンクの期限</dt><dd>{p?.expires_at ? shortJst(p.expires_at) : '—'}</dd>
				{#if p?.status === 'failed'}<dt class="text-red-600">送信失敗</dt><dd class="text-red-700">{p.send_error}</dd>{/if}
			</dl>
		</section>

		<section class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
			<h2 class="font-semibold">連絡先の修正</h2>
			<p class="mt-1 text-xs text-stone-500">お客様の申告です。PMS の顧客情報はまだ変わっていません。確認のうえ PMS で直してください。</p>
			{#if diff.length}
				<table class="mt-3 w-full text-left">
					<thead class="text-xs text-stone-500"><tr><th class="py-1">項目</th><th>予約の内容</th><th>お客様の修正</th></tr></thead>
					<tbody>
						{#each diff as row (row.key)}
							<tr class="border-t border-stone-100"><td class="py-1.5">{row.label}</td><td class="text-stone-500">{row.from || '—'}</td><td class="font-medium text-amber-800">{row.to}</td></tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<p class="mt-3 text-stone-500">修正はありません。</p>
			{/if}
			<dl class="mt-3 grid grid-cols-[7rem_1fr] gap-y-1 border-t border-stone-100 pt-3 text-stone-500">
				<dt>予約の電話</dt><dd class="text-stone-700">{d.summary.guest.phone || '—'}</dd>
				<dt>予約のメール</dt><dd class="text-stone-700">{d.summary.guest.email || '—'}</dd>
			</dl>
		</section>

		<section class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
			<h2 class="font-semibold">到着・ご要望</h2>
			<dl class="mt-3 grid grid-cols-[7rem_1fr] gap-y-1.5">
				<dt class="text-stone-500">到着予定</dt><dd>{a.arrival_time ?? '—'}</dd>
				<dt class="text-stone-500">同伴人数</dt><dd>{a.companions ?? '—'}</dd>
				<dt class="text-stone-500">アレルギー</dt><dd class="whitespace-pre-wrap">{a.allergies ?? '—'}</dd>
				<dt class="text-stone-500">ご要望</dt><dd class="whitespace-pre-wrap">{a.requests ?? '—'}</dd>
				<dt class="text-stone-500">言語</dt><dd>{a.locale ?? d.summary.locale}</dd>
			</dl>
		</section>

		<section class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
			<h2 class="font-semibold">食事の時間</h2>
			<p class="mt-1 text-xs text-stone-500">お客様が選んだ時間はそのまま PMS の食事（伺い書）に入っています（承認なし）。「今の時間」は PMS の値です。</p>
			{#each data.rooms as room (room.stayId)}
				<h3 class="mt-3 text-xs font-semibold text-stone-500">{room.index}室目 {room.label}</h3>
				<table class="mt-1 w-full text-left">
					<thead class="text-xs text-stone-400"><tr><th class="py-1">日付</th><th>食事</th><th>今の時間</th><th>お客様の選択</th></tr></thead>
					<tbody>
						{#each room.nights as n (n.nightDate + n.stayId)}
							{#each [['dinner', '夕食'], ['breakfast', '朝食']] as const as [t, label] (t)}
								<tr class="border-t border-stone-100">
									<td class="py-1">{formatDateJa(n[t].date)}</td>
									<td>{label}</td>
									<td>{n[t].offered ? (n[t].time ?? '未定') : 'なし'}</td>
									<td class="text-stone-600">{chosen(n.stayId, t, n[t].date) ?? '—'}</td>
								</tr>
							{/each}
						{/each}
					</tbody>
				</table>
			{/each}
		</section>

		<section class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
			<h2 class="font-semibold">お客様からの返信（SMS）</h2>
			<p class="mt-1 text-xs text-stone-500">送った SMS への返信です。送信元の番号には電話がつながらないため、必要ならお客様へ折り返してください。</p>
			{#if data.sms.inbound.length}
				<ul class="mt-3 space-y-2">
					{#each data.sms.inbound as m (m.id)}
						<li class="rounded-lg bg-violet-50 px-3 py-2">
							<div class="text-xs text-stone-500">{m.received_at ? shortJst(m.received_at) : shortJst(m.created_at)}・{m.from_masked}</div>
							<p class="mt-1 whitespace-pre-wrap break-words text-stone-800">{m.message}</p>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-3 text-stone-500">返信はありません。</p>
			{/if}
		</section>

		<section class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
			<h2 class="font-semibold">送信の履歴（SMS・自動送信）</h2>
			{#if data.sms.dispatches.length}
				<table class="mt-3 w-full text-left">
					<thead class="text-xs text-stone-400"><tr><th class="py-1">日時</th><th>手段</th><th>宛先</th><th>状態</th></tr></thead>
					<tbody>
						{#each data.sms.dispatches as x (x.id)}
							<tr class="border-t border-stone-100 align-top">
								<td class="py-1.5 text-xs">{shortJst(x.sent_at ?? x.created_at)}{x.mode === 'auto' ? '（自動）' : ''}</td>
								<td>{x.channel === 'sms' ? 'SMS' : 'メール'}</td>
								<td class="text-xs text-stone-600">{x.to_masked ?? '—'}</td>
								<td>
									{#if x.status}<span class="rounded-full px-2 py-0.5 text-xs ring-1 {SMS_STATUS_CLASS[x.status]}">{x.channel === 'sms' ? SMS_STATUS_LABEL[x.status] : x.status}</span>{/if}
									{#if x.last_error && x.status !== 'delivered' && x.status !== 'sent'}<div class="mt-0.5 text-xs text-red-700">{x.last_error}</div>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<p class="mt-3 text-stone-500">SMS・自動送信の記録はありません（メールの手動送信は上の「状態」に出ます）。</p>
			{/if}
		</section>
	</div>
{/if}
