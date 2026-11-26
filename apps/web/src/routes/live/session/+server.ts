// Autumn Live の入場の口。デスクトップアプリ（autumn-pms/desktop）のメインプロセスだけが呼ぶ。設計: docs/autumn-live.md §4.1
// 中身は lib/server/live-session.ts（署名・本人・端末の状態を確かめて、入場券 ab_live を発行する）
import { handleLiveSession } from '$lib/server/live-session';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => handleLiveSession(event);
