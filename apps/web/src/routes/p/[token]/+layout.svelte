<script lang="ts">
  import { navigating, page } from '$app/stores';
  import { partnerAccent } from '$lib/partner-theme';
  import PartnerPageSkeleton from '$lib/components/PartnerPageSkeleton.svelte';

  // 取引先向けページの枠（autumn-rms から移設・2026-09-26）。Book の公開サイト共通ヘッダー/フッターは出さない
  // （/p は (public) グループの外に置いているので、上位は root layout だけ。解析・デバッグは root 側で /p を除外）。
  // 見た目は Book の公開予約フロー（/booking）と同じトークン・部品に揃える（2026-09-26）:
  //   地 stone-50・カード白＋stone-200 の枠・文字 brand-900・予約ボタン accent-600・文字は Book 全体のゴシック（app.css の html）。
  // 施設ごとの差し色（--pt-accent / --pt-accent-soft）だけは取引先ページ独自に残す（yamado = 森の緑 / oga = 夜の海）。
  let { children } = $props();
  const portal = $derived(
    $page.data.portal as
      | {
          partnerName: string;
          facilityName: string;
          facilitySlug?: string;
          facilityChoices?: { slug: string; name: string }[];
          loginId?: string | null;
          bookingEnabled?: boolean;
          preview?: boolean;
          noFacilityMessage?: string | null;
        }
      | undefined
  );
  // 施設の切替（複数施設化 S4・2026-10-09）: オンの施設が2つ以上の取引先だけ、施設名の位置をセグメント切替にする（N12）。
  // 1施設の取引先は今までどおり施設名を出すだけ。切替は POST /p/<token>/facility（クッキー）→ 同じページへ戻る。
  const choices = $derived(portal?.facilityChoices ?? []);
  const here = $derived(`${$page.url.pathname}${$page.url.search}`);
  function confirmSwitch(e: SubmitEvent) {
    const slug = (e.submitter as HTMLButtonElement | null)?.value ?? '';
    // 今の施設を押したときは何もしない
    if (slug === portal?.facilitySlug) {
      e.preventDefault();
      return;
    }
    // 予約入力の途中（/book）は入力内容が消えるので確かめる。予約はフォームの施設で確定するので、切り替えても入力中の予約の施設は変わらない
    const onBook = /^\/book(\/|$)/.test($page.url.pathname.slice(`/p/${$page.params.token}`.length));
    if (onBook && !confirm('施設を切り替えると、入力中の予約の内容が消えます。切り替えますか？')) {
      e.preventDefault();
    }
  }
  // メインメニュー（並び順どおり。予約一覧は予約を受け付けている取引先だけ）
  const MENU: [string, string][] = [
    ['calendar', '料金カレンダー'],
    ['rooms', 'お部屋'],
    ['plans', 'プラン'],
    ['rate-sheet', '料金表'],
    ['bookings', '予約一覧'],
    ['memorandum', '覚書'],
    ['account', 'アカウント']
  ];
  const menu = $derived(MENU.filter(([path]) => path !== 'bookings' || portal?.bookingEnabled));

  // ---- メニューの切替を先に見せる（2026-10-10）----
  // SvelteKit は行き先の load が終わるまで前の画面のままなので、同じ取引先のメインメニューのページ（/p/<token>/<menu> ちょうど）へ
  // 移る間は、メニューの選択をすぐ行き先にし、本文を行き先の「読み込み中」の骨組みに差し替える（ちらつかないよう 120ms 待ってから）。
  // 対象外: 同じページ内の検索（?date= 等の goto・同じ pathname）、予約入力・支払い・アカウントのタブなどメニュー以外の行き先、フォームの送信。
  // 前の画面は消さずに隠すだけ（移れなかったときはそのまま戻る）。
  const menuPathOf = (url: URL) => {
    const base = `/p/${$page.params.token}/`;
    if (url.origin !== $page.url.origin || !url.pathname.startsWith(base)) return null;
    const rest = url.pathname.slice(base.length).replace(/\/+$/, '');
    return MENU.some(([path]) => path === rest) ? rest : null;
  };
  const pendingMenu = $derived.by(() => {
    const nav = $navigating;
    const to = nav?.to?.url;
    if (!nav || !to || nav.type === 'form' || to.pathname === $page.url.pathname) return null;
    return menuPathOf(to);
  });
  let skeleton = $state<string | null>(null);
  $effect(() => {
    const m = pendingMenu;
    if (!m) {
      skeleton = null;
      return;
    }
    const t = setTimeout(() => (skeleton = m), 120);
    return () => clearTimeout(t);
  });

  // メニューの現在地（予約入力 /book は「料金カレンダー」側に含める。/bookings とは区別する）。メニューで移る間は行き先
  const isActive = (path: string) => {
    if (pendingMenu) return path === pendingMenu;
    const base = `/p/${$page.params.token}/`;
    const rest = $page.url.pathname.startsWith(base) ? $page.url.pathname.slice(base.length) : '';
    const head = rest.split('/')[0];
    return path === 'calendar' ? head === 'calendar' || head === 'book' : head === path;
  };
  // 差し色の定義は lib/partner-theme.ts（決済部品にも同じ色を渡す）
  const theme = $derived(partnerAccent(portal?.facilitySlug));

  // 固定ヘッダーの実際の高さ（画面幅でメニューが折り返すと変わる）を --portal-header-h に入れる（2026-10-06）。
  // 右欄の追従（sticky）の位置と、ページ内移動（scrollIntoView）の止まる位置を、ヘッダーの下にそろえるため。
  let headerEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!headerEl) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--portal-header-h', `${headerEl!.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(headerEl);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--portal-header-h');
    };
  });
</script>

<svelte:head>
  <!-- ホーム画面に追加したときの名前は施設名にする。 -->
  <meta name="apple-mobile-web-app-title" content={portal?.facilityName ?? ''} />
  <!--
    取引先ページの文字を全体に一回り大きく（2026-10-06 指示「まだ全体的に文字が小さい」）。基準 16px → 18px。
    Tailwind v4 の文字・余白は rem なので同じ比率で大きくなる。px で直に指定した小さな文字も rem に読み替えて一緒に大きくする。
    head に置くので取引先ページにいる間だけ効く（公式サイト・管理画面は変わらない）。
    ノートPCでは大きすぎた（2026-10-08 指示）ので、PC幅（1024px〜）は画面幅に合わせてなめらかに変える:
    幅 1280px 以下 = 16px（ノートPC）→ 幅 1920px 以上 = 18px（デスクトップ・従来どおり）。スマホ・タブレットは 18px のまま。
  -->
  <style>
    html { font-size: 112.5%; scroll-padding-top: calc(var(--portal-header-h, 6rem) + 1rem); }
    @media (min-width: 1024px) {
      html { font-size: clamp(100%, 75% + 0.3125vw, 112.5%); }
    }
    .text-\[10px\] { font-size: 0.6875rem; }
    .text-\[11px\] { font-size: 0.75rem; }
    .text-\[15px\] { font-size: 0.9375rem; }
    .text-\[17px\] { font-size: 1.0625rem; }
  </style>
</svelte:head>

<div class="partner-portal min-h-screen overflow-x-clip bg-stone-50 text-brand-900" style={`--pt-accent:${theme.accent};--pt-accent-soft:${theme.accentSoft}`}>
  <header bind:this={headerEl} class="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
    {#if portal?.preview}
      <!-- 管理画面の「確認ページを開く」から開いた確認モード（見るだけ・予約の確定や取消はできない） -->
      <p class="bg-amber-400 px-4 py-1 text-center text-xs font-bold text-amber-950 sm:text-sm" role="status">管理者の確認モード — 取引先から見た画面です。予約の最終確認まで進めますが、確定・取消・保存はできません。</p>
    {/if}
    <!-- 本文の表示領域を広く取るため高さを詰める（2026-10-06）: 上下の余白を小さくし、PCでは施設名と「専用料金」を横1行に並べる。 -->
    <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2 sm:px-6">
      <div class="flex min-w-0 flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-3">
        {#if choices.length >= 2}
          <h1 class="sr-only">{portal?.facilityName ?? ''}</h1>
          <form method="POST" action={`/p/${$page.params.token}/facility`} onsubmit={confirmSwitch} class="flex max-w-full rounded-full border border-stone-200 bg-stone-50 p-0.5" aria-label="施設の切替">
            <input type="hidden" name="next" value={here} />
            {#each choices as f (f.slug)}
              {@const current = f.slug === portal?.facilitySlug}
              <button
                type="submit"
                name="f"
                value={f.slug}
                aria-pressed={current}
                class={`truncate rounded-full px-3 py-1 font-display text-sm tracking-wide transition sm:text-base ${current ? 'bg-white font-bold text-[var(--pt-accent)] shadow-sm' : 'text-stone-500 hover:text-brand-900'}`}
              >{f.name}</button>
            {/each}
          </form>
        {:else}
          <h1 class="truncate font-display text-lg tracking-wide text-brand-900 sm:text-xl">{portal?.facilityName ?? ''}</h1>
        {/if}
        {#if portal?.partnerName}
          <p class="inline-flex max-w-full shrink-0 items-center gap-1.5 truncate rounded-full bg-[var(--pt-accent-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--pt-accent)]">
            <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--pt-accent)]"></span>
            {portal.partnerName} 様 専用料金
          </p>
        {/if}
      </div>
      {#if portal?.loginId}
        <!-- お部屋・プランの紹介・料金表（CSV / PDF・2026-10-09）・覚書・アカウントはログインした取引先すべてに見せる。予約一覧は予約を受け付けている取引先だけ。
             項目が増えてもスマホでは1行の横スクロールのまま（折り返さない）。 -->
        <nav class="order-last flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto" aria-label="取引先メニュー">
          {#each menu as [path, lbl] (path)}
            {@const active = isActive(path)}
            <a href={`/p/${$page.params.token}/${path}`} class={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 transition ${active ? 'bg-brand-800 text-white' : 'text-stone-600 hover:bg-stone-50 hover:text-brand-800'}`}>{lbl}</a>
          {/each}
        </nav>
      {/if}
      {#if portal?.loginId}
        <form method="POST" action={`/p/${$page.params.token}/logout`} class="flex items-center gap-3 text-sm">
          <span class="hidden text-stone-500 sm:inline">{portal.loginId}</span>
          <button type="submit" class="rounded-lg border border-stone-300 px-3 py-1 text-sm text-stone-600 transition hover:bg-stone-50">
            {portal.preview ? '確認を終える' : 'ログアウト'}
          </button>
        </form>
      {/if}
    </div>
  </header>
  {#if portal?.loginId && portal?.noFacilityMessage}
    <!-- オンの施設が1つも無い取引先（N9・2026-10-09 複数施設化）: ログインはできるが料金・予約は出さない -->
    <p class="mx-auto mt-4 max-w-6xl rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:px-6" role="status">{portal.noFacilityMessage}</p>
  {/if}
  {#if skeleton}
    <PartnerPageSkeleton path={skeleton} label={MENU.find(([path]) => path === skeleton)?.[1] ?? ''} />
  {/if}
  <!-- 骨組みを出している間は前の画面を隠すだけ（消さない） -->
  <div class={skeleton ? 'hidden' : 'contents'}>
    {@render children()}
  </div>
  <!-- 規約3点は取引先ページの中で見せる（公式サイトはまだ非公開のため。中身は公式サイトと同じ・legal/[page]） -->
  <footer class="mx-auto max-w-6xl px-4 pb-10 pt-6 text-center text-sm leading-6 text-stone-500 sm:px-6">
    このページは貴社専用です。URL・ログイン情報は社外へ共有しないでください。
    <nav class="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
      <a href={`/p/${$page.params.token}/legal/tokushoho`} class="underline hover:text-stone-700">特定商取引法に基づく表記</a>
      <a href={`/p/${$page.params.token}/legal/privacy`} class="underline hover:text-stone-700">プライバシーポリシー</a>
      <!-- 宿泊約款は正式な文面ができるまで出さない（2026-10-06 指示） -->
    </nav>
  </footer>
</div>
