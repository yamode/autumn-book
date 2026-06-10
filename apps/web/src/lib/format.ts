export { formatYen, addDays } from '@autumn-book/core';

export function formatDateJa(date: string): string {
	const d = new Date(date + 'T00:00:00');
	const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
	return `${d.getMonth() + 1}/${d.getDate()}(${dow})`;
}

export function formatDateLongJa(date: string): string {
	const d = new Date(date + 'T00:00:00');
	const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
	return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${dow}）`;
}

export function todayStr(): string {
	return new Date().toISOString().slice(0, 10);
}
