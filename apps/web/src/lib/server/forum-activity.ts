import type { RequestEvent } from '@sveltejs/kit';
import { createSupabaseServerClient } from './auth';
import { DATA_SOURCE } from './supabase';
import { deleteForumPost, forumBoards, forumPosts, forumThreads, getForumProfile, memberById } from './store';

export const REPORT_REASONS = ['spam', 'abuse', 'privacy', 'other'] as const;
export type ForumReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_PAGE_SIZE = 25;

export interface ForumReplyNotice {
	id: string;
	created_at: string;
	read_at: string | null;
	title: string;
	post_no: number;
	thread_id: string;
	nickname: string | null;
}

interface ReplyTarget { thread_id: string; post_no: number }

export interface ForumReport {
	id: string;
	created_at: string;
	reason: ForumReportReason;
	note: string;
	resolved_at: string | null;
	resolution: 'reviewed' | 'hidden' | null;
	post_no: number;
	hidden: boolean;
	thread_id: string;
	title: string;
	excerpt: string;
}

type DemoNotice = Pick<ForumReplyNotice, 'id' | 'created_at' | 'read_at'> & { recipient: string; postId: string };
type DemoReport = Pick<ForumReport, 'id' | 'created_at' | 'reason' | 'note' | 'resolved_at' | 'resolution'> & { reporter: string; postId: string };
const demoNotices: DemoNotice[] = [];
const demoReports: DemoReport[] = [];

function demoUser(event: RequestEvent, role: 'member' | 'staff') {
	const user = event.locals.user;
	if (!user || (role === 'member' ? user.role !== 'member' : user.role !== 'staff' && user.role !== 'admin')) {
		throw new Error('forbidden');
	}
	return user.id;
}

export async function forumRpc<T>(event: RequestEvent, name: string, args?: Record<string, unknown>): Promise<T> {
	const { data, error } = await createSupabaseServerClient(event).schema('book').rpc(name, args);
	if (error) throw new Error(error.message);
	return data as T;
}

export function listRecentDemoThreads(limit = 10) {
	const latest = new Map<string, string>();
	for (const post of forumPosts) {
		if (post.isDeleted) continue;
		const date = latest.get(post.threadId);
		if (!date || post.createdAt > date) latest.set(post.threadId, post.createdAt);
	}
	return forumThreads.flatMap(thread => {
		const lastPostedAt = latest.get(thread.id);
		const board = forumBoards.find(b => b.id === thread.boardId);
		if (thread.isDeleted || !lastPostedAt || !board) return [];
		const profile = getForumProfile(thread.authorUserId);
		return [{
			...thread,
			lastPostedAt,
			boardSlug: board.slug,
			boardTitle: board.title,
			authorNickname: profile?.nickname ?? '',
			authorIsStaff: profile?.role === 'staff' || profile?.role === 'admin'
		}];
	}).sort((a, b) => b.lastPostedAt.localeCompare(a.lastPostedAt) || b.id.localeCompare(a.id)).slice(0, limit)
		.map(({ id, title, isPinned, isLocked, replyCount, lastPostedAt, createdAt, boardSlug, boardTitle, authorNickname, authorIsStaff }) =>
			({ id, title, isPinned, isLocked, replyCount, lastPostedAt, createdAt, boardSlug, boardTitle, authorNickname, authorIsStaff }));
}

export function notifyDemoForumReply(postId: string) {
	const post = forumPosts.find(p => p.id === postId);
	if (!post || post.postNo <= 1) return;
	const thread = forumThreads.find(t => t.id === post.threadId && !t.isDeleted);
	if (!thread) return;
	const quoteNo = Number(post.body.match(/^>>([0-9]{1,4})(?:\s|$)/)?.[1]);
	const quoted = forumPosts.find(p => p.threadId === thread.id && !p.isDeleted && p.postNo === quoteNo && p.postNo < post.postNo);
	for (const recipient of new Set([thread.authorUserId, quoted?.authorUserId])) {
		if (!recipient || recipient === post.authorUserId || !memberById(recipient)) continue;
		demoNotices.push({ id: crypto.randomUUID(), recipient, postId, created_at: post.createdAt, read_at: null });
	}
}

function demoNoticeRow(n: DemoNotice): ForumReplyNotice | null {
	const post = forumPosts.find(p => p.id === n.postId && !p.isDeleted);
	const thread = post && forumThreads.find(t => t.id === post.threadId && !t.isDeleted);
	if (!post || !thread) return null;
	return {
		id: n.id, created_at: n.created_at, read_at: n.read_at, title: thread.title, post_no: post.postNo,
		thread_id: thread.id, nickname: getForumProfile(post.authorUserId)?.nickname ?? null
	};
}

export async function readForumInbox(event: RequestEvent): Promise<ForumReplyNotice[]> {
	if (DATA_SOURCE === 'supabase') return forumRpc(event, 'forum_my_reply_notifications');
	const user = demoUser(event, 'member');
	return demoNotices.filter(n => n.recipient === user).map(demoNoticeRow).filter((n): n is ForumReplyNotice => !!n)
		.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 40);
}

export async function forumUnreadCount(event: RequestEvent): Promise<number> {
	if (DATA_SOURCE === 'supabase') return forumRpc(event, 'forum_my_unread_reply_count');
	const user = demoUser(event, 'member');
	return demoNotices.filter(n => n.recipient === user && !n.read_at && demoNoticeRow(n)).length;
}

export async function readForumNotice(event: RequestEvent, id: string | null, through: string | null): Promise<ReplyTarget | null> {
	if (DATA_SOURCE === 'supabase') return forumRpc(event, 'forum_read_reply', { p_id: id, p_through: through });
	const user = demoUser(event, 'member');
	const now = new Date().toISOString();
	if (id) {
		const item = demoNotices.find(n => n.id === id && n.recipient === user);
		if (!item) return null;
		item.read_at ??= now;
		const row = demoNoticeRow(item);
		return row ? { thread_id: row.thread_id, post_no: row.post_no } : null;
	}
	if (through) for (const n of demoNotices) if (n.recipient === user && Date.parse(n.created_at) <= Math.min(Date.parse(through), Date.now())) n.read_at ??= now;
	return null;
}

export async function reportForumPost(event: RequestEvent, thread: string, postId: string, reason: ForumReportReason, note: string): Promise<void> {
	if (DATA_SOURCE === 'supabase') {
		return forumRpc(event, 'forum_report_post', { p_thread_id: thread, p_post_id: postId, p_reason: reason, p_note: note });
	}
	const reporter = demoUser(event, 'member');
	if (getForumProfile(reporter)?.isBanned) throw new Error('forbidden');
	if (demoReports.some(r => r.reporter === reporter && r.postId === postId)) return;
	const post = forumPosts.find(p => p.id === postId && p.threadId === thread && !p.isDeleted);
	if (!post || post.authorUserId === reporter || !forumThreads.some(t => t.id === thread && !t.isDeleted)) throw new Error('not_found');
	if (demoReports.filter(r => r.reporter === reporter && Date.parse(r.created_at) > Date.now() - 3_600_000).length >= 5) throw new Error('rate_limited');
	demoReports.push({ id: crypto.randomUUID(), postId, reporter, reason, note, created_at: new Date().toISOString(), resolved_at: null, resolution: null });
}

export async function readStaffReports(event: RequestEvent, resolved: boolean, page: number): Promise<{ total: number; reports: ForumReport[] }> {
	if (DATA_SOURCE === 'supabase') return forumRpc(event, 'forum_staff_reports', { p_resolved: resolved, p_page: page });
	demoUser(event, 'staff');
	const all = demoReports.flatMap(r => {
		const post = forumPosts.find(p => p.id === r.postId);
		const thread = post && forumThreads.find(t => t.id === post.threadId);
		if (!post || !thread || Boolean(r.resolved_at) !== resolved) return [];
		const { id, created_at, reason, note, resolved_at, resolution } = r;
		return [{ id, created_at, reason, note, resolved_at, resolution, post_no: post.postNo,
			hidden: post.isDeleted || thread.isDeleted, title: thread.title, thread_id: thread.id, excerpt: post.body.slice(0, 600) }];
	}).sort((a, b) => (b.resolved_at ?? b.created_at).localeCompare(a.resolved_at ?? a.created_at));
	return { total: all.length, reports: all.slice((page - 1) * REPORT_PAGE_SIZE, page * REPORT_PAGE_SIZE) };
}

export async function resolveStaffReport(event: RequestEvent, id: string, resolution: 'reviewed' | 'hidden'): Promise<void> {
	if (DATA_SOURCE === 'supabase') return forumRpc(event, 'forum_staff_resolve_report', { p_id: id, p_resolution: resolution });
	const staff = demoUser(event, 'staff');
	const report = demoReports.find(r => r.id === id);
	if (!report) throw new Error('not_found');
	if (report.resolved_at) return;
	if (resolution === 'hidden') {
		const post = forumPosts.find(p => p.id === report.postId);
		if (post && !post.isDeleted) {
			deleteForumPost(post.id, staff, true);
			if (post.postNo === 1) {
				const thread = forumThreads.find(t => t.id === post.threadId);
				if (thread) thread.isDeleted = true;
			}
		}
	}
	const now = new Date().toISOString();
	for (const r of demoReports) {
		if (!r.resolved_at && (r.id === id || (resolution === 'hidden' && r.postId === report.postId))) {
			r.resolved_at = now;
			r.resolution = resolution;
		}
	}
}
