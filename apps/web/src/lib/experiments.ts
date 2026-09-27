/** Public page experiments. Register a route pattern here, then render its variant in that page. */
export type Experiment = {
	id: string;
	revision: number;
	path: string;
	enabled: boolean;
	trafficPercent: number;
	variants: readonly { key: string; weight: number }[];
};

export type ExperimentAssignment = {
	id: string;
	revision: number;
	variant: string;
	preview: boolean;
};

export const experiments: readonly Experiment[] = [
	// Prepared example. A test only starts when enabled=true; preview is available to admins.
	{
		id: 'facility-plans-heading',
		revision: 1,
		path: '/:brand/:facility/plans',
		enabled: false,
		trafficPercent: 100,
		variants: [{ key: 'a', weight: 50 }, { key: 'b', weight: 50 }]
	}
];

export function canonicalPublicPath(pathname: string): string {
	return pathname.replace(/^\/(en|zh-TW)(?=\/|$)/, '') || '/';
}

export function matchesExperimentPath(pattern: string, pathname: string): boolean {
	const path = canonicalPublicPath(pathname);
	const expected = pattern.split('/').filter(Boolean);
	const actual = path.split('/').filter(Boolean);
	if (expected.length !== actual.length) return false;
	return expected.every((segment, index) => segment.startsWith(':') || segment === actual[index]);
}

/** FNV-1a gives a stable, independent bucket per visitor, experiment and revision. */
export function bucket(key: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0) / 0x1_0000_0000;
}

export function assignExperiment(experiment: Experiment, visitorId: string): string | null {
	if (!experiment.enabled || experiment.trafficPercent <= 0) return null;
	if (bucket(`${visitorId}:${experiment.id}:${experiment.revision}:traffic`) >= experiment.trafficPercent / 100) return null;
	const totalWeight = experiment.variants.reduce((sum, variant) => sum + Math.max(0, variant.weight), 0);
	if (!totalWeight) return null;
	const position = bucket(`${visitorId}:${experiment.id}:${experiment.revision}:variant`) * totalWeight;
	let cumulative = 0;
	for (const variant of experiment.variants) {
		cumulative += Math.max(0, variant.weight);
		if (position < cumulative) return variant.key;
	}
	return experiment.variants.at(-1)?.key ?? null;
}

export function experimentVariant(assignments: readonly ExperimentAssignment[] | undefined, id: string): string {
	return assignments?.find((assignment) => assignment.id === id)?.variant ?? 'a';
}
