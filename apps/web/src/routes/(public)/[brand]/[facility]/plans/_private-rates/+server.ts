import { previewPrivateBookRates } from '$lib/server/private-book';
import { _loadPlanRates } from '../+page.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => previewPrivateBookRates(event, async (state) => {
  const { rooms, combos, specialCombos, privateBook, privateBookPartnerId } = await _loadPlanRates(event, state);
  return { rooms, combos, specialCombos, privateBook, privateBookPartnerId };
});
