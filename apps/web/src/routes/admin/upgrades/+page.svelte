<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { UPGRADE_CHANNEL, UPGRADE_STATUS } from '$lib/room-upgrades';
	let { data, form } = $props();
	let busy = $state(false);
	const selected = $derived(data.selected);
	const immutable = $derived(selected !== null && selected.status !== 'draft');
	const values = $derived(form && 'values' in form ? form.values as Record<string, string> : null);
	function localTime(iso: string | null | undefined) { return iso ? new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 16) : ''; }
	function roomName(id: string) { return data.rooms.find((r) => r.id === id)?.name ?? '公開終了のお部屋'; }
	function delivery(s: string | null) { return ({ pending: '待機中', processing: '処理中', sent: '送信済み', failed: '送信失敗', cancelled: '中止' } as Record<string, string>)[s ?? ''] ?? '対象外'; }
	function payment(s: string | null) { return ({ pending: '決済待ち', paid: '決済済み', converted: '決済・確定済み', expired: '決済期限終了', refund_pending: '返金手続き中（要確認）', refunded: '返金済み' } as Record<string, string>)[s ?? ''] ?? '現地精算／未申込'; }
</script>
<svelte:head><title>客室アップグレード提案 | 管理画面</title></svelte:head>
<h1 class="text-2xl font-semibold text-brand-900">客室アップグレード提案</h1>
<p class="mt-2 text-sm leading-7 text-stone-600">宿泊日・現在のお部屋・提案するお部屋・追加料金を設定し、その日の対象会員予約へご案内します。お客様の同意時に空室を再確認して確定します。</p>
{#if form?.message}<p role="status" class="mt-4 rounded-xl p-4 {form.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}">{form.message}</p>{/if}
{#if !data.enabled}<p class="mt-5 rounded-xl bg-stone-100 p-5">本番データ・管理ログインでご利用いただけます。</p>{:else}
	<div class="mt-6 grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
		<aside><a href="/admin/upgrades" class="mb-3 block rounded-lg border border-brand-800 p-3 text-center text-sm text-brand-900">新しい提案を作成</a><div class="space-y-2">{#each data.campaigns as c}<a href="/admin/upgrades?id={c.id}" class="block rounded-xl border p-3 text-sm {selected?.id === c.id ? 'border-brand-800 bg-stone-50' : 'border-stone-200'}"><p class="font-semibold">{c.title}</p><p class="mt-1 text-stone-500">{c.checkin} · {c.status === 'draft' ? '下書き' : c.status === 'published' ? '送信予約済み' : '受付終了'}</p></a>{/each}</div></aside>
		<section class="min-w-0">
			<form method="POST" action="?/save" use:enhance class="rounded-2xl border border-stone-200 bg-white p-5">
				<input type="hidden" name="facility" value={data.facilityId} /><input type="hidden" name="id" value={selected?.id ?? ''} />
				<h2 class="font-semibold text-brand-900">{selected ? '提案内容' : '提案を設定'}</h2>
				<fieldset disabled={immutable || busy} class="mt-4 grid gap-4 sm:grid-cols-2">
					<label class="text-sm">チェックイン日<input name="checkin" type="date" min={data.today} required value={values?.checkin ?? selected?.checkin ?? ''} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5" /></label>
					<label class="text-sm">受付期限（日本時間）<input name="expires" type="datetime-local" required value={values?.expires ?? localTime(selected?.expires_at)} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5" /></label>
					<label class="text-sm">現在のお部屋<select name="source" required value={values?.source ?? selected?.source_room_type_id ?? ''} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5"><option value="">選択してください</option>{#each data.rooms as r}<option value={r.id}>{r.name}</option>{/each}</select></label>
					<label class="text-sm">アップグレード可能なお部屋<select name="target" required value={values?.target ?? selected?.target_room_type_id ?? ''} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5"><option value="">選択してください</option>{#each data.rooms as r}<option value={r.id}>{r.name}</option>{/each}</select></label>
					<label class="text-sm">追加料金（税込・円）<input name="amount" type="number" min="0" max="1000000" step="1" required value={values?.amount ?? selected?.amount ?? 0} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5" /></label>
					<p class="text-sm">料金の単位：1室・1泊あたり。お客様には泊数を掛けた追加料金合計を表示します。0円（無料）または50円以上を設定してください。</p>
					<label class="text-sm sm:col-span-2">提案のタイトル<input name="title" maxlength="120" required value={values?.title ?? selected?.title ?? 'お部屋のアップグレードのご提案'} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5" /></label>
					<label class="text-sm sm:col-span-2">ご案内文<textarea name="description" maxlength="4000" rows="4" value={values?.description ?? selected?.description ?? ''} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5"></textarea></label>
					<label class="text-sm sm:col-span-2">通知方法<select name="channel" value={values?.channel ?? selected?.channel ?? 'email'} class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5">{#each Object.entries(UPGRADE_CHANNEL) as [key, label]}<option value={key}>{label}</option>{/each}</select></label>
					<p class="text-xs leading-6 text-stone-500 sm:col-span-2">公式サイト・yamado-oneの会員予約が対象です。定員・全泊の空室を満たす部屋のみご案内します。宿泊料金とプランはそのまま、追加料金は予約時のお支払い方法を引き継ぎます。アプリ通知はお客様の受信設定に従います。受付期限はチェックイン日の15:00までです。</p>
					{#if !immutable}<button class="rounded-lg bg-brand-800 px-5 py-3 text-white sm:col-span-2">保存して対象者を確認</button>{/if}
				</fieldset>
			</form>
			{#if selected?.status === 'draft'}
				<div class="mt-5 rounded-2xl border border-stone-200 bg-white p-5">
					<h2 class="font-semibold">送信前の確認：{data.preview.length}室分</h2><p class="mt-2 text-sm text-stone-500">{roomName(selected.source_room_type_id)} → {roomName(selected.target_room_type_id)} ／ {UPGRADE_CHANNEL[selected.channel]}</p>
					<div class="mt-4 space-y-2">{#each data.preview as r}<div class="rounded-lg bg-stone-50 p-3 text-sm"><p>{r.guest_name ?? '会員'} 様 · {r.booking_code} · {r.room_index}室目</p><p class="mt-1 text-stone-500">{r.nights}泊 · 大人{r.adults}名 · 追加料金合計 {r.total.toLocaleString()}円</p></div>{/each}</div>
					{#if data.preview.length > 0}<form method="POST" action="?/publish" class="mt-5" use:enhance={() => { busy = true; return async ({ update }) => { try { await update(); } finally { busy = false; } }; }}>
						<input type="hidden" name="id" value={selected.id} /><input type="hidden" name="count" value={data.preview.length} />{#each data.preview as r}<input type="hidden" name="stay" value={r.stay_id} />{/each}
						<label class="block text-sm">通知日時（日本時間・空欄ならすぐに送信）<input name="dispatch" type="datetime-local" class="mt-1 block w-full rounded-lg border border-stone-300 p-2.5" /></label>
						<label class="mt-4 flex items-start gap-2 text-sm"><input name="confirm" value="yes" type="checkbox" required class="mt-1" /><span>対象者・お部屋・追加料金・通知方法を確認しました。提案を送信します。</span></label>
						<button disabled={busy} class="mt-4 w-full rounded-lg bg-brand-800 px-4 py-3 text-white disabled:opacity-50">{busy ? '送信を登録中…' : '提案通知を送信・予約する'}</button>
					</form>{:else}<p class="mt-4 text-sm text-stone-500">対象の会員予約がありません。日程・部屋・全泊分の空室・定員をご確認ください。</p>{/if}
				</div>
			{:else if selected}
				<div class="mt-5 rounded-2xl border border-stone-200 bg-white p-5"><h2 class="font-semibold">通知・申込状況</h2><p class="mt-2 text-sm text-stone-500">通知日時：{localTime(selected.dispatch_at).replace('T', ' ')}（日本時間）</p>
					<div class="mt-3 space-y-2">{#each data.offers as o}<div class="rounded-lg bg-stone-50 p-3 text-sm"><p>{o.guest_name ?? '会員'} 様 · {o.booking_code} · {o.room_index}室目</p><p class="mt-1">{o.option_status === 'cancelled' ? '予約取消済み' : UPGRADE_STATUS[o.status as keyof typeof UPGRADE_STATUS]} · 追加 {o.total.toLocaleString()}円</p><p class="mt-1 text-stone-500">提案メール：{delivery(o.offer_mail_status)} ／ アプリ通知：{delivery(o.push_status)} ／ 確定メール：{delivery(o.confirmation_mail_status)}</p><p class="mt-1 text-stone-500">{payment(o.payment_status)}</p></div>{/each}</div>
					{#if selected.status === 'published'}<form method="POST" action="?/withdraw" use:enhance class="mt-4"><input type="hidden" name="id" value={selected.id} /><button class="rounded-lg border border-stone-300 px-4 py-2 text-sm">未申込の提案の受付を終了する</button></form>{/if}
				</div>
			{/if}
		</section>
	</div>
{/if}
