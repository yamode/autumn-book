// 後から届く値（server load が返す Promise・SvelteKit のストリーミング）を画面で受ける（2026-10-10・取引先ページ）。
// 最初の値が届くまでは current = null（読み込み中の枠を出す）。同じページの読み直し（フォームの送信・検索）の間は
// 前の値を残し、新しい値が届いたら入れ替える（{#await} だと読み直しのたびに枠へ戻ってちらつくため）。
// コンポーネントの初期化中に呼ぶこと（$effect を使う）。Promise は失敗しない形で返す（失敗は値の中の error で表す）前提。
export function streamed<T>(get: () => Promise<T>): { readonly current: T | null } {
  let value = $state<T | null>(null);
  $effect(() => {
    const p = get();
    let cancelled = false;
    void p.then(
      (v) => {
        if (!cancelled) value = v;
      },
      () => undefined
    );
    return () => {
      cancelled = true;
    };
  });
  return {
    get current() {
      return value;
    }
  };
}
