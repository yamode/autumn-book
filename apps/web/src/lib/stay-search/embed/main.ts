// HP 配布の検索バー <yamado-search-bar> の入口（vite.embed.config.ts で static/embed/search-bar.js に 1 ファイルでビルドする）。
// 施設 HP に次の 2 行を置くと、取引先ページの検索バーと同じ部品（StaySearchBar）が Shadow DOM の中に出る。
//   <yamado-search-bar facility="oga" lang="ja" utm-source="hp_oga" utm-content="search_bar">
//     <form method="GET" action="https://book.yamado.app/yamado/oga/plans">…（JS が動かないときの代替）…</form>
//   </yamado-search-bar>
//   <script src="https://book.yamado.app/embed/search-bar.js" defer></script>
// 属性: facility（nishiwaga | oga・必須。これ以外なら何も描かず、中の代替フォームをそのまま見せる）、
//       lang（ja | en | zh-TW。省略時は <html lang>。ko は en）、utm-source（既定 hp_<facility>）、utm-content（既定 search_bar）。
// 色は CSS 変数 --yamado-search-accent / --yamado-search-accent-soft で HP 側から上書きできる。書体は HP のものを継承する。
import { mount, unmount } from 'svelte';
import EmbedSearchBar from './EmbedSearchBar.svelte';
import css from './embed.css?inline';
import { EMBED_FACILITIES, apiOrigin, normalizeFacility, resolveLang } from '../params';

const TAG = 'yamado-search-bar';
// API の取得先と遷移先は、このスクリプトを配ったオリジン（本番は https://book.yamado.app）
const ORIGIN = apiOrigin(document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : '');

class YamadoSearchBarElement extends HTMLElement {
	static observedAttributes = ['facility', 'lang', 'utm-source', 'utm-content'];
	private app: Record<string, unknown> | null = null;

	connectedCallback() {
		this.render();
	}

	disconnectedCallback() {
		this.destroy();
	}

	attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null) {
		if (oldValue !== newValue && this.isConnected) this.render();
	}

	private destroy() {
		if (this.app) unmount(this.app);
		this.app = null;
	}

	private render() {
		this.destroy();
		const facility = normalizeFacility(this.getAttribute('facility'));
		if (!facility) {
			// 施設が分からないときは何も描かない（Shadow DOM を付けなければ中の代替フォームがそのまま見える）
			console.warn(`[${TAG}] facility は nishiwaga か oga を指定してください`);
			if (this.shadowRoot) this.shadowRoot.replaceChildren();
			return;
		}
		// slot を置かないので、中の代替フォーム（light DOM の子）は描かれない
		const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
		const acc = EMBED_FACILITIES[facility];
		const style = document.createElement('style');
		style.textContent = `:host{--pt-accent:var(--yamado-search-accent,${acc.accent});--pt-accent-soft:var(--yamado-search-accent-soft,${acc.accentSoft})}\n${css}`;
		const target = document.createElement('div');
		root.replaceChildren(style, target);
		this.app = mount(EmbedSearchBar, {
			target,
			props: {
				origin: ORIGIN,
				facility,
				lang: resolveLang(this.getAttribute('lang'), document.documentElement.getAttribute('lang')),
				utmSource: (this.getAttribute('utm-source') ?? '').trim(),
				utmContent: (this.getAttribute('utm-content') ?? '').trim()
			}
		});
	}
}

if (!customElements.get(TAG)) customElements.define(TAG, YamadoSearchBarElement);
