<script lang="ts">
	import { deserialize } from '$app/forms';
	import { enhance } from '$lib/enhance';
	import { invalidateAll } from '$app/navigation';
	import { confirmSubmit } from '$lib/components/admin/confirm-dialog.svelte';
	import { page } from '$app/state';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import AdminIcon from '$lib/components/admin/AdminIcon.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import StatusCard from '$lib/components/admin/StatusCard.svelte';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import QrCode from '$lib/components/QrCode.svelte';
	import { downloadQrPng } from '$lib/qr-png';
	import type { StayToken } from '$lib/types';
	import { SNS_KINDS, SNS_LABEL } from '$lib/sns-links';
	import {
		DEFAULT_SPRING_BANDS,
		SPRING_TONES,
		SPRING_TONE_BAR,
		SPRING_TONE_LABEL,
		springBandFor,
		springBandRange,
		springTipFor,
		MAX_SPRING_TIP,
		type SpringBand
	} from '$lib/spring-level';

	let { data, form } = $props();

	// ---- 全館の湯量（2026-10-17）。表現（段階ごとの言葉と色）の編集 ----
	const cloneBands = (b: SpringBand[] | null) => (b ?? DEFAULT_SPRING_BANDS).map((x) => ({ ...x }));
	// 初期値は下の $effect で data から入れる
	let springPercent = $state<number | null>(null);
	let springBands = $state<SpringBand[]>(cloneBands(null));
	let springBandsDefault = $state(false);
	// 保存・施設の切り替えで読み直したら、編集欄も読み直す
	$effect(() => {
		springPercent = data.inroomSettings.springLevel.percent;
		springBands = cloneBands(data.inroomSettings.springLevel.bands);
		springBandsDefault = false;
	});
	const springPreview = $derived.by(() => {
		if (springPercent === null || springPercent === undefined || String(springPercent) === '') return null;
		const level = Math.max(0, Math.min(100, Math.round(Number(springPercent))));
		if (!Number.isFinite(level)) return null;
		const b = springBandFor(level, springBandsDefault ? null : springBands);
		// 「?」を押したときに日本語のお客様に出る説明（段階の説明 → 共通の説明 → 既定文）
		const tip = springTipFor(b, 'ja', springNote) ?? SPRING_DEFAULT_TIP_JA;
		return { level, ja: b.ja, tone: b.tone, tip };
	});
	// 共通の説明（段階の説明が空のとき・日本語）。プレビューに使うので bind する
	let springNote = $state('');
	$effect(() => {
		springNote = data.inroomSettings.springLevel.note;
	});
	const SPRING_DEFAULT_TIP_JA =
		'館内の大浴場・貸切風呂でお使いいただける温泉のお湯が、いまどのくらい残っているかの目安です。スタッフが確認して手で更新しているため、実際とは少し異なる場合があります。';
	// 段階ごとの説明欄を開いている行（説明が入っている段階ははじめから開く）
	let tipOpen = $state<Record<number, boolean>>({});
	// 「何%から」を入れ終えたら 0〜100 の整数にそろえて並べ直す。
	// 欄は bind:value にする（value だけだと、保存後に use:enhance がフォームをリセットしたとき空に戻る・2026-10-17）
	function sortBands() {
		springBands = springBands
			.map((b) => ({ ...b, min: Math.max(0, Math.min(100, Math.round(Number(b.min) || 0))) }))
			.sort((a, b) => a.min - b.min);
	}
	function addBand() {
		const top = springBands.at(-1)?.min ?? 0;
		springBands = [...springBands, { min: Math.min(100, top + 10), ja: '', en: '', zh: '', tone: 'green' as const, tipJa: '', tipEn: '', tipZh: '' }].sort(
			(a, b) => a.min - b.min
		);
	}
	function removeBand(i: number) {
		springBands = springBands.filter((_, j) => j !== i);
		tipOpen = {};
	}
	const hasTip = (b: SpringBand) => Boolean(b.tipJa?.trim() || b.tipEn?.trim() || b.tipZh?.trim());

	// 編集中のお知らせ（id）
	let editingNotice = $state<string | null>(null);
	let editingBody = $state('');
	// 新しいお知らせの本文（エディタ）
	let noticeBody = $state('');
	// ISO → datetime-local の値（JST）
	const toJstLocal = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).toISOString().slice(0, 16) : '');

	// お知らせ・湯量の日時（JST・月日 時分）
	const fmtNoticeTime = (iso: string) =>
		new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

	// ?all=1 で来たら「客室スリップ」タブを初期表示（失効一覧の再読込を跨いでも維持）
	// 館内案内・客室スリップの切り替えは共通のタブ（+layout.svelte）の ?tab=slips（従来の ?all も客室スリップ）
	// 2026-10-17 メニュー整理: ?tab なし＝きょうの運用（お知らせ・湯量）／guides＝館内案内の内容／slips＝客室スリップ（従来の ?all も）／settings＝表示の設定
	type InroomTab = 'ops' | 'guides' | 'slips' | 'settings';
	const tab = $derived.by<InroomTab>(() => {
		const t = page.url.searchParams.get('tab');
		if (t === 'slips' || page.url.searchParams.get('all')) return 'slips';
		return t === 'guides' || t === 'settings' ? t : 'ops';
	});
	const TAB_DESCRIPTION: Record<InroomTab, string> = {
		ops: 'お客様のスマホの客室案内に、いま出しているものです。お知らせ・湯量はここで更新します。',
		guides: 'Wi-Fi・お食事・お風呂など、客室案内に載せる館内案内のページを編集します。',
		slips: 'チェックイン時にお渡しする印刷スリップ（QR＋滞在コード）と、ご予約ごとの公開URLを出します。',
		settings: 'メニューの表示・内線・SNS ボタンなど、一度決めればしばらく変えない設定です。'
	};
	// きょうの運用の状態カード
	const liveNotices = $derived(data.notices.filter((n) => n.live));
	const springNow = $derived(data.inroomSettings.springLevel);


	// 公開URL は管理画面と同じオリジン。本番で開けばそのまま本番の URL になる。
	const guestUrl = (token: string) => `${page.url.origin}/r/c/${token}`;
	const qrUrl = $derived(form?.qr ? guestUrl(form.qr.token) : '');

	// 一覧の行ごとに QR を開くためのトグル（開いた行の id）
	let openQr = $state<string | null>(null);

	// 館内案内のページ1件だけの QR（ルームサービス・Wi-Fi など。2026-10-15 指示）。
	// /r/g/<id> を直接入れると、初めて読むスマホには Cookie が無くトップへ戻されるため、入口QR（/r/start）に
	// ページ（g）を添えて、施設を覚えさせてからそのページへ着地させる。Wi-Fi などコードが要るページは、コードを入れたあとに開く
	let openGuideQr = $state<string | null>(null);
	const guideQrUrl = (guideId: string) => {
		const q = new URLSearchParams({ ...(data.facilitySlug ? { f: data.facilitySlug } : {}), g: guideId });
		return `${page.url.origin}/r/start?${q.toString()}`;
	};

	// ご予約の行から公開URLを直接新しいタブで開く。発行済みならそのまま、未発行なら issueQr で発行（取り出し）してから開く。
	// ポップアップブロックを避けるため、クリックの瞬間に空のタブを開いておき、URL が決まってから移動させる。
	let openingStay = $state<string | null>(null);
	async function openStayUrl(s: { stay_id: string; room_code: string; guest_name: string; check_out_date: string; token: string | null }) {
		if (s.token) {
			window.open(guestUrl(s.token), '_blank', 'noopener');
			return;
		}
		const w = window.open('', '_blank');
		openingStay = s.stay_id;
		try {
			const fd = new FormData();
			fd.set('facilityId', data.currentFacility.id);
			fd.set('stayId', s.stay_id);
			fd.set('roomCode', s.room_code);
			fd.set('guestName', s.guest_name);
			fd.set('checkOutDate', s.check_out_date);
			const res = await fetch('?/issueQr', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } });
			const result = deserialize(await res.text());
			const token = result.type === 'success' ? (result.data as { qr?: { token?: string } } | undefined)?.qr?.token : undefined;
			if (!token) throw new Error(result.type === 'failure' ? String((result.data as { message?: string })?.message ?? '') : '');
			const url = guestUrl(token);
			if (w) {
				w.opener = null;
				w.location.href = url;
			} else {
				// 空のタブもポップアップブロックで開けなかった。URL をコピーして知らせる（発行は済んでいる）
				let copiedUrl = false;
				try {
					await navigator.clipboard.writeText(url);
					copiedUrl = true;
				} catch {
					/* クリップボードが使えない環境では URL を表示するだけ */
				}
				alert(
					copiedUrl
						? `ポップアップがブロックされました。URLをコピーしました。\n${url}`
						: `ポップアップがブロックされました。次のURLを開いてください。\n${url}`
				);
			}
			// 「発行済み」の表示を更新する
			await invalidateAll();
		} catch (e) {
			w?.close();
			alert(`公開URLを開けませんでした。${e instanceof Error && e.message ? `（${e.message}）` : ''}`);
		} finally {
			openingStay = null;
		}
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = text;
			setTimeout(() => (copied = null), 1500);
		} catch {
			/* クリップボードが使えない環境では何もしない（URL は画面に出ている） */
		}
	}
	let copied = $state<string | null>(null);

	// 2026-10-18 → 10/18（日）
	const fmtYmd = (ymd: string) => {
		const [y, mo, d] = ymd.split('-').map(Number);
		return `${mo}/${d}（${'日月火水木金土'[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]}）`;
	};

	// 日付フィルタのリンク（?date= を差し替えつつ ?all=1 等は保つ）
	const dateHref = (d: string) => {
		const p = new URLSearchParams(page.url.search);
		if (d) p.set('date', d);
		else p.delete('date');
		return `?${p.toString()}`;
	};

	const langLabel: Record<string, string> = { ja: '日本語', en: 'English', 'zh-TW': '繁體中文' };

	// トークンの状態（有効 / 失効 / 期限切れ）
	function tokenStatus(t: StayToken): 'active' | 'revoked' | 'expired' {
		if (t.revokedAt) return 'revoked';
		const now = Date.now();
		if (now >= new Date(t.validTo).getTime() || now < new Date(t.validFrom).getTime()) return 'expired';
		return 'active';
	}
	const statusLabel = { active: '有効', revoked: '失効', expired: '期限切れ' } as const;
	const statusClass = {
		active: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
		revoked: 'bg-stone-50 text-stone-500 ring-stone-200',
		expired: 'bg-amber-50 text-amber-800 ring-amber-200'
	} as const;

	function fmtDateTime(iso: string): string {
		return new Date(iso).toLocaleString('ja-JP', {
			timeZone: 'Asia/Tokyo',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head><title>客室案内 ｜ 山人管理</title></svelte:head>

<PageHeader title="客室案内" facility={data.currentFacility.name} description={TAB_DESCRIPTION[tab]} />

{#if data.loadError}
	<div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
		⚠ {data.loadError}
	</div>
{/if}

{#if form?.message}
	<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
{/if}

{#if tab === 'ops'}
	<!-- ============================ きょうの運用 ============================ -->
	<!-- いま出しているもの（押すと下の欄・それぞれの画面へ） -->
	<div class="mb-6 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
		<StatusCard
			icon="megaphone"
			title="全客室へのお知らせ"
			status={liveNotices.length ? `掲載中 ${liveNotices.length}件` : 'なし'}
			tone={liveNotices.length ? 'on' : 'off'}
			detail={liveNotices[0]?.title ?? 'いまは出していません。'}
			href="#notices"
			action={liveNotices.length ? '編集・新しく出す' : 'お知らせを出す'}
		/>
		<StatusCard
			icon="droplet"
			title="全館の湯量"
			status={springNow.enabled && springNow.percent !== null ? '表示中' : '出していない'}
			tone={springNow.enabled && springNow.percent !== null ? 'on' : 'off'}
			detail={springNow.percent !== null ? `いま ${springNow.percent}%「${springBandFor(springNow.percent, springNow.bands).ja}」${springNow.updatedAt ? `・${fmtNoticeTime(springNow.updatedAt)} 更新` : ''}` : '残量が入っていません。'}
			href="#spring"
			action="残量を更新"
		/>
		<StatusCard icon="receipt" title="精算案内" detail="利用明細・フロント案内・オンライン決済の出し分け" href="/admin/inroom/billing" action="設定を開く" />
		<StatusCard icon="ticket" title="客室スリップ" detail="チェックイン時にお渡しする QR と滞在コード" href="/admin/inroom?tab=slips" action="発行・印刷" />
	</div>

	<!-- ===== 全客室へのお知らせ（2026-10-17）。開いた端末で「確認しました」を押すまで、客室案内のトップに出る ===== -->
	{#if form?.noticeSent}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">お知らせを出しました。客室案内を開いている端末に表示されます。</p>{/if}
	{#if form?.noticeEdited}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{form.noticeEdited === 'reshow' ? 'お知らせを出し直しました。確認済みの端末にも、もう一度表示されます。' : 'お知らせを書き換えました。まだ確認していない端末に、新しい内容で表示されます。'}</p>{/if}
	{#if form?.noticeEnded}<p class="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">お知らせを取り下げました。</p>{/if}
	<section id="notices" class="mb-5 scroll-mt-24 rounded-xl border border-stone-200 bg-white p-4 text-sm sm:p-5">
		<h2 class="flex items-center gap-2 text-sm font-semibold text-stone-800"><AdminIcon name="megaphone" class="h-4 w-4 shrink-0 text-stone-500" />全客室へのお知らせ</h2>
		<p class="mt-1 text-xs text-stone-400">
			客室案内を開いた全員に、トップでお知らせを出します（断水・停電・催しのご案内など）。
			お客様がその端末で「確認しました」を押すと、その端末には次から出ません。掲載中に新しく開いた方にも出ます。
		</p>
		<form
			method="POST"
			action="?/noticeSend"
			data-reset
			use:enhance={() => async ({ result, update }) => {
				await update();
				if (result.type === 'success') noticeBody = '';
			}}
			class="mt-3 space-y-3"
		>
			<input type="hidden" name="facilityId" value={data.currentFacility.id} />
			<label class="block">
				<span class="text-xs text-stone-600">タイトル（任意）</span>
				<input name="title" maxlength="100" placeholder="例：大浴場の清掃時間変更のお知らせ" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
			</label>
			<div>
				<span class="text-xs text-stone-600">本文（太字・赤字・リンクが使えます）</span>
				<div class="mt-1"><MarkdownEditor bind:value={noticeBody} name="body" rows={6} /></div>
			</div>
			<label class="block">
				<span class="text-xs text-stone-600">掲載終了（任意・空なら取り下げるまで出します）</span>
				<input type="datetime-local" name="endsAt" class="mt-1 rounded-md border border-stone-300 px-3 py-2" />
			</label>
			<button
				type="submit"
				class="w-full rounded-lg bg-brand-800 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-700 sm:w-auto"
				onclick={confirmSubmit({ message: '客室案内を開いている全客室に、このお知らせを一斉に出します。', confirmLabel: '一斉に出す' })}
			>全客室に出す</button>
		</form>
		{#if data.noticesError}
			<p class="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">{data.noticesError}</p>
		{:else if data.notices.length}
			<ul class="mt-4 divide-y divide-stone-100 border-t border-stone-100">
				{#each data.notices as n (n.id)}
					<li class="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
						<div class="min-w-0">
							<p class="text-xs">
								{#if n.live}<span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200 ring-inset">掲載中</span>
								{:else}<span class="inline-flex items-center rounded-full bg-stone-50 px-2 py-0.5 text-[11px] font-medium text-stone-500 ring-1 ring-stone-200 ring-inset">終了</span>{/if}
								<span class="ml-1 text-stone-400">
									{fmtNoticeTime(n.startsAt)} 〜 {n.endedAt ? `${fmtNoticeTime(n.endedAt)}（取り下げ）` : n.endsAt ? fmtNoticeTime(n.endsAt) : '取り下げまで'}
								</span>
							</p>
							{#if editingNotice === n.id}
								<!-- 掲載中のお知らせの編集（2026-10-17）。既定は書き換えるだけ（確認済みの端末には出ない） -->
								<form
									method="POST"
									action="?/noticeSend"
									use:enhance={() => async ({ result, update }) => {
										await update();
										if (result.type === 'success') editingNotice = null;
									}}
									class="mt-2 space-y-2"
								>
									<input type="hidden" name="facilityId" value={data.currentFacility.id} />
									<input type="hidden" name="noticeId" value={n.id} />
									<input name="title" maxlength="100" value={n.title} placeholder="タイトル（任意）" class="w-full rounded-md border border-stone-300 px-3 py-1.5" />
									<MarkdownEditor bind:value={editingBody} name="body" rows={6} />
									<label class="block">
										<span class="text-xs text-stone-600">掲載終了（空なら取り下げるまで）</span>
										<input type="datetime-local" name="endsAt" value={toJstLocal(n.endsAt)} class="mt-1 rounded-md border border-stone-300 px-3 py-1.5" />
									</label>
									<label class="flex items-start gap-2 text-xs text-stone-600">
										<input type="checkbox" name="reshow" class="mt-0.5 h-3.5 w-3.5" />
										<span>「確認しました」を押した端末にも、もう一度出す（大事な変更のとき。今のお知らせを取り下げ、新しいお知らせとして出し直します）</span>
									</label>
									<div class="flex gap-2">
										<button type="submit" class="rounded-lg bg-brand-800 px-4 py-1.5 text-sm text-white hover:bg-brand-700">保存する</button>
										<button type="button" onclick={() => (editingNotice = null)} class="rounded-lg border border-stone-300 px-4 py-1.5 text-sm text-stone-600 hover:bg-stone-50">やめる</button>
									</div>
								</form>
							{:else}
								{#if n.title}<p class="mt-1 font-medium text-stone-800">{n.title}</p>{/if}
								<div class="mt-0.5 line-clamp-3 text-stone-600"><MarkdownView source={n.body} /></div>
							{/if}
						</div>
						{#if n.live && editingNotice !== n.id}
							<div class="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
							<button type="button" onclick={() => {
								editingBody = n.body;
								editingNotice = n.id;
							}} class="min-h-9 rounded-lg border border-stone-300 px-3 text-xs text-stone-600 hover:bg-stone-50 sm:min-h-0 sm:border-0 sm:px-0 sm:hover:bg-transparent sm:hover:text-brand-800">編集</button>
							<form method="POST" action="?/noticeEnd" use:enhance class="shrink-0">
								<input type="hidden" name="noticeId" value={n.id} />
								<button
									type="submit"
									class="min-h-9 rounded-lg border border-stone-300 px-3 text-xs text-stone-500 hover:text-red-600 sm:min-h-0 sm:border-0 sm:px-0"
									onclick={confirmSubmit({ message: 'このお知らせを取り下げます。まだ確認していない端末にも出なくなります。', confirmLabel: '取り下げる' })}
								>取り下げる</button>
							</form>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- ===== 全館の湯量の残りの目安（2026-10-17・西和賀で使う）。出す設定で値があるときだけ、客室案内のトップに出る ===== -->
	{#if form?.springLevelSaved}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">湯量の目安を保存しました。</p>{/if}
	<form id="spring" method="POST" action="?/springLevelSave" use:enhance class="mb-5 scroll-mt-24 rounded-xl border border-stone-200 bg-white p-4 text-sm sm:p-5">
		<input type="hidden" name="facilityId" value={data.currentFacility.id} />
		<h2 class="flex items-center gap-2 text-sm font-semibold text-stone-800"><AdminIcon name="droplet" class="h-4 w-4 shrink-0 text-stone-500" />全館の湯量（残りの目安）</h2>
		<p class="mt-1 text-xs text-stone-400">
			客室案内のトップ（写真のすぐ下）に、残りの目安を細い1行のメーターで出します。値を変えると「○時○分 更新」が今の時刻になります。
			{#if data.inroomSettings.springLevel.updatedAt}最終更新 {fmtNoticeTime(data.inroomSettings.springLevel.updatedAt)}。{/if}
		</p>
		<label class="mt-3 flex items-center gap-2">
			<input type="checkbox" name="enabled" checked={data.inroomSettings.springLevel.enabled} class="h-4 w-4" />
			<span>客室案内に出す</span>
		</label>
		<label class="mt-3 block">
			<span class="text-xs text-stone-600">残りの目安（%）</span>
			<span class="mt-1 flex flex-wrap items-center gap-2">
				<input
					type="number"
					name="percent"
					min="0"
					max="100"
					step="1"
					inputmode="numeric"
					bind:value={springPercent}
					class="w-28 rounded-md border border-stone-300 px-3 py-2 text-right"
				/>
				<span class="text-stone-500">%</span>
				{#if springPreview}
					<!-- いまの値でお客様に見える表示（下の「表現」の設定どおり） -->
					<span class="flex items-center gap-2 text-xs text-stone-500">
						→
						<span class="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-stone-100">
							<span class="block h-full rounded-full {SPRING_TONE_BAR[springPreview.tone]}" style="width:{springPreview.level}%"></span>
						</span>
						<span class="font-medium text-stone-700">{springPreview.level}% {springPreview.ja}</span>
					</span>
					<span class="block w-full text-xs text-stone-500">
						「?」の説明（日本語）: <span class="whitespace-pre-line text-stone-700">{springPreview.tip}</span>
					</span>
				{/if}
			</span>
		</label>

		<!-- 表現（段階ごとの言葉と色・2026-10-17 指示）。残量に応じて言葉とバーの色が変わる -->
		<div class="mt-4 rounded-lg border border-stone-200 p-3">
			<p class="text-xs font-medium text-stone-600">表現（残量ごとの言葉とバーの色）</p>
			<p class="mt-0.5 text-xs text-stone-400">
				「何%から」を入れると、次の段階の手前までがその段階になります（例：1% から → 1〜29%）。0% から の段階は必ず1つ入れてください。英語・繁体字が空なら日本語を出します。
				「説明」を開くと、その段階のときに「?」を押して出す説明を書けます（例：少ないときだけ「差し湯バルブを閉めて節約にご協力ください」）。
			</p>
			<input type="hidden" name="bands" value={JSON.stringify(springBands)} />
			<!-- スマホ（md 未満）は1段階＝1枚のカード（欄の名前つき）。md 以上は表と同じ並び（見出しの行を出す） -->
			<div class="mt-3 hidden gap-2 border-b border-stone-200 pb-1 text-xs text-stone-500 md:grid md:grid-cols-[4.5rem_5rem_repeat(3,minmax(0,1fr))_8.5rem_6.5rem_2.5rem]">
				<span>何%から</span><span>範囲</span><span>日本語</span><span>英語</span><span>繁体字</span><span>色</span><span>「?」の説明</span><span></span>
			</div>
			<div class="mt-2 space-y-2 md:mt-0 md:space-y-0">
				{#each springBands as b, i (i)}
					<div class="rounded-lg border border-stone-200 p-2.5 text-xs md:rounded-none md:border-0 md:border-b md:border-stone-100 md:p-0 md:py-1.5">
						<div class="grid grid-cols-2 items-end gap-2 md:items-center md:grid-cols-[4.5rem_5rem_repeat(3,minmax(0,1fr))_8.5rem_6.5rem_2.5rem]">
							<label class="block">
								<span class="mb-0.5 block text-[11px] text-stone-500 md:hidden">何%から</span>
								<input
									type="number"
									min="0"
									max="100"
									step="1"
									bind:value={b.min}
									onchange={sortBands}
									class="w-full rounded border border-stone-300 px-2 py-1.5 text-right md:py-1"
								/>
							</label>
							<span class="pb-1.5 whitespace-nowrap tabular-nums text-stone-500 md:pb-0"><span class="text-[11px] md:hidden">範囲 </span>{springBandRange(springBands, i)}</span>
							<label class="col-span-2 block md:col-span-1">
								<span class="mb-0.5 block text-[11px] text-stone-500 md:hidden">日本語</span>
								<input bind:value={b.ja} maxlength="40" class="w-full rounded border border-stone-300 px-2 py-1.5 md:py-1" />
							</label>
							<label class="block">
								<span class="mb-0.5 block text-[11px] text-stone-500 md:hidden">英語</span>
								<input bind:value={b.en} maxlength="40" class="w-full rounded border border-stone-300 px-2 py-1.5 md:py-1" />
							</label>
							<label class="block">
								<span class="mb-0.5 block text-[11px] text-stone-500 md:hidden">繁体字</span>
								<input bind:value={b.zh} maxlength="40" class="w-full rounded border border-stone-300 px-2 py-1.5 md:py-1" />
							</label>
							<label class="block">
								<span class="mb-0.5 block text-[11px] text-stone-500 md:hidden">色</span>
								<span class="flex items-center gap-1.5">
									<span class="inline-block h-3 w-3 shrink-0 rounded-full {SPRING_TONE_BAR[b.tone]}"></span>
									<select bind:value={b.tone} class="min-w-0 flex-1 rounded border border-stone-300 px-1.5 py-1.5 md:py-1">
										{#each SPRING_TONES as t (t)}<option value={t}>{SPRING_TONE_LABEL[t]}</option>{/each}
									</select>
								</span>
							</label>
							<!-- スマホでは「説明」と「削除」を1つの欄に並べる -->
							<div class="flex items-center justify-end gap-2 md:contents">
								<button
									type="button"
									onclick={() => (tipOpen[i] = !(tipOpen[i] ?? hasTip(b)))}
									class="min-h-9 whitespace-nowrap rounded border px-2 py-1 md:min-h-0 {hasTip(b) ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-stone-300 text-stone-600 hover:bg-stone-50'}"
									aria-expanded={tipOpen[i] ?? hasTip(b)}
								>
									{hasTip(b) ? '説明あり' : '説明'}
									{(tipOpen[i] ?? hasTip(b)) ? '▲' : '▼'}
								</button>
								<button type="button" onclick={() => removeBand(i)} disabled={springBands.length <= 1} class="min-h-9 whitespace-nowrap px-1 text-stone-400 hover:text-red-600 disabled:opacity-30 md:min-h-0">削除</button>
							</div>
						</div>
						{#if tipOpen[i] ?? hasTip(b)}
							<!-- この段階のときに「?」を押すと出す説明（2026-10-17 指示）。空なら下の「共通の説明」 -->
							<div class="mt-2 rounded-md bg-stone-50 p-2 md:mb-1.5 md:ml-[5rem]">
								<p class="mb-1 text-[11px] text-stone-500">
									{springBandRange(springBands, i)}（{b.ja || '—'}）のときに「?」を押すと出す説明。日本語が空なら下の「共通の説明」、英語・繁体字が空なら日本語を出します。
								</p>
								<div class="grid gap-2 md:grid-cols-3">
									<label class="block">
										<span class="text-[11px] text-stone-500">日本語</span>
										<textarea bind:value={b.tipJa} maxlength={MAX_SPRING_TIP} rows="3" class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1"></textarea>
									</label>
									<label class="block">
										<span class="text-[11px] text-stone-500">英語</span>
										<textarea bind:value={b.tipEn} maxlength={MAX_SPRING_TIP} rows="3" class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1"></textarea>
									</label>
									<label class="block">
										<span class="text-[11px] text-stone-500">繁体字</span>
										<textarea bind:value={b.tipZh} maxlength={MAX_SPRING_TIP} rows="3" class="mt-0.5 w-full rounded border border-stone-300 px-2 py-1"></textarea>
									</label>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
			<div class="mt-3 flex flex-wrap items-center gap-3 text-xs">
				<button type="button" onclick={addBand} disabled={springBands.length >= 10} class="min-h-9 rounded-lg border border-stone-300 px-3 py-1 text-stone-700 hover:bg-stone-50 disabled:opacity-40">＋ 段階を足す</button>
				<label class="flex items-center gap-1.5 text-stone-500">
					<input type="checkbox" name="bandsDefault" bind:checked={springBandsDefault} class="h-3.5 w-3.5" />
					既定の表現に戻す（保存すると上の設定は消えます）
				</label>
			</div>
		</div>

		<label class="mt-3 block">
			<span class="text-xs text-stone-600">「?」を押したときの共通の説明（段階ごとの説明が空のとき・任意・日本語のお客様向け）</span>
			<textarea
				name="note"
				maxlength="300"
				rows="3"
				placeholder={`空欄なら既定の説明：${SPRING_DEFAULT_TIP_JA}`}
				bind:value={springNote}
				class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
			></textarea>
			<span class="text-xs text-stone-400">段階ごとの説明が無いとき、英語・繁体字のお客様には既定の説明（翻訳済み）を出します。</span>
		</label>
		<button type="submit" class="mt-4 w-full rounded-lg bg-brand-800 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-700 sm:w-auto">保存する</button>
	</form>

{:else if tab === 'settings'}
	<!-- ============================ 表示の設定 ============================ -->
	<!-- 別の画面にある設定 -->
	<div class="mb-6 grid gap-3 sm:grid-cols-2">
		<StatusCard icon="qr" title="入口QR（客室に常設）" detail="客室に置く QR の印刷。読むと館内案内が開き、滞在コードを入れてもらいます。" href="/admin/inroom/entry" action="印刷画面を開く" />
		<StatusCard icon="book" title="サンクスページのバナー" detail="ご滞在が終わったあとに客室案内に出すバナー（次回のご予約の案内など）。" href="/admin/inroom/banners" action="バナーを編集" />
	</div>

	<!-- ===== 内線（客室からフロントへの Wi-Fi 通話・受電は autumn-call アプリ） ===== -->
	{#if form?.intercomSaved}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">内線の設定を保存しました。</p>{/if}
	<section class="mb-5 rounded-xl border border-stone-200 bg-white p-4 text-sm sm:p-5">
		<h2 class="flex items-center gap-2 text-sm font-semibold text-stone-800"><AdminIcon name="phone" class="h-4 w-4 shrink-0 text-stone-500" />内線（客室からフロントを呼ぶ）</h2>
		<p class="mt-1 text-xs text-stone-400">
			ON にすると、客室案内に「フロントを呼ぶ（Wi-Fi通話）」ボタンが出ます。受電は事務室の iPhone の受電アプリ（autumn-call）で受けます。
			受電アプリが1台も動いていない（10分以上応答がない）ときは、客室のボタンは押せなくなり、電話ボタンをご案内します。
		</p>
		{#if data.intercomError}
			<p class="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">{data.intercomError}</p>
		{:else if data.intercom}
			{@const ic = data.intercom}
			{@const firstHours = Object.values(ic.businessHours)[0]?.[0]}
			<form method="POST" action="?/intercomSave" use:enhance class="mt-3 space-y-3">
				<input type="hidden" name="facilityId" value={data.currentFacility.id} />
				<label class="flex flex-wrap items-center gap-x-2 gap-y-1">
					<input type="checkbox" name="isEnabled" checked={ic.isEnabled} class="h-4 w-4" />
					<span>内線を使う（客室にボタンを出す）</span>
					<span class="w-full pl-6 text-xs sm:w-auto sm:pl-0 {ic.onlineDevices ? 'text-emerald-700' : 'text-red-600'}">受電端末 {ic.devices} 台（稼働中 {ic.onlineDevices} 台{ic.lastSeenAt ? `・最終確認 ${new Date(ic.lastSeenAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}）</span>
				</label>
				<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
					<label class="flex w-full items-center gap-2 sm:w-auto">
						<input type="checkbox" name="allDay" checked={!firstHours} class="h-4 w-4" />
						<span>24時間受け付ける</span>
					</label>
					<span class="text-xs text-stone-500">受付時間（毎日・JST）</span>
					<span class="flex items-center gap-2">
						<input type="time" name="from" value={firstHours?.[0] ?? '07:00'} class="rounded-md border border-stone-300 px-2 py-1.5" />
						<span>〜</span>
						<input type="time" name="to" value={firstHours?.[1] ?? '22:00'} class="rounded-md border border-stone-300 px-2 py-1.5" />
					</span>
				</div>
				<label class="flex flex-wrap items-center gap-2">
					<span class="text-xs text-stone-500">呼出時間（秒・この時間出なければ「応答なし」）</span>
					<input type="number" name="ringTimeoutSec" min="10" max="120" value={ic.ringTimeoutSec} class="w-20 rounded-md border border-stone-300 px-2 py-1.5" />
				</label>
				<button type="submit" class="w-full rounded-lg bg-brand-800 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-700 sm:w-auto">保存する</button>
			</form>
			<details class="mt-4">
				<summary class="cursor-pointer py-1 text-xs text-stone-500">通話ログ（直近7日・{data.intercomCalls.length}件）</summary>
				{#if data.intercomCalls.length === 0}
					<p class="mt-2 text-xs text-stone-400">まだ通話はありません。</p>
				{:else}
					<!-- スマホでは横スクロール（日時の列は固定） -->
					<div class="mt-2 overflow-x-auto">
					<table class="w-full min-w-[420px] text-xs">
						<thead class="text-left text-stone-400"><tr><th class="sticky left-0 bg-white py-1 pr-2 font-medium">日時</th><th class="pr-2 font-medium">部屋</th><th class="pr-2 font-medium">結果</th><th class="pr-2 font-medium">通話</th><th class="font-medium">応答端末</th></tr></thead>
						<tbody>
							{#each data.intercomCalls as c (c.id)}
								<tr class="border-t border-stone-100">
									<td class="sticky left-0 bg-white py-1.5 pr-2 whitespace-nowrap">{new Date(c.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
									<td>{c.roomCode}</td>
									<td class={c.status === 'missed' ? 'font-medium text-red-600' : ''}>{({ ringing: '呼出中', active: '通話中', ended: '通話', missed: '不在', declined: '拒否', canceled: '取消' } as Record<string, string>)[c.status] ?? c.status}</td>
									<td>{c.durationSec != null ? `${Math.floor(c.durationSec / 60)}分${c.durationSec % 60}秒` : '—'}</td>
									<td>{c.deviceLabel ?? '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
					</div>
				{/if}
			</details>
		{/if}
	</section>

	<!-- ===== 客室案内のメニューの表示（施設ごと・2026-10-15） ===== -->
	{#if form?.inroomSettingsSaved}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">表示設定を保存しました。</p>{/if}
	<form method="POST" action="?/inroomSettingsSave" use:enhance class="mb-5 rounded-xl border border-stone-200 bg-white p-4 text-sm sm:p-5">
		<input type="hidden" name="facilityId" value={data.currentFacility.id} />
		<h2 class="flex items-center gap-2 text-sm font-semibold text-stone-800"><AdminIcon name="menu" class="h-4 w-4 shrink-0 text-stone-500" />客室案内のメニュー</h2>
		<label class="mt-3 flex items-center gap-2">
			<input type="checkbox" name="showFrontCall" checked={data.inroomSettings.showFrontCall} class="h-4 w-4" />
			<span>「フロントへお電話」を出す</span>
		</label>
		<p class="mt-1 text-xs text-stone-400">外しても、内線（Wi-Fi通話）がつながらないときの電話のご案内は出ます。</p>
		<button type="submit" class="mt-4 w-full rounded-lg bg-brand-800 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-700 sm:w-auto">保存する</button>
	</form>

	<!-- ===== フッターの SNS ボタン（施設ごと。空欄のボタンは出さない） ===== -->
	{#if form?.snsSaved}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">SNSのURLを保存しました。</p>{/if}
	<form method="POST" action="?/snsSave" use:enhance class="mb-5 rounded-xl border border-stone-200 bg-white p-4 text-sm sm:p-5">
		<input type="hidden" name="facilityId" value={data.currentFacility.id} />
		<h2 class="flex items-center gap-2 text-sm font-semibold text-stone-800"><AdminIcon name="globe" class="h-4 w-4 shrink-0 text-stone-500" />客室案内フッターのSNSボタン</h2>
		<p class="mt-1 text-xs text-stone-400">URL（https://…）を入れたSNSだけ、客室案内の下部にボタンで出ます。空欄なら出ません。</p>
		<div class="mt-3 grid gap-3 sm:grid-cols-2">
			{#each SNS_KINDS as k (k)}
				<label class="block">
					<span class="text-xs text-stone-600">{SNS_LABEL[k]}</span>
					<input
						type="url"
						name={k}
						value={data.snsLinks[k] ?? ''}
						placeholder="https://"
						class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
					/>
				</label>
			{/each}
		</div>
		<button type="submit" class="mt-4 w-full rounded-lg bg-brand-800 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-700 sm:w-auto">保存する</button>
	</form>

{:else if tab === 'guides'}
	<!-- ============================ 館内案内の内容 ============================ -->
	{#if form?.guideAdded}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">追加しました（下書き状態）。</p>{/if}
	{#if form?.guideDeleted}<p class="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">削除しました。</p>{/if}

	<div class="space-y-3">
		{#each data.guides as g (g.id)}
			<div class="rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
				<form method="POST" action="?/guideSave" use:enhance class="space-y-3 text-sm">
					<input type="hidden" name="facilityId" value={data.currentFacility.id} />
					<input type="hidden" name="guideId" value={g.id} />
					<div class="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
						<input name="section" value={g.section} placeholder="section" class="rounded-md border border-stone-300 px-2 py-2 text-xs sm:w-32 sm:py-1.5" />
						<input name="title" value={g.title} placeholder="タイトル" class="order-first col-span-2 rounded-md border border-stone-300 px-3 py-2 font-medium sm:order-none sm:min-w-40 sm:flex-1 sm:py-1.5" />
						<select name="lang" value={g.lang} class="rounded-md border border-stone-300 px-2 py-2 text-xs sm:py-1.5">
							{#each Object.entries(langLabel) as [code, label]}
								<option value={code}>{label}</option>
							{/each}
						</select>
						<label class="flex items-center gap-1 text-xs text-stone-500">
							並び
							<input name="sortOrder" type="number" value={g.sortOrder} class="w-16 rounded-md border border-stone-300 px-2 py-1.5" />
						</label>
						<label class="flex items-center gap-1.5 text-xs">
							<input type="checkbox" name="isPublished" checked={g.isPublished} class="h-4 w-4" /> 公開
						</label>
						{#if form?.guideSaved === g.id}<span class="text-xs text-emerald-700">✔ 保存しました</span>{/if}
					</div>
					<MarkdownEditor value={g.body} name="body" rows={8} />
					<div class="flex items-center gap-4">
						<button type="submit" class="rounded-lg bg-brand-800 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">保存</button>
						<button
							type="button"
							onclick={() => (openGuideQr = openGuideQr === g.id ? null : g.id)}
							class="inline-flex min-h-9 items-center gap-1 text-xs text-brand-700 hover:text-brand-800"><AdminIcon name="qr" class="h-3.5 w-3.5" />このページのQR</button>
					</div>
				</form>
				{#if openGuideQr === g.id}
					{@const url = guideQrUrl(g.id)}
					<div class="mt-3 flex flex-wrap items-start gap-4 rounded-lg bg-stone-50 p-3">
						<div class="rounded-lg bg-white p-2">
							<QrCode value={url} px={168} label={`${g.title} のQRコード`} />
						</div>
						<div class="min-w-0 flex-1 text-sm">
							<p class="font-medium text-stone-800">{g.title}</p>
							<p class="mt-1 text-xs text-stone-500">読み取ると、客室案内のトップではなく、このページが直接開きます。</p>
							{#if !g.isPublished}
								<p class="mt-1 text-xs text-amber-700">⚠ 非公開のため、今は読み取ってもトップが開きます。公開にしてからお使いください。</p>
							{/if}
							{#if g.section === 'wifi'}
								<p class="mt-1 text-xs text-stone-500">Wi-Fi のページは、6桁の滞在コードを入れたあとに開きます。</p>
							{/if}
							<p class="mt-2 break-all font-mono text-xs text-stone-700">{url}</p>
							<div class="mt-2 flex flex-wrap items-center gap-2">
								<button
									type="button"
									onclick={() => downloadQrPng(url, `客室案内QR_${data.currentFacility.name}_${g.title}`)}
									class="rounded-md bg-brand-800 px-3 py-1.5 text-xs text-white hover:bg-brand-700"
								>QRをPNGで保存</button>
								<button
									type="button"
									onclick={() => copy(url)}
									class="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50"
								>{copied === url ? '✔ コピーしました' : 'URLをコピー'}</button>
							</div>
						</div>
					</div>
				{/if}
				<form method="POST" action="?/guideDelete" use:enhance class="mt-2 border-t border-stone-100 pt-2">
					<input type="hidden" name="guideId" value={g.id} />
					<button
						type="submit"
						class="min-h-9 text-xs text-stone-400 hover:text-red-600"
						onclick={confirmSubmit({ message: 'この館内案内を削除します。', confirmLabel: '削除する' })}
					>削除</button>
				</form>
			</div>
		{/each}
		{#if data.guides.length === 0}
			<p class="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-8 text-center text-sm text-stone-400">
				館内案内はまだありません。下のフォームから追加してください。
			</p>
		{/if}
	</div>

	<!-- 新規追加 -->
	<form method="POST" action="?/guideAdd" data-reset use:enhance class="mt-6 rounded-xl border border-dashed border-stone-300 bg-white p-4 text-sm sm:p-5">
		<input type="hidden" name="facilityId" value={data.currentFacility.id} />
		<h2 class="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-800"><AdminIcon name="book" class="h-4 w-4 shrink-0 text-stone-500" />新しい館内案内を追加</h2>
		<div class="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
			<input name="section" placeholder="section（例: onsen）" class="rounded-md border border-stone-300 px-2 py-2 text-xs sm:w-40 sm:py-1.5" />
			<input name="title" placeholder="タイトル" class="order-first col-span-2 rounded-md border border-stone-300 px-3 py-2 sm:order-none sm:min-w-40 sm:flex-1 sm:py-1.5" />
			<select name="lang" class="rounded-md border border-stone-300 px-2 py-2 text-xs sm:py-1.5">
				{#each Object.entries(langLabel) as [code, label]}
					<option value={code}>{label}</option>
				{/each}
			</select>
			<label class="flex items-center gap-1 text-xs text-stone-500">
				並び
				<input name="sortOrder" type="number" value="0" class="w-16 rounded-md border border-stone-300 px-2 py-1.5" />
			</label>
			<label class="flex items-center gap-1.5 text-xs">
				<input type="checkbox" name="isPublished" class="h-4 w-4" /> 公開
			</label>
		</div>
		<div class="mt-2">
			<MarkdownEditor name="body" rows={8} />
		</div>
		<button type="submit" class="mt-3 w-full rounded-lg bg-accent-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-500 sm:w-auto">追加（下書きで作成）</button>
	</form>
{:else}
	<!-- ============================ 客室スリップ ============================ -->
	{#if form?.issued}
		<div class="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
			<p class="text-sm text-emerald-800">スリップを発行しました。チェックイン時にお渡しください。</p>
			<div class="mt-2 flex flex-wrap items-center gap-4">
				<div>
					<span class="text-xs text-stone-500">部屋</span>
					<span class="ml-1 font-medium text-stone-800">{form.issued.roomCode}</span>
				</div>
				<div>
					<span class="text-xs text-stone-500">滞在コード</span>
					<span class="ml-1 font-mono text-xl font-bold tracking-widest text-brand-900">{form.issued.shortCode}</span>
				</div>
				<a
					href={`/admin/inroom/slip/${form.issued.id}`}
					target="_blank"
					class="rounded-md bg-brand-800 px-4 py-1.5 text-xs text-white hover:bg-brand-700"
				>印刷スリップを開く</a>
			</div>
		</div>
	{/if}
	{#if form?.revoked}<p class="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">失効しました。</p>{/if}

	<!-- ============ 実際のご予約から公開URL・QRを出す（貸切風呂と同じ仕組み） ============ -->
	<section class="mb-6 rounded-xl border border-stone-200 bg-white">
		<header class="border-b border-stone-200 px-4 py-3">
			<h2 class="flex items-center gap-2 text-sm font-semibold text-stone-800"><AdminIcon name="qr" class="h-4 w-4 shrink-0 text-stone-500" />ご予約から公開URL・QRを出す</h2>
			<p class="mt-1 text-xs text-stone-400">
				その日にご滞在のお客様を選ぶと、そのお部屋の客室案内の公開URLとQRが出ます。管理画面からそのまま開いて確認できます。<br />
				同じご予約なら何度押しても同じURL・同じQRです（発行済みなら取り出すだけ）。
			</p>
		</header>

		<div class="px-4 py-4">
			<form method="GET" class="flex flex-wrap items-center gap-2">
				{#if data.includeInactive}<input type="hidden" name="all" value="1" />{/if}
				<label class="text-xs text-stone-500">
					日付
					<input
						type="date"
						name="date"
						value={data.date ?? ''}
						class="ml-1 rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-800"
					/>
				</label>
				<button type="submit" class="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50">この日の予約を出す</button>
				{#if data.date}
					<a href={dateHref('')} class="text-xs text-stone-400 underline hover:text-stone-600">昨日宿泊・本日チェックインに戻す</a>
				{/if}
			</form>

			{#if data.staysError}
				<p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{data.staysError}</p>
			{:else if !data.date}
				<!-- 既定の表示: 昨日宿泊のお客様 ＋ 本日チェックインのお客様（2026-10-18 指示） -->
				<div class="mt-4">
					<h3 class="text-xs font-semibold text-stone-700">
						昨日宿泊のお客様<span class="ml-2 font-normal text-stone-400">{fmtYmd(data.yesterday)} の夜・{data.yesterdayStays.length}件</span>
					</h3>
					<p class="mt-0.5 text-[11px] text-stone-400">今日チェックアウトの方と連泊中の方です。</p>
					{#if data.yesterdayStays.length === 0}
						<p class="mt-2 text-xs text-stone-400">昨日ご宿泊のお客様はいません。</p>
					{:else}
						{@render stayRows(data.yesterdayStays)}
					{/if}
				</div>
				<div class="mt-5 border-t border-stone-200 pt-4">
					<h3 class="text-xs font-semibold text-stone-700">
						本日チェックインのお客様<span class="ml-2 font-normal text-stone-400">{fmtYmd(data.today)}・{data.todayStays.length}件</span>
					</h3>
					{#if data.todayStays.length === 0}
						<p class="mt-2 text-xs text-stone-400">本日チェックインのお客様はいません。</p>
					{:else}
						{@render stayRows(data.todayStays)}
					{/if}
				</div>
			{:else if data.stays.length === 0}
				<p class="mt-3 text-xs text-stone-400">この日にご滞在のお客様はいません。</p>
			{:else}
				{@render stayRows(data.stays)}
			{/if}

			{#snippet stayRows(list: typeof data.stays)}
				<ul class="mt-2 divide-y divide-stone-100">
					{#each list as s (s.stay_id)}
						<li class="flex flex-wrap items-center gap-3 py-2 text-sm">
							<span class="min-w-16 font-medium text-stone-800">{s.room_code}</span>
							<span class="text-stone-600">{s.guest_name}</span>
							<span class="text-xs text-stone-400">{s.check_in_date}〜{s.check_out_date}</span>
							{#if s.token}
								<span class="inline-flex items-center rounded-full bg-stone-50 px-2 py-0.5 text-[11px] font-medium text-stone-500 ring-1 ring-stone-200 ring-inset">発行済み</span>
							{/if}
							<!-- 公開URLを直接開く（発行済みはそのまま、未発行はその場で発行してから開く） -->
							<button
								type="button"
								disabled={!data.live || openingStay === s.stay_id}
								onclick={() => openStayUrl(s)}
								class="ml-auto min-h-9 rounded-lg bg-brand-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40"
							>{openingStay === s.stay_id ? '開いています…' : '開く ↗'}</button>
							<form method="POST" action="?/issueQr" use:enhance>
								<input type="hidden" name="facilityId" value={data.currentFacility.id} />
								<input type="hidden" name="stayId" value={s.stay_id} />
								<input type="hidden" name="roomCode" value={s.room_code} />
								<input type="hidden" name="guestName" value={s.guest_name} />
								<input type="hidden" name="checkOutDate" value={s.check_out_date} />
								<button
									type="submit"
									disabled={!data.live}
									class="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50 disabled:opacity-40"
								>URL・QRを出す</button>
							</form>
						</li>
					{/each}
				</ul>
			{/snippet}

			{#if form?.qr}
				<div class="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
					<div class="flex flex-wrap items-start gap-4">
						<div class="rounded-lg bg-white p-2">
							<QrCode value={qrUrl} px={168} label="客室案内へのQRコード" />
						</div>
						<div class="min-w-0 flex-1 text-sm">
							<p class="font-medium text-stone-800">
								{form.qr.roomCode}
								{#if form.qr.guestName}<span class="ml-2 text-stone-500">{form.qr.guestName} 様</span>{/if}
							</p>
							<p class="mt-2 text-xs text-stone-500">公開URL</p>
							<p class="break-all font-mono text-xs text-stone-700">{qrUrl}</p>
							<div class="mt-2 flex flex-wrap items-center gap-2">
								<a
									href={qrUrl}
									target="_blank"
									rel="noopener"
									class="rounded-md bg-brand-800 px-3 py-1.5 text-xs text-white hover:bg-brand-700"
								>開いて確認する</a>
								<button
									type="button"
									onclick={() => copy(qrUrl)}
									class="rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-white"
								>{copied === qrUrl ? '✔ コピーしました' : 'URLをコピー'}</button>
								<button
									type="button"
									onclick={() => downloadQrPng(qrUrl, `客室案内QR_${form.qr.roomCode}${form.qr.guestName ? `_${form.qr.guestName}様` : ''}`)}
									class="rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-white"
								>QRをPNGで保存</button>
							</div>
							<p class="mt-3 text-xs text-stone-500">
								滞在コード <span class="font-mono text-base tracking-widest text-brand-900">{form.qr.shortCode}</span>
							</p>
							<p class="mt-2 text-xs text-stone-400">
								開くとトークンは httpOnly Cookie に交換され、URL から消えます。確認用に開いた場合は、
								ブラウザのシークレットウィンドウを使うか、あとで別のお部屋を開き直してください。
							</p>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</section>

	<!-- 発行フォーム -->
	<form method="POST" action="?/tokenIssue" use:enhance class="mb-6 rounded-xl border border-stone-200 bg-white p-4 text-sm sm:p-5">
		<input type="hidden" name="facilityId" value={data.currentFacility.id} />
		<h2 class="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-800"><AdminIcon name="ticket" class="h-4 w-4 shrink-0 text-stone-500" />滞在スリップを発行</h2>
		<div class="grid gap-3 sm:flex sm:flex-wrap sm:items-end">
			<label class="text-xs text-stone-500">
				部屋名 <span class="text-red-500">*</span>
				<input name="roomCode" required placeholder="例: 雪椿" class="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800 sm:w-40 sm:py-1.5" />
			</label>
			<label class="text-xs text-stone-500">
				ゲスト名（任意）
				<input name="guestName" placeholder="例: 山田 太郎" class="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800 sm:w-44 sm:py-1.5" />
			</label>
			<label class="text-xs text-stone-500">
				チェックアウト日 <span class="text-red-500">*</span>
				<input name="checkout" type="date" required class="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800 sm:w-auto sm:py-1.5" />
			</label>
			<button type="submit" class="rounded-lg bg-accent-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-500 sm:py-2">発行する</button>
		</div>
		<p class="mt-2 text-xs text-stone-400">有効期限はチェックアウト日の 11:00（JST）までです。</p>
	</form>

	<!-- 一覧 -->
	<div class="mb-2 flex items-center justify-between">
		<h2 class="flex items-center gap-2 text-sm font-semibold text-stone-800">発行済みスリップ</h2>
		{#if data.includeInactive}
			<a href="/admin/inroom?tab=slips" class="text-xs text-stone-400 hover:text-stone-600">← 有効なもののみ表示</a>
		{:else}
			<a href="/admin/inroom?all=1" class="text-xs text-stone-400 hover:text-stone-600">失効済みも表示 →</a>
		{/if}
	</div>

	<!-- スマホでは横スクロール（部屋の列は固定） -->
	<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
		<table class="w-full min-w-[600px] text-left text-sm">
			<thead class="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
				<tr>
					<th class="sticky left-0 bg-stone-50 px-3 py-2 font-medium">部屋</th>
					<th class="px-3 py-2 font-medium">ゲスト</th>
					<th class="px-3 py-2 font-medium">コード</th>
					<th class="px-3 py-2 font-medium">期限</th>
					<th class="px-3 py-2 font-medium">状態</th>
					<th class="px-3 py-2 font-medium">操作</th>
				</tr>
			</thead>
			<tbody>
				{#each data.tokens as t (t.id)}
					{@const st = tokenStatus(t)}
					<tr class="border-b border-stone-100 last:border-0">
						<td class="sticky left-0 bg-white px-3 py-2 font-medium text-stone-800">{t.roomCode}</td>
						<td class="px-3 py-2 text-stone-600">{t.guestName ?? '—'}</td>
						<td class="px-3 py-2 font-mono tracking-wider text-stone-700">{t.shortCode}</td>
						<td class="px-3 py-2 text-xs text-stone-500">{fmtDateTime(t.validTo)}</td>
						<td class="px-3 py-2">
							<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset {statusClass[st]}">{statusLabel[st]}</span>
						</td>
						<td class="px-3 py-2">
							<div class="flex items-center gap-4 whitespace-nowrap">
								<a
									href={guestUrl(t.token)}
									target="_blank"
									rel="noopener"
									class="text-xs text-brand-700 hover:text-brand-800">↗ 開く</a>
								<button
									type="button"
									onclick={() => (openQr = openQr === t.id ? null : t.id)}
									class="text-xs text-brand-700 hover:text-brand-800">QR</button>
								<a href={`/admin/inroom/slip/${t.id}`} target="_blank" class="text-xs text-brand-700 hover:text-brand-800">印刷</a>
								{#if st === 'active'}
									<form method="POST" action="?/tokenRevoke" use:enhance class="inline">
										<input type="hidden" name="tokenId" value={t.id} />
										<button
											type="submit"
											class="text-xs text-stone-400 hover:text-red-600"
											onclick={confirmSubmit({ message: 'このスリップを失効します。ゲストのアクセスがすぐに無効になります。', confirmLabel: '失効する' })}
										>失効</button>
									</form>
								{/if}
							</div>
						</td>
					</tr>
					{#if openQr === t.id}
						<tr class="border-b border-stone-100 bg-stone-50 last:border-0">
							<td colspan="6" class="px-3 py-4">
								<!-- 横スクロールしても QR が画面の左に残るように -->
								<div class="sticky left-3 flex max-w-[calc(100vw-4rem)] flex-wrap items-start gap-4 md:max-w-none">
									<div class="rounded-lg bg-white p-2">
										<QrCode value={guestUrl(t.token)} px={168} label={`${t.roomCode} の客室案内へのQRコード`} />
									</div>
									<div class="min-w-0 flex-1 text-sm">
										<p class="text-xs text-stone-500">公開URL</p>
										<p class="break-all font-mono text-xs text-stone-700">{guestUrl(t.token)}</p>
										<button
											type="button"
											onclick={() => copy(guestUrl(t.token))}
											class="mt-2 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50"
										>{copied === guestUrl(t.token) ? '✔ コピーしました' : 'URLをコピー'}</button>
										<button
											type="button"
											onclick={() => downloadQrPng(guestUrl(t.token), `客室案内QR_${t.roomCode}${t.guestName ? `_${t.guestName}様` : ''}`)}
											class="mt-2 ml-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50"
										>QRをPNGで保存</button>
										<p class="mt-3 text-xs text-stone-500">
											滞在コード <span class="font-mono text-base tracking-widest text-brand-900">{t.shortCode}</span>
										</p>
									</div>
								</div>
							</td>
						</tr>
					{/if}
				{/each}
				{#if data.tokens.length === 0}
					<tr><td colspan="6" class="px-3 py-8 text-center text-sm text-stone-400">スリップはまだありません。</td></tr>
				{/if}
			</tbody>
		</table>
	</div>
{/if}
