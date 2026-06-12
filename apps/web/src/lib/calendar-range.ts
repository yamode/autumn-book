export const CALENDAR_MIN_MONTH_OFFSET = -1;
export const CALENDAR_MAX_MONTH_OFFSET = 18;

export interface CalendarMonthRange {
	yearMonth: string;
	minMonth: string;
	maxMonth: string;
	canGoPrev: boolean;
	canGoNext: boolean;
}

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function toMonthIndex(yearMonth: string): number | null {
	if (!YEAR_MONTH_PATTERN.test(yearMonth)) return null;
	const [year, month] = yearMonth.split('-').map(Number);
	return year * 12 + month - 1;
}

function fromMonthIndex(monthIndex: number): string {
	const year = Math.floor(monthIndex / 12);
	const month = monthIndex % 12;
	return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function currentMonthIndex(now = new Date()): number {
	return now.getFullYear() * 12 + now.getMonth();
}

export function shiftYearMonth(yearMonth: string, delta: number): string {
	const monthIndex = toMonthIndex(yearMonth);
	return fromMonthIndex((monthIndex ?? currentMonthIndex()) + delta);
}

export function clampCalendarMonth(input: string | null | undefined, now = new Date()): CalendarMonthRange {
	const current = currentMonthIndex(now);
	const minIndex = current + CALENDAR_MIN_MONTH_OFFSET;
	const maxIndex = current + CALENDAR_MAX_MONTH_OFFSET;
	const requestedIndex = toMonthIndex(input ?? '');
	const selectedIndex =
		requestedIndex !== null && requestedIndex >= minIndex && requestedIndex <= maxIndex ? requestedIndex : current;

	return {
		yearMonth: fromMonthIndex(selectedIndex),
		minMonth: fromMonthIndex(minIndex),
		maxMonth: fromMonthIndex(maxIndex),
		canGoPrev: selectedIndex > minIndex,
		canGoNext: selectedIndex < maxIndex
	};
}
