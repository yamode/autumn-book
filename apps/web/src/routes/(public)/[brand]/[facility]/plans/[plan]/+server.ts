import { previewPrivateBookRates } from '$lib/server/private-book';
import { _loadPlanRates } from './+page.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => previewPrivateBookRates(event, async (state) => {
  const { plan, rooms, pickedRoom, privateBook, privateBookPartnerId, pbReferenceSpecial } = await _loadPlanRates(event, state);
  return { plan, rooms, pickedRoom, privateBook, privateBookPartnerId, pbReferenceSpecial };
});
