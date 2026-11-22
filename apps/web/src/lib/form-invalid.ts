// 入力漏れの案内（2026-11-22）。
// ブラウザ標準の吹き出しは、上の固定ヘッダーの裏に隠れた欄を指して「リスト内の項目を選択してください」とだけ出し、
// どの項目か分からなかった。送信が入力漏れで止まったときに、
//   1. 最初の欄を画面の中央へスクロールしてフォーカスする
//   2. 漏れている欄を赤枠にし、その下に「『項目名』を選んでください」を出す
// を行う。直すと（入力・選択すると）その欄の案内は消える。
// 使い方: <form use:invalidGuide> （required などブラウザ標準の検証はそのまま使う）
import * as m from '$lib/paraglide/messages';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const MSG_CLASS = 'form-invalid-msg';

/** 欄の見出し（label の最初の文字・fieldset の legend・aria-label）。「必須」などの印は除く */
const MARK_RE = /^(必須|任意|Required|Optional|必填|選填)$/i;

/** 印（必須・任意）・入力欄・案内文を除いた文字 */
function cleanText(node: Element): string {
	const c = node.cloneNode(true) as HTMLElement;
	c.querySelectorAll(`input, select, textarea, option, em, .bk-req, .${MSG_CLASS}`).forEach((n) => n.remove());
	c.querySelectorAll('span, small, b, strong').forEach((n) => {
		if (MARK_RE.test((n.textContent ?? '').trim())) n.remove();
	});
	return (c.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function fieldLabel(el: Field, box: Element): string {
	// fieldset は legend、label は見出しの span（「必須」の印だけの span は飛ばす）→ 無ければ label の地の文
	const legend = box.tagName === 'FIELDSET' ? box.querySelector('legend') : null;
	if (legend) {
		const t = cleanText(legend);
		if (t) return t;
	}
	for (const span of box.querySelectorAll(':scope > span')) {
		const t = cleanText(span);
		if (t) return t;
	}
	const t = box.tagName === 'LABEL' ? cleanText(box) : '';
	return t || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
}

/** 案内を出す囲み（ラジオは fieldset、他は label か親要素） */
function boxOf(el: Field): HTMLElement {
	if (el instanceof HTMLInputElement && el.type === 'radio') return (el.closest('fieldset') as HTMLElement) ?? el.parentElement!;
	return (el.closest('label') as HTMLElement) ?? el.parentElement!;
}

function messageFor(el: Field, label: string): string {
	const isChoice = el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === 'radio');
	const isCheck = el instanceof HTMLInputElement && el.type === 'checkbox';
	if (!label) return el.validationMessage;
	if (isCheck) return m.form_invalid_check({ label });
	if (isChoice) return m.form_invalid_select({ label });
	if (el.validity.valueMissing) return m.form_invalid_input({ label });
	return m.form_invalid_fix({ label });
}

function clear(box: HTMLElement) {
	box.removeAttribute('data-invalid');
	box.querySelector(`:scope > .${MSG_CLASS}`)?.remove();
	box.querySelectorAll('[aria-invalid="true"][data-guide]').forEach((n) => {
		n.removeAttribute('aria-invalid');
		n.removeAttribute('data-guide');
	});
}

export function invalidGuide(form: HTMLFormElement) {
	let first: Field | null = null;
	let frame = 0;

	const onInvalid = (e: Event) => {
		const el = e.target as Field;
		e.preventDefault(); // 標準の吹き出しは出さない
		const box = boxOf(el);
		if (!box.hasAttribute('data-invalid')) {
			box.setAttribute('data-invalid', '');
			const p = document.createElement('p');
			p.className = MSG_CLASS;
			p.setAttribute('role', 'alert');
			p.textContent = messageFor(el, fieldLabel(el, box));
			box.appendChild(p);
		}
		if (!el.hasAttribute('aria-invalid')) {
			el.setAttribute('aria-invalid', 'true');
			el.setAttribute('data-guide', '');
		}
		if (!first) first = el;
		// 1回の送信で invalid はまとめて飛んでくるので、最後に最初の欄へ移る
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			const target = first;
			first = null;
			if (!target) return;
			const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			boxOf(target).scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
			target.focus({ preventScroll: true });
		});
	};

	const onFix = (e: Event) => {
		const el = e.target as Field;
		if (!el || !('validity' in el)) return;
		const box = boxOf(el);
		if (box.hasAttribute('data-invalid') && el.validity.valid) clear(box);
	};

	form.addEventListener('invalid', onInvalid, true);
	form.addEventListener('input', onFix);
	form.addEventListener('change', onFix);
	return {
		destroy() {
			cancelAnimationFrame(frame);
			form.removeEventListener('invalid', onInvalid, true);
			form.removeEventListener('input', onFix);
			form.removeEventListener('change', onFix);
		}
	};
}
