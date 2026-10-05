import { redirect } from '@sveltejs/kit';

// 「お部屋とプラン」は料金カレンダー（/p/[token]/calendar）に一本化した（2026-10-06）。旧URL・ブックマークは条件ごと転送する。
export const load = ({ params, url }) => {
  throw redirect(301, `/p/${params.token}/calendar${url.search}`);
};
