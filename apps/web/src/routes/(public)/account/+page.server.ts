import type { PageServerLoad } from './$types';
import { loadAccountOverview } from './overview.server';

export const load: PageServerLoad = loadAccountOverview;
