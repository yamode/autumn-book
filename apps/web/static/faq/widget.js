/*!
 * autumn-book FAQ ウィジェット（設計書 autumn_book_faq_bot_design.md §6）
 * 施設HPに次の1行を貼ると、右下に「よくある質問」ボタンが出る。
 *   <script src="https://book.yamado.app/faq/widget.js" data-facility="oga" defer></script>
 * ページ内に一覧を出す場合（任意）:
 *   <div data-autumn-faq="oga"></div>
 * 言語は data-locale（ja / en / zh-TW）か、無ければ <html lang> で決める。
 * 依存ライブラリなし。Shadow DOM で HP 側の CSS と干渉しない。
 */
(function () {
	'use strict';
	var script = document.currentScript;
	if (!script || window.__autumnFaqLoaded) return;
	window.__autumnFaqLoaded = true;

	var API = new URL(script.src).origin + '/api/faq/';
	var FACILITY = script.getAttribute('data-facility') || '';
	var htmlLang = (document.documentElement.getAttribute('lang') || 'ja').toLowerCase();
	var LOCALE = script.getAttribute('data-locale') || (htmlLang.indexOf('zh') === 0 ? 'zh-TW' : htmlLang.indexOf('en') === 0 ? 'en' : 'ja');
	var ACCENT = script.getAttribute('data-color') || '#2b2b2b';

	var T = {
		ja: { open: 'よくある質問', hint: 'ご質問はこちら', title: 'よくある質問', placeholder: '例: チェックインは何時から？', search: '検索', results: '検索結果', categories: 'カテゴリから探す', helpful: '解決しましたか？', yes: 'はい', no: 'いいえ', thanks: 'ありがとうございました。', notFound: 'お探しの回答が見つかりませんでした。', contactLead: 'お手数ですが、お電話またはお問い合わせフォームからお問い合わせください。いただいたご質問は今後の回答の参考にいたします。', call: '電話する', form: 'お問い合わせフォーム', error: '読み込みに失敗しました。時間をおいてお試しください。', busy: '検索が多すぎます。少し時間をおいてお試しください。', close: '閉じる', back: '戻る' },
		en: { open: 'FAQ', hint: 'Questions?', title: 'Frequently Asked Questions', placeholder: 'e.g. What time is check-in?', search: 'Search', results: 'Results', categories: 'Browse by category', helpful: 'Did this answer your question?', yes: 'Yes', no: 'No', thanks: 'Thank you for your feedback.', notFound: "We couldn't find an answer.", contactLead: 'Please contact us by phone or via the inquiry form. Your question will help us improve our answers.', call: 'Call', form: 'Inquiry form', error: 'Failed to load. Please try again later.', busy: 'Too many searches. Please wait a moment.', close: 'Close', back: 'Back' },
		'zh-TW': { open: '常見問題', hint: '有任何問題嗎？', title: '常見問題', placeholder: '例如：幾點可以入住？', search: '搜尋', results: '搜尋結果', categories: '依類別瀏覽', helpful: '是否解決了您的問題？', yes: '是', no: '否', thanks: '感謝您的回饋。', notFound: '找不到相關的回答。', contactLead: '請透過電話或諮詢表單與我們聯繫。您的問題將作為日後改善回答的參考。', call: '撥打電話', form: '諮詢表單', error: '載入失敗，請稍後再試。', busy: '搜尋次數過多，請稍候再試。', close: '關閉', back: '返回' }
	};
	var t = T[LOCALE] || T.ja;

	function track(name, params) {
		try {
			if (window.dataLayer) window.dataLayer.push(Object.assign({ event: name, faq_facility: FACILITY }, params || {}));
		} catch (e) {}
	}
	function esc(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}
	function req(path, body) {
		var opt = body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {};
		return fetch(API + FACILITY + path, opt).then(function (r) {
			return r.json().then(function (j) {
				if (!r.ok) {
					var e = new Error(j && j.error ? j.error : 'http_' + r.status);
					e.status = r.status;
					throw e;
				}
				return j;
			});
		});
	}

	var CSS =
		':host{all:initial}*{box-sizing:border-box}' +
		'.w{font-family:"Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,system-ui,sans-serif;color:#222;font-size:14px;line-height:1.7}' +
		'.btn{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:60px;height:60px;border-radius:50%;border:0;background:' + ACCENT + ';color:#fff;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1.2;padding:6px;text-align:center}' +
		'.btn:focus-visible{outline:3px solid #fff;outline-offset:-6px}' +
		'.hint{position:fixed;right:84px;bottom:28px;z-index:2147483000;background:#fff;border:1px solid #ccc;border-radius:4px;padding:6px 26px 6px 12px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.12)}' +
		'.hint button{position:absolute;right:4px;top:4px;border:0;background:none;cursor:pointer;font-size:14px;color:#666}' +
		'.panel{position:fixed;right:16px;bottom:88px;z-index:2147483001;width:min(380px,calc(100vw - 32px));max-height:min(620px,calc(100vh - 110px));background:#fff;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden}' +
		'.inline .panel{position:static;width:100%;max-height:none;box-shadow:none;border:1px solid #ddd}' +
		'.hd{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:' + ACCENT + ';color:#fff;font-weight:bold}' +
		'.hd button{border:0;background:none;color:#fff;font-size:20px;cursor:pointer;line-height:1}' +
		'.sf{display:flex;gap:6px;padding:12px 16px;border-bottom:1px solid #eee}' +
		'.sf input{flex:1;min-width:0;border:1px solid #ccc;border-radius:6px;padding:8px 10px;font-size:16px}' +
		'.sf button{border:0;border-radius:6px;background:' + ACCENT + ';color:#fff;padding:0 14px;cursor:pointer;font-size:14px}' +
		'.bd{overflow:auto;padding:8px 16px 16px}' +
		'.lbl{font-size:12px;color:#777;margin:12px 0 4px}' +
		'details{border-bottom:1px solid #eee}summary{cursor:pointer;padding:10px 0;font-weight:bold;list-style:none}summary::-webkit-details-marker{display:none}summary:before{content:"＋ ";color:#999}details[open]>summary:before{content:"－ "}' +
		'.q{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 0 8px 12px;cursor:pointer;color:#222;font-size:14px;border-top:1px dashed #eee}' +
		'.q:hover{text-decoration:underline}' +
		'.ans{padding:8px 12px;background:#f7f7f5;border-radius:6px;margin:4px 0 10px}.ans p{margin:0 0 6px}.ans a{color:' + ACCENT + '}' +
		'.fb{font-size:13px;color:#555;margin-top:6px}.fb button{margin-left:6px;border:1px solid #bbb;background:#fff;border-radius:4px;padding:2px 10px;cursor:pointer}' +
		'.nf{padding:12px;background:#fafafa;border:1px solid #eee;border-radius:6px;margin-top:8px}' +
		'.cta{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.cta a{flex:1;text-align:center;border:1px solid ' + ACCENT + ';border-radius:6px;padding:8px;color:' + ACCENT + ';text-decoration:none;min-width:120px}' +
		'.msg{color:#a33;font-size:13px;padding:8px 0}' +
		'@media (max-width:480px){.panel{right:8px;left:8px;width:auto;bottom:84px}}';

	function mount(container, inline) {
		var host = document.createElement('div');
		host.setAttribute('data-autumn-faq-host', '');
		container.appendChild(host);
		var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
		root.innerHTML = '<style>' + CSS + '</style><div class="w' + (inline ? ' inline' : '') + '"></div>';
		return root.querySelector('.w');
	}

	var state = { list: null, fallback: null, lastQueryId: null };

	function renderAnswer(box, item, queryId) {
		var div = document.createElement('div');
		div.className = 'ans';
		div.innerHTML = item.answerHtml + '<div class="fb">' + esc(t.helpful) + '<button data-v="1">' + esc(t.yes) + '</button><button data-v="0">' + esc(t.no) + '</button></div>';
		box.appendChild(div);
		var fb = div.querySelector('.fb');
		fb.addEventListener('click', function (ev) {
			var b = ev.target.closest('button');
			if (!b) return;
			var helpful = b.getAttribute('data-v') === '1';
			fb.textContent = t.thanks;
			if (queryId) req('/feedback', { queryId: queryId, helpful: helpful }).catch(function () {});
			track(helpful ? 'faq_helpful' : 'faq_not_helpful', { faq_id: item.id });
			if (!helpful) div.appendChild(fallbackEl());
		});
	}

	function fallbackEl() {
		var f = state.fallback || {};
		var d = document.createElement('div');
		d.className = 'nf';
		d.innerHTML =
			'<div>' + esc(t.contactLead) + '</div><div class="cta">' +
			(f.phone ? '<a href="tel:' + esc(f.phone.replace(/[^0-9+]/g, '')) + '">' + esc(t.call) + '（' + esc(f.phone) + '）</a>' : '') +
			(f.contactUrl ? '<a href="' + esc(f.contactUrl) + '" target="_blank" rel="noopener">' + esc(t.form) + '</a>' : '') +
			'</div>';
		d.addEventListener('click', function (ev) {
			if (ev.target.closest('a')) track('faq_contact_click');
		});
		return d;
	}

	function buildPanel(w, inline, onClose) {
		var panel = document.createElement('div');
		panel.className = 'panel';
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', t.title);
		panel.innerHTML =
			'<div class="hd"><span>' + esc(t.title) + '</span>' + (inline ? '' : '<button type="button" aria-label="' + esc(t.close) + '">×</button>') + '</div>' +
			'<form class="sf"><input type="search" maxlength="200" aria-label="' + esc(t.search) + '" placeholder="' + esc(t.placeholder) + '"><button type="submit">' + esc(t.search) + '</button></form>' +
			'<div class="bd"><div class="res"></div><div class="lbl">' + esc(t.categories) + '</div><div class="cats"></div></div>';
		w.appendChild(panel);
		var input = panel.querySelector('input');
		var res = panel.querySelector('.res');
		var cats = panel.querySelector('.cats');
		if (!inline) panel.querySelector('.hd button').addEventListener('click', onClose);

		// カテゴリ一覧（回答は開いたときに取得）
		function showList() {
			cats.innerHTML = '';
			(state.list || []).forEach(function (c) {
				var d = document.createElement('details');
				d.innerHTML = '<summary>' + esc(c.name) + '</summary>';
				c.items.forEach(function (it) {
					var b = document.createElement('button');
					b.type = 'button';
					b.className = 'q';
					b.textContent = it.question;
					var box = document.createElement('div');
					b.addEventListener('click', function () {
						if (box.firstChild) { box.innerHTML = ''; return; }
						req('/item/' + it.id + '?locale=' + encodeURIComponent(LOCALE))
							.then(function (j) { renderAnswer(box, j, null); track('faq_answer_open', { faq_id: it.id }); })
							.catch(function () { box.innerHTML = '<div class="msg">' + esc(t.error) + '</div>'; });
					});
					d.appendChild(b);
					d.appendChild(box);
				});
				cats.appendChild(d);
			});
		}
		if (state.list) showList();
		else
			req('?locale=' + encodeURIComponent(LOCALE))
				.then(function (j) { state.list = j.categories; state.fallback = j.fallback; showList(); })
				.catch(function () { cats.innerHTML = '<div class="msg">' + esc(t.error) + '</div>'; });

		// 検索
		panel.querySelector('form').addEventListener('submit', function (ev) {
			ev.preventDefault();
			var q = input.value.trim();
			if (!q) return;
			res.innerHTML = '';
			track('faq_search', { faq_query_length: q.length });
			req('/search', { q: q, locale: LOCALE, page: location.pathname })
				.then(function (j) {
					state.fallback = j.fallback || state.fallback;
					state.lastQueryId = j.queryId;
					var lbl = document.createElement('div');
					lbl.className = 'lbl';
					lbl.textContent = t.results;
					res.appendChild(lbl);
					var shown = j.answered ? j.results : [];
					shown.forEach(function (r) {
						var b = document.createElement('button');
						b.type = 'button';
						b.className = 'q';
						b.textContent = r.question;
						var box = document.createElement('div');
						b.addEventListener('click', function () {
							if (box.firstChild) { box.innerHTML = ''; return; }
							renderAnswer(box, r, j.queryId);
							if (j.queryId) req('/feedback', { queryId: j.queryId, faqId: r.id }).catch(function () {});
							track('faq_answer_click', { faq_id: r.id });
						});
						res.appendChild(b);
						res.appendChild(box);
					});
					// 1件目は開いた状態で見せる
					var first = res.querySelector('.q');
					if (first) first.click();
					if (!j.answered) {
						var nf = document.createElement('div');
						nf.innerHTML = '<div class="msg" style="color:#555">' + esc(t.notFound) + '</div>';
						res.appendChild(nf);
						res.appendChild(fallbackEl());
						track('faq_unanswered');
					}
				})
				.catch(function (e) {
					res.innerHTML = '<div class="msg">' + esc(e && e.status === 429 ? t.busy : t.error) + '</div>';
				});
		});
		return { panel: panel, input: input };
	}

	function floating() {
		var w = mount(document.body, false);
		var btn = document.createElement('button');
		btn.className = 'btn';
		btn.type = 'button';
		btn.setAttribute('aria-haspopup', 'dialog');
		btn.setAttribute('aria-expanded', 'false');
		btn.textContent = t.open;
		w.appendChild(btn);

		// 初回だけ吹き出し（閉じたら24時間出さない）
		var hintKey = 'autumnFaqHint:' + FACILITY;
		var hidden = false;
		try { hidden = Date.now() - Number(localStorage.getItem(hintKey) || 0) < 864e5; } catch (e) {}
		var hint = null;
		if (!hidden) {
			hint = document.createElement('div');
			hint.className = 'hint';
			hint.innerHTML = esc(t.hint) + '<button type="button" aria-label="' + esc(t.close) + '">×</button>';
			hint.querySelector('button').addEventListener('click', function () {
				hint.remove();
				try { localStorage.setItem(hintKey, String(Date.now())); } catch (e) {}
			});
			w.appendChild(hint);
		}

		var ui = null;
		function close() {
			if (ui) ui.panel.style.display = 'none';
			btn.setAttribute('aria-expanded', 'false');
			btn.focus();
		}
		btn.addEventListener('click', function () {
			if (hint) { hint.remove(); hint = null; }
			if (ui && ui.panel.style.display !== 'none') return close();
			if (!ui) ui = buildPanel(w, false, close);
			ui.panel.style.display = '';
			btn.setAttribute('aria-expanded', 'true');
			ui.input.focus();
			track('faq_open');
		});
		w.addEventListener('keydown', function (ev) {
			if (ev.key === 'Escape' && ui && ui.panel.style.display !== 'none') close();
		});
	}

	function init() {
		if (!FACILITY) return;
		var inlines = document.querySelectorAll('[data-autumn-faq]');
		for (var i = 0; i < inlines.length; i++) {
			if (inlines[i].getAttribute('data-autumn-faq') === FACILITY) buildPanel(mount(inlines[i], true), true, null);
		}
		if (script.getAttribute('data-floating') !== 'false') floating();
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
})();
