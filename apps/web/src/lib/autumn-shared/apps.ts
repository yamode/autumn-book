// 写し元: autumn-shared 8b93a42 src/apps.ts（Book は vendored しないので手で写す。直すときは autumn-shared を先に直して写し直す）
// Registry of autumn ecosystem apps for the app switcher.
// All apps live on *.yamado.app subdomains and share one Supabase project, so a
// session cookie scoped to `.yamado.app` (see createAutumnServerClient
// cookieDomain) is valid across every app — switching apps needs no re-login.

export type AutumnAppId = 'rms' | 'pms' | 'order' | 'book';

/**
 * アプリアイコンの配色（brand/autumn/logos/app-icon-*.svg と同じ値）。
 * 形（角丸の地＋共通の A＋斜線アクセント）は AppIcon.svelte が描く。色だけをここに持つ。
 * 識別色の決まりは brand/autumn/README.md の表（製品名／識別色／アクセント／地／A）。
 */
export type AutumnAppIconColors = { bg: string; a: string; accent: string };

export type AutumnApp = {
  id: AutumnAppId;
  name: string;
  /** タブに出す短い名前（統合ヘッダー AppHeaderTabs）。desktop/electron/apps.cjs の shortName と同じ値。 */
  shortName: string;
  emoji: string;
  /** アプリアイコンの配色（スイッチャーに出すロゴ）。 */
  icon: AutumnAppIconColors;
  description: string;
  prodUrl: string;
  defaultPath: string;
  status: 'live' | 'planned';
  inSwitcher: boolean;
};

export const ECOSYSTEM_APPS: AutumnApp[] = [
  {
    id: 'rms',
    name: 'RMS（料金管理）',
    shortName: 'RMS',
    emoji: '💰',
    icon: { bg: '#271F6C', a: '#FFFFFF', accent: '#8250E9' },
    description: '室料・プラン・OTA送信',
    prodUrl: 'https://autumn-rms.yamado.app',
    defaultPath: '/',
    status: 'live',
    inSwitcher: true
  },
  {
    id: 'pms',
    name: 'PMS（予約・部屋管理）',
    shortName: 'PMS',
    emoji: '🏨',
    icon: { bg: '#FEFEFD', a: '#0B203D', accent: '#F86520' },
    description: '部屋・予約・在庫',
    prodUrl: 'https://autumn-pms.yamado.app',
    defaultPath: '/',
    status: 'live',
    inSwitcher: true
  },
  {
    id: 'order',
    name: 'Order（館内注文）',
    shortName: 'Order',
    emoji: '🍽️',
    // 2026-09-22 指定の正式配色（白地・黒いA・深緑。autumn-order の docs/brand-icons.md）。
    icon: { bg: '#FFFFFF', a: '#000000', accent: '#285B48' },
    description: '注文・メニュー',
    prodUrl: 'https://autumn-order.yamado.app',
    defaultPath: '/',
    // 2026-10-28: 統合ヘッダーのタブから開けるよう live に（デスクトップのタブでは v0.20.0 から開いている）。
    status: 'live',
    inSwitcher: true
  },
  {
    // 2026-10-17: 「Booking」→「Book」に改名し、管理画面（book.yamado.app/admin）へ飛ぶ live に。
    // ロゴは 2026-10-17 確定の正式配色（白地・黒いA・ゴールド。autumn-book の docs/brand.md）。
    id: 'book',
    name: 'Book（直販予約）',
    shortName: 'Book',
    emoji: '🌐',
    icon: { bg: '#FFFFFF', a: '#000000', accent: '#B08D3E' },
    description: '予約サイトの管理画面',
    prodUrl: 'https://book.yamado.app',
    defaultPath: '/admin',
    status: 'live',
    inSwitcher: true
  }
];

/**
 * 統合ヘッダーのタブの並び（PMS → RMS → Order → Book）。
 * デスクトップ（desktop/electron/apps.cjs の APP_ORDER・Ctrl+1〜4）と同じ順にそろえる。
 * ECOSYSTEM_APPS の並び（RMS が先頭）はアプリ一覧（AppSwitcher）用で、ここでは使わない。
 */
export const TAB_ORDER: AutumnAppId[] = ['pms', 'rms', 'order', 'book'];

/** タブに出すアプリ（inSwitcher のものを TAB_ORDER の順に）。 */
export function getTabApps(): AutumnApp[] {
  return TAB_ORDER.map((id) => ECOSYSTEM_APPS.find((app) => app.id === id)).filter(
    (app): app is AutumnApp => !!app && app.inSwitcher
  );
}

export function getAppById(id: AutumnAppId): AutumnApp | undefined {
  return ECOSYSTEM_APPS.find((app) => app.id === id);
}

export function getAppUrl(app: AutumnApp): string {
  const base = app.prodUrl.replace(/\/$/, '');
  const path = app.defaultPath.startsWith('/') ? app.defaultPath : `/${app.defaultPath}`;
  return `${base}${path}`;
}
