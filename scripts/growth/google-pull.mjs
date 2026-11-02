// 集客ループ（growth loop）用：GA4・Search Console・GTM のデータを読み取り専用で取ってきて JSON にまとめる。
// 依存パッケージなし（Node 20+ の fetch と crypto だけ）。クラウドルーティンからそのまま走らせる前提。
//
// 実行: GOOGLE_SA_KEY_B64=<サービスアカウント鍵JSONをbase64にしたもの> node scripts/growth/google-pull.mjs [--days 56] [--out growth.json]
//   ローカルでは GOOGLE_SA_KEY_FILE=<鍵JSONのパス> でもよい（96_Claude/secrets/google-growth-sa.json）
//
// 取るもの（すべて日別。前週比・前年比は呼び出し側＝ループの AI が計算する）
//   - GA4（book / 西和賀HP / 男鹿HP の3プロパティ）: セッション・ユーザー・チャネル/参照元・ランディングページ・端末・
//     book は予約ファネル（search → view_item → begin_checkout → purchase）と utm_source 別
//   - Search Console（3サイト）: 検索クエリ・ページ別の表示回数・クリック・掲載順位
//   - GTM（西和賀・男鹿のコンテナ）: 公開中のバージョンと、未公開のまま残っている変更
// 書き込み系の API は一切呼ばない（スコープも readonly のみ）。

import { createSign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const DEBUG = true;
const dbg = (...a) => DEBUG && console.error('[DBG]', ...a);

// 計測の対象。プロパティ ID は測定 ID から自動で引く（book=556111214・西和賀=558375809・男鹿=416414119）
// Search Console は西和賀・男鹿ともドメインプロパティ。sc-domain:yamado.co.jp は oga・corporate も含むので gscPage で www に絞る
// book（yamado.app）は Search Console 未登録（2026-11-02 時点）。登録したら gsc を足す
const SITES = [
	{ key: 'book', label: 'autumn-book（book.yamado.app）', measurementId: 'G-JFW5QS8QKH', funnel: true },
	{ key: 'hp_yamado', label: '西和賀HP（www.yamado.co.jp）', measurementId: 'G-RN88NPRMNX', gsc: 'sc-domain:yamado.co.jp', gscPage: 'https://www.yamado.co.jp/', gtm: { account: '6272932827', container: '266787355' } },
	{ key: 'hp_oga', label: '男鹿HP（oga.yamado.co.jp）', measurementId: 'G-30DJVL8YLG', gsc: 'sc-domain:oga.yamado.co.jp', gtm: { account: '6272932827', container: '208438396' } }
];
const FUNNEL_EVENTS = ['search', 'view_item', 'begin_checkout', 'purchase'];
const SCOPES = [
	'https://www.googleapis.com/auth/analytics.readonly',
	'https://www.googleapis.com/auth/webmasters.readonly',
	'https://www.googleapis.com/auth/tagmanager.readonly'
];

const args = process.argv.slice(2);
const argVal = (name, def) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : def;
};
const DAYS = Number(argVal('--days', '56'));
const OUT = argVal('--out', null);

function loadKey() {
	if (process.env.GOOGLE_SA_KEY_B64) return JSON.parse(Buffer.from(process.env.GOOGLE_SA_KEY_B64, 'base64').toString('utf8'));
	if (process.env.GOOGLE_SA_KEY_FILE) return JSON.parse(readFileSync(process.env.GOOGLE_SA_KEY_FILE, 'utf8'));
	throw new Error('GOOGLE_SA_KEY_B64 か GOOGLE_SA_KEY_FILE が必要です');
}

// サービスアカウントの JWT を自前で署名してアクセストークンに換える
async function getToken(key) {
	const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
	const now = Math.floor(Date.now() / 1000);
	const unsigned = `${b64u({ alg: 'RS256', typ: 'JWT' })}.${b64u({ iss: key.client_email, scope: SCOPES.join(' '), aud: key.token_uri, iat: now, exp: now + 3600 })}`;
	const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
	const res = await fetch(key.token_uri, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` })
	});
	if (!res.ok) throw new Error(`トークン取得に失敗: ${res.status} ${await res.text()}`);
	return (await res.json()).access_token;
}

function api(token) {
	return async (url, body) => {
		const res = await fetch(url, {
			method: body ? 'POST' : 'GET',
			headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
			body: body ? JSON.stringify(body) : undefined
		});
		const text = await res.text();
		if (!res.ok) throw new Error(`${res.status} ${url} ${text.slice(0, 300)}`);
		return JSON.parse(text);
	};
}

const ymd = (d) => d.toISOString().slice(0, 10);
// JST の日付（GA4 の3プロパティ・Search Console の日付はすべて JST で扱う）
const jstYmd = (ms) => ymd(new Date(ms + 9 * 3600e3));
const range = () => {
	const end = Date.now() - 864e5; // JST の前日まで（当日分は未確定）
	const start = end - (DAYS - 1) * 864e5;
	return { startDate: jstYmd(start), endDate: jstYmd(end) };
};
// 前年同期（同じ曜日に揃えるため 364 日前）
const rangeLastYear = () => {
	const r = range();
	const shift = (s) => ymd(new Date(new Date(s).getTime() - 364 * 864e5));
	return { startDate: shift(r.startDate), endDate: shift(r.endDate) };
};

// GA4 の行を { dims..., metrics... } の平たい配列にする
const flat = (rep) =>
	(rep.rows || []).map((r) => {
		const o = {};
		rep.dimensionHeaders?.forEach((h, i) => (o[h.name] = r.dimensionValues[i].value));
		rep.metricHeaders?.forEach((h, i) => (o[h.name] = Number(r.metricValues[i].value)));
		return o;
	});

async function findProperties(call) {
	// アカウント配下の全プロパティのデータストリームから測定 ID → プロパティ ID を引く
	const map = {};
	const sums = await call('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200');
	for (const acc of sums.accountSummaries || []) {
		for (const p of acc.propertySummaries || []) {
			const ds = await call(`https://analyticsadmin.googleapis.com/v1beta/${p.property}/dataStreams`).catch(() => ({}));
			for (const s of ds.dataStreams || []) {
				const mid = s.webStreamData?.measurementId;
				if (mid) map[mid] = { property: p.property, name: p.displayName, account: acc.displayName };
			}
		}
	}
	return map;
}

async function ga4(call, property, site) {
	const run = (body) => call(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, { dateRanges: [range()], limit: 10000, ...body }).then(flat);
	const out = {
		daily: await run({ dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' }, { name: 'engagementRate' }, { name: 'keyEvents' }] }),
		dailyLastYear: await call(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, { dateRanges: [rangeLastYear()], dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'totalUsers' }] }).then(flat),
		channelDaily: await run({ dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }] }),
		sourceMedium: await run({ dimensions: [{ name: 'sessionSourceMedium' }], metrics: [{ name: 'sessions' }, { name: 'engagementRate' }, { name: 'keyEvents' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 50 }),
		landingPages: await run({ dimensions: [{ name: 'landingPagePlusQueryString' }], metrics: [{ name: 'sessions' }, { name: 'engagementRate' }, { name: 'bounceRate' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 50 }),
		device: await run({ dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'sessions' }, { name: 'engagementRate' }] }),
		country: await run({ dimensions: [{ name: 'country' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 15 }),
		outboundClicks: await run({
			dimensions: [{ name: 'linkDomain' }],
			metrics: [{ name: 'eventCount' }],
			dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'click' } } },
			orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
			limit: 20
		}).catch((e) => ({ error: String(e) }))
	};
	if (site.funnel) {
		out.funnelDaily = await run({
			dimensions: [{ name: 'date' }, { name: 'eventName' }],
			metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
			dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: FUNNEL_EVENTS } } }
		});
		// HP の検索バー・ボタンから来た分（utm_source=hp_* 等）
		out.utmSource = await run({ dimensions: [{ name: 'sessionSource' }, { name: 'sessionManualAdContent' }], metrics: [{ name: 'sessions' }, { name: 'keyEvents' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 50 });
		out.purchaseRevenueDaily = await run({ dimensions: [{ name: 'date' }], metrics: [{ name: 'ecommercePurchases' }, { name: 'purchaseRevenue' }] }).catch((e) => ({ error: String(e) }));
	}
	return out;
}

async function gsc(call, siteUrl, pagePrefix) {
	// ドメインプロパティから特定のホストだけを見るときは、ページの URL で絞る
	const filter = pagePrefix ? { dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: pagePrefix }] }] } : {};
	const q = (body) => call(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { ...range(), ...filter, ...body }).then((r) => r.rows || []);
	return {
		daily: await q({ dimensions: ['date'] }),
		queries: await q({ dimensions: ['query'], rowLimit: 100 }),
		pages: await q({ dimensions: ['page'], rowLimit: 50 })
	};
}

async function gtm(call, { account, container }) {
	const base = `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${account}/containers/${container}`;
	const live = await call(`${base}/versions:live`);
	const ws = await call(`${base}/workspaces`);
	const pending = [];
	for (const w of ws.workspace || []) {
		const st = await call(`https://tagmanager.googleapis.com/tagmanager/v2/${w.path}/status`).catch(() => ({}));
		if ((st.workspaceChange || []).length) pending.push({ workspace: w.name, changes: st.workspaceChange.length, mergeConflicts: (st.mergeConflict || []).length });
	}
	return {
		liveVersion: { id: live.containerVersionId, name: live.name, tags: (live.tag || []).map((t) => ({ name: t.name, type: t.type, paused: !!t.paused })) },
		unpublishedWorkspaces: pending
	};
}

async function main() {
	const key = loadKey();
	const call = api(await getToken(key));
	const result = { generatedAt: new Date().toISOString(), range: range(), rangeLastYear: rangeLastYear(), serviceAccount: key.client_email, sites: {} };
	const props = await findProperties(call).catch((e) => ({ __error: String(e) }));
	dbg('properties', JSON.stringify(props));
	for (const site of SITES) {
		const r = (result.sites[site.key] = { label: site.label });
		// 1つ失敗しても他は取る（権限の付け忘れがどこか分かるように、理由を残す）
		const p = props[site.measurementId];
		if (p) r.ga4 = await ga4(call, p.property, site).catch((e) => ({ error: String(e) }));
		else r.ga4 = { error: `測定ID ${site.measurementId} のプロパティが見つからない（サービスアカウントに GA4 の閲覧権限が無い可能性）` };
		if (site.gsc) r.searchConsole = await gsc(call, site.gsc, site.gscPage).catch((e) => ({ error: String(e) }));
		if (site.gtm) r.gtm = await gtm(call, site.gtm).catch((e) => ({ error: String(e) }));
	}
	const json = JSON.stringify(result, null, 1);
	if (OUT) writeFileSync(OUT, json);
	else process.stdout.write(json);
	dbg('done', OUT || 'stdout', json.length, 'bytes');
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
