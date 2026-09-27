import type { RequestEvent } from '@sveltejs/kit';
import { assignExperiment, canonicalPublicPath, experiments, matchesExperimentPath, type ExperimentAssignment } from '$lib/experiments';

const VISITOR_COOKIE = 'ab_visitor';

export function experimentsForRequest(event: RequestEvent): ExperimentAssignment[] {
	const path = canonicalPublicPath(event.url.pathname);
	if (/^\/(admin|r|p|api)(\/|$)/.test(path)) return [];
	const matching = experiments.filter((experiment) => matchesExperimentPath(experiment.path, path));
	const previewAllowed = import.meta.env.DEV || event.locals.user?.role === 'admin';
	const preview = previewAllowed ? event.url.searchParams.get('ab_preview') : null;
	const [previewId, previewVariant] = preview?.split(':') ?? [];
	const eligible = matching.filter((experiment) => experiment.enabled || experiment.id === previewId);
	if (!eligible.length) return [];

	let visitorId = event.cookies.get(VISITOR_COOKIE);
	if (!visitorId || !/^[0-9a-f-]{36}$/i.test(visitorId)) {
		visitorId = crypto.randomUUID();
		event.cookies.set(VISITOR_COOKIE, visitorId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: event.url.protocol === 'https:',
			maxAge: 60 * 60 * 24 * 365
		});
	}

	return eligible.flatMap((experiment) => {
		const forced = experiment.id === previewId && experiment.variants.some((variant) => variant.key === previewVariant);
		const variant = forced ? previewVariant : assignExperiment(experiment, visitorId);
		return variant ? [{ id: experiment.id, revision: experiment.revision, variant, preview: forced }] : [];
	});
}
