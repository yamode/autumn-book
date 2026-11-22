// 施設ナレッジ（docs/facility-knowledge.md 段階2）。取材の回答・プレスリリース・お問い合わせ回答で AI が使う
// 「確かめ済みの施設情報」を登録・承認する画面。本番データ（Supabase）でだけ動く。
// 権限は DB が決める（入力＝施設権限のあるスタッフ、承認＝施設の管理者と登録された広報担当、承認者の登録＝施設の管理者）。
// 画面側の判定はボタンの出し分けのためだけ。
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { createSupabaseServerClient, ADMIN_SUPABASE } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { listAdminUsers } from '$lib/server/admin-users';
import {
	KnowledgeError,
	addApprover,
	addFact,
	addStory,
	importSeed,
	listApprovers,
	listFacts,
	listStories,
	parseFactForm,
	parseStoryForm,
	removeApprover,
	removeItem,
	updateFact,
	updateStory,
	verifyItem,
	type KnowledgeApprover,
	type KnowledgeFact,
	type KnowledgeSeed,
	type KnowledgeStory
} from '$lib/server/facility-knowledge';
import nishiwagaJalan2611 from '$lib/server/facility-knowledge/seeds/nishiwaga-jalan-2611.json';

/** 施設ごとの初期データ（取材の回答など）。取り込みは未承認で入る */
const SEEDS: Record<string, KnowledgeSeed[]> = {
	[FACILITY_UUID['f-nishiwaga']]: [nishiwagaJalan2611 as KnowledgeSeed]
};

type StaffOption = { id: string; name: string };

export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	const { currentFacility } = await event.parent();
	const user = event.locals.user;
	const empty = {
		facts: [] as KnowledgeFact[],
		stories: [] as KnowledgeStory[],
		approvers: [] as (KnowledgeApprover & { name: string })[],
		names: {} as Record<string, string>,
		staffOptions: [] as StaffOption[],
		seeds: [] as { index: number; label: string; count: number }[],
		isAdmin: user?.role === 'admin',
		canApprove: false,
		unavailable: null as string | null,
		loadError: null as string | null
	};
	if (!ADMIN_SUPABASE) return { ...empty, unavailable: '施設ナレッジは本番データ環境で利用できます。' };
	const facilityId = FACILITY_UUID[currentFacility.id];
	if (!facilityId || !user) return { ...empty, unavailable: 'この施設では利用できません。' };

	const client = createSupabaseServerClient(event);
	// スタッフの名前（承認した人・承認者の表示用）。読めなくても画面は出す
	const usersLoad = listAdminUsers().catch(() => null);
	try {
		const [facts, stories, approvers, users] = await Promise.all([
			listFacts(client, facilityId),
			listStories(client, facilityId),
			listApprovers(client, facilityId),
			usersLoad
		]);
		const names: Record<string, string> = {};
		for (const u of users ?? []) names[u.id] = u.name || u.email;
		const approverIds = new Set(approvers.map((a) => a.userId));
		const staffOptions = (users ?? [])
			.filter((u) => u.bookRole === 'staff' && !u.banned && !approverIds.has(u.id))
			.map((u) => ({ id: u.id, name: u.name || u.email }))
			.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
		const items = [...facts, ...stories];
		const seedItems = SEEDS[facilityId] ?? [];
		return {
			...empty,
			facts,
			stories,
			approvers: approvers.map((a) => ({ ...a, name: names[a.userId] ?? '（名前を読めません）' })),
			// 一覧に出す名前は、承認した人と承認者だけに絞る（メールアドレスは渡さない）
			names: Object.fromEntries(
				[...new Set([...items.map((i) => i.verifiedBy), ...approvers.map((a) => a.userId)].filter((v): v is string => !!v))]
					.map((id) => [id, names[id] ?? '—'])
			),
			staffOptions: user.role === 'admin' ? staffOptions : [],
			seeds: seedItems.map((s, index) => ({ index, label: s.label, count: s.facts.length + s.stories.length })),
			canApprove: user.role === 'admin' || approverIds.has(user.id)
		};
	} catch (e) {
		return { ...empty, loadError: e instanceof KnowledgeError ? e.message : '施設ナレッジを読み込めませんでした。時間をおいて再読み込みしてください。' };
	}
};

/** actions の共通処理: 本番データ・ログイン・施設を確かめ、KnowledgeError を画面のメッセージにする */
async function run<T>(event: RequestEvent, fn: (ctx: { client: ReturnType<typeof createSupabaseServerClient>; facilityId: string; userId: string; form: FormData }) => Promise<T>) {
	if (!ADMIN_SUPABASE) return fail(400, { message: '本番データ環境でだけ使えます。' });
	const user = event.locals.user;
	if (user?.role !== 'admin' && user?.role !== 'staff') return fail(403, { message: '編集権限がありません。' });
	const form = await event.request.formData();
	const facilityId = FACILITY_UUID[String(form.get('facilityId') ?? '')];
	if (!facilityId) return fail(400, { message: '施設が正しくありません。' });
	try {
		return await fn({ client: createSupabaseServerClient(event), facilityId, userId: user.id, form });
	} catch (e) {
		if (e instanceof KnowledgeError) return fail(e.status, { message: e.message });
		return fail(500, { message: '処理できませんでした。時間をおいてもう一度お試しください。' });
	}
}

const kindOf = (form: FormData) => (String(form.get('kind')) === 'story' ? 'story' : 'fact') as 'fact' | 'story';
const idOf = (form: FormData) => String(form.get('id') ?? '');

export const actions: Actions = {
	addFact: (event) => run(event, async ({ client, facilityId, userId, form }) => {
		await addFact(client, facilityId, userId, parseFactForm(form));
		return { done: '事実を登録しました。承認すると AI が使えるようになります。' };
	}),
	saveFact: (event) => run(event, async ({ client, facilityId, userId, form }) => {
		await updateFact(client, facilityId, userId, idOf(form), parseFactForm(form));
		return { done: '保存しました。内容を変えた場合は承認が外れています。' };
	}),
	addStory: (event) => run(event, async ({ client, facilityId, userId, form }) => {
		await addStory(client, facilityId, userId, parseStoryForm(form));
		return { done: '説明を登録しました。承認すると AI が使えるようになります。' };
	}),
	saveStory: (event) => run(event, async ({ client, facilityId, userId, form }) => {
		await updateStory(client, facilityId, userId, idOf(form), parseStoryForm(form));
		return { done: '保存しました。内容を変えた場合は承認が外れています。' };
	}),
	verify: (event) => run(event, async ({ client, form }) => {
		await verifyItem(client, kindOf(form), idOf(form), true);
		return { done: '承認しました。' };
	}),
	unverify: (event) => run(event, async ({ client, form }) => {
		await verifyItem(client, kindOf(form), idOf(form), false);
		return { done: '承認を外しました。AI はこの情報を使いません。' };
	}),
	remove: (event) => run(event, async ({ client, facilityId, form }) => {
		await removeItem(client, facilityId, kindOf(form), idOf(form));
		return { done: '削除しました。' };
	}),
	addApprover: (event) => run(event, async ({ client, facilityId, userId, form }) => {
		await addApprover(client, facilityId, userId, String(form.get('userId') ?? ''), String(form.get('note') ?? '').trim());
		return { done: '承認できる人に登録しました。' };
	}),
	removeApprover: (event) => run(event, async ({ client, facilityId, form }) => {
		await removeApprover(client, facilityId, String(form.get('userId') ?? ''));
		return { done: '承認できる人から外しました。' };
	}),
	importSeed: (event) => run(event, async ({ client, facilityId, userId, form }) => {
		const seed = (SEEDS[facilityId] ?? [])[Number(form.get('index'))];
		if (!seed) throw new KnowledgeError('取り込む初期データが見つかりません。', 404);
		const r = await importSeed(client, facilityId, userId, seed);
		return { done: `取り込みました（${r.added}件を未承認で登録・すでにある${r.skipped}件は飛ばしました）。内容を確かめて承認してください。` };
	})
};
