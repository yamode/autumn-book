import { describe, expect, it } from 'vitest';
import { assignExperiment, bucket, canonicalPublicPath, matchesExperimentPath, type Experiment } from './experiments';

const experiment: Experiment = {
	id: 'test-heading',
	revision: 1,
	path: '/:brand/:facility/plans',
	enabled: true,
	trafficPercent: 100,
	variants: [{ key: 'a', weight: 50 }, { key: 'b', weight: 50 }]
};

describe('page experiments', () => {
	it('matches localized dynamic routes without matching child pages', () => {
		expect(canonicalPublicPath('/en/yamado/nishiwaga/plans')).toBe('/yamado/nishiwaga/plans');
		expect(matchesExperimentPath(experiment.path, '/zh-TW/yamado/oga/plans')).toBe(true);
		expect(matchesExperimentPath(experiment.path, '/yamado/oga/plans/standard')).toBe(false);
	});

	it('keeps a visitor in the same variant and honors traffic controls', () => {
		const visitor = '2b445f59-cce2-49ee-ad23-1bd8c341a811';
		const variant = assignExperiment(experiment, visitor);
		expect(['a', 'b']).toContain(variant);
		expect(assignExperiment(experiment, visitor)).toBe(variant);
		expect(assignExperiment({ ...experiment, trafficPercent: 0 }, visitor)).toBeNull();
		expect(assignExperiment({ ...experiment, enabled: false }, visitor)).toBeNull();
		expect(bucket(`${visitor}:test-heading:1:variant`)).toBeGreaterThanOrEqual(0);
		expect(bucket(`${visitor}:test-heading:1:variant`)).toBeLessThan(1);
	});
});
