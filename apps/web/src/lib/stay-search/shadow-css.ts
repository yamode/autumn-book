// HP 配布の <yamado-search-bar>（Shadow DOM）に入れる CSS の書き換え。vite.embed.config.ts がビルド時に使う（テスト: stay-search.test.ts）。

/** 1rem を何 px にするか（取引先ページの基準 112.5% = 18px） */
export const REM_PX = 18;
const num = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * Shadow DOM 用に CSS を書き換える。
 * - 画面幅の @media (width >= Xrem) → ホスト要素の幅の @container (width >= Ypx)（メディアクエリの rem は 16px）
 * - rem → px（HP の html の文字の大きさに左右されないように）
 * - Tailwind の @property（影・リングなどの初期値）は Shadow DOM の中では効かないので、同じ初期値を :host と全要素に置く
 */
export function shadowCss(input: string): string {
	// Tailwind の出力は `(width >= 48rem)`、最適化後は `(min-width: 48rem)` の形になる
	let css = input.replace(
		/@media\s*\(\s*(?:width\s*>=|min-width\s*:)\s*([\d.]+)rem\s*\)/g,
		(_, v) => `@container (min-width: ${num(Number(v) * 16)}px)`
	);
	css = css.replace(/(-?\d*\.?\d+)rem\b/g, (_, v) => `${num(Number(v) * REM_PX)}px`);
	// 初期値の無いもの（--tw-leading など）も initial にして、親の値を受け継がないようにする（@property の inherits: false と同じ）
	const initials: string[] = [];
	css = css.replace(/@property\s+(--[\w-]+)\s*\{([^}]*)\}/g, (_, name: string, body: string) => {
		const m = /initial-value\s*:\s*([^;]+)/.exec(body);
		initials.push(`${name}:${m ? m[1].trim() : 'initial'}`);
		return '';
	});
	// Tailwind が古いブラウザ向けに @supports の中で同じ初期値を置く場合があるが、条件に関係なく効かせる
	if (initials.length) css = `@layer properties{:host,*,::before,::after,::backdrop{${initials.join(';')}}}\n${css}`;
	return css;
}
