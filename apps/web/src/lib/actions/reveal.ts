// スクロールリビール（IntersectionObserver）。prefers-reduced-motion を尊重
export function reveal(node: HTMLElement, options: { delay?: number } = {}) {
	if (typeof window === 'undefined') return;
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

	node.classList.add('reveal');
	if (options.delay) node.style.transitionDelay = `${options.delay}ms`;

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					node.classList.add('is-visible');
					observer.unobserve(node);
				}
			}
		},
		{ threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
	);
	observer.observe(node);

	return {
		destroy() {
			observer.disconnect();
		}
	};
}
