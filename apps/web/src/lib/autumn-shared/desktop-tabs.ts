// 写し元: autumn-shared 8b93a42 src/desktop-tabs.ts（Book は vendored しないので手で写す。直すときは autumn-shared を先に直して写し直す）
/**
 * デスクトップ（Autumn PMS デスクトップ・タブ型シェル v0.21.0〜）との橋渡し。
 * 統合ヘッダー（components/AppHeaderTabs.svelte）が使う。設計: autumn-pms/desktop/docs/integrated-header-design.md §5
 *
 * 分岐はこの 1 点だけ: `window.autumnDesktop.tabs.state()` が非 null → デスクトップのタブ型。
 *   - ブラウザ（autumnDesktop が無い）・旧シェル（v0.20.x 以前で state が無い）・従来表示（classic で state が null）は
 *     すべて「デスクトップではない」扱い＝タブは普通のリンクのまま動く。
 *   - `autumnDesktop.app.id` や isDesktop() では判定しない（classic でも app.id='pms' が入るため）。
 *
 * ★この型は desktop/electron/preload.cjs・tabs.cjs の state() と手で揃える。
 */
import type { AutumnAppId } from './apps';

export type DesktopTabInfo = {
  id: AutumnAppId;
  shortName: string;
  name: string;
  icon: { bg: string; a: string; accent: string };
  /** View を作ったか（遅延生成） */
  created: boolean;
  loading: boolean;
  error: boolean;
  /** 未読数（ページタイトル先頭の「(N)」）。無ければ null */
  badge: number | null;
  /** そのタブのページタイトル */
  title: string;
};

export type DesktopTabsState = {
  /** デスクトップ本体の版 */
  version: string;
  active: AutumnAppId;
  /** 端末設定で無効にしたタブは入っていない */
  tabs: DesktopTabInfo[];
  /** シェルからのお知らせ（宣言中に出うるのは「ローカルSSR端末」の注記だけ） */
  notice: string | null;
  update: { state: string; version: string };
  /** 'auto' = 統合ヘッダー（宣言でタブバーを畳む）／'shell' = タブバーを出し続ける（緊急時の戻し） */
  headerMode: 'auto' | 'shell';
  localServer: boolean;
};

export type DesktopMenuRequest = { kind: 'shell' } | { kind: 'tab'; appId: AutumnAppId };

export type DesktopTabsBridge = {
  open?: (appId: AutumnAppId, path: string) => Promise<{ ok: boolean; error?: string }>;
  current?: () => Promise<AutumnAppId>;
  state: () => Promise<DesktopTabsState | null>;
  onState: (cb: (s: DesktopTabsState) => void) => () => void;
  activate: (appId: AutumnAppId) => Promise<boolean>;
  claimHeader: () => Promise<boolean>;
  releaseHeader: () => Promise<boolean>;
  menu: (req: DesktopMenuRequest) => Promise<boolean>;
};

/**
 * 統合ヘッダー用のブリッジ（v0.21.0〜のシェル）。SSR・ブラウザ・旧シェルでは null。
 * 関数が全部そろっているときだけ返す（一部だけある変な版でも壊れないように）。
 */
export function getDesktopTabsBridge(): DesktopTabsBridge | null {
  if (typeof window === 'undefined') return null;
  try {
    const t = (window as unknown as { autumnDesktop?: { tabs?: Partial<DesktopTabsBridge> } }).autumnDesktop?.tabs;
    if (!t) return null;
    const need = ['state', 'onState', 'activate', 'claimHeader', 'releaseHeader', 'menu'] as const;
    for (const k of need) if (typeof t[k] !== 'function') return null;
    return t as DesktopTabsBridge;
  } catch {
    return null;
  }
}

/** 旧シェル（v0.20.x）にもある「他アプリのタブで開く」。無ければ null。 */
export function getDesktopOpen(): DesktopTabsBridge['open'] | null {
  if (typeof window === 'undefined') return null;
  try {
    const open = (window as unknown as { autumnDesktop?: { tabs?: { open?: unknown } } }).autumnDesktop?.tabs?.open;
    return typeof open === 'function' ? (open as DesktopTabsBridge['open']) : null;
  } catch {
    return null;
  }
}

function isTabsState(s: unknown): s is DesktopTabsState {
  return !!s && typeof s === 'object' && Array.isArray((s as DesktopTabsState).tabs) && typeof (s as DesktopTabsState).active === 'string';
}

// ── タブの状態の購読（同じページの部品どうしで 1 本を共有する）──────────
let current: DesktopTabsState | null = null;
const listeners = new Set<(s: DesktopTabsState | null) => void>();
let unsubscribeBridge: (() => void) | null = null;

function notify() {
  for (const l of listeners) {
    try {
      l(current);
    } catch {
      /* 1 つの部品の失敗で他を止めない */
    }
  }
}

/**
 * デスクトップのタブの状態を購読する。デスクトップ・タブ型でなければ一度も呼ばれない（cb は null を受け取らない
 * ＝ブラウザでは何も起きない）。返り値は購読解除関数。onMount の中で呼ぶこと（SSR では何もしない）。
 */
export function watchDesktopTabs(cb: (s: DesktopTabsState) => void): () => void {
  const bridge = getDesktopTabsBridge();
  if (!bridge) return () => {};
  const listener = (s: DesktopTabsState | null) => {
    if (s) cb(s);
  };
  listeners.add(listener);
  if (current) listener(current);
  if (!unsubscribeBridge) {
    let pushed = false;
    try {
      unsubscribeBridge = bridge.onState((s) => {
        pushed = true;
        current = isTabsState(s) ? s : null;
        notify();
      });
    } catch {
      unsubscribeBridge = () => {};
    }
    bridge
      .state()
      .then((s) => {
        if (pushed) return; // 先に push が来ていればそちらが新しい
        current = isTabsState(s) ? s : null;
        notify();
      })
      .catch(() => {
        /* 旧シェル・権限なし: デスクトップではない扱いのまま */
      });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribeBridge) {
      try {
        unsubscribeBridge();
      } catch {
        /* noop */
      }
      unsubscribeBridge = null;
      current = null;
    }
  };
}

// ── 統合ヘッダーの宣言（ページに 1 つ。部品が複数あっても数えて 1 回だけ宣言・取り下げ）──
let claimCount = 0;
let claimed = false;

/**
 * 「このページが統合ヘッダー（タブ）を描いた」とシェルに伝える。デスクトップのタブ型で headerMode='auto' のときだけ。
 * 返り値は取り下げ関数（onDestroy で呼ぶ）。ブラウザ・旧シェル・classic では何もしない。
 */
export function claimDesktopHeader(): () => void {
  const bridge = getDesktopTabsBridge();
  if (!bridge) return () => {};
  claimCount += 1;
  let released = false;
  bridge
    .state()
    .then((s) => {
      if (released || claimed || claimCount === 0) return;
      if (!isTabsState(s) || s.headerMode !== 'auto') return; // classic・shell は宣言しない
      claimed = true;
      return bridge.claimHeader();
    })
    .catch(() => {
      /* 宣言できなくてもシェルのタブバーが出たままになるだけ */
    });
  return () => {
    if (released) return;
    released = true;
    claimCount = Math.max(0, claimCount - 1);
    if (claimCount === 0 && claimed) {
      claimed = false;
      bridge.releaseHeader().catch(() => {
        /* noop */
      });
    }
  };
}
