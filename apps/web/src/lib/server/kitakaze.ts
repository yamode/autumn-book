import { env } from '$env/dynamic/private';
import { TtlCache } from './ttl-cache';

const kitakazePlaylistId = 'PLa-R1qQvvrylCId4oDEKv31RcqqQ_6q7h';
const videoId = /^[A-Za-z0-9_-]{11}$/;
type Episode = { id: string; title: string; description: string; publishedAt: string };
const episodesCache = new TtlCache<Episode[]>(15 * 60_000, 4);

function xmlText(value: string) {
	const chars: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
	return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (match, entity: string) => {
		if (entity in chars) return chars[entity];
		if (!entity.startsWith('#')) return match;
		const hexadecimal = entity.startsWith('#x');
		const code = parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
	});
}

function newestFirst(episodes: Episode[]) {
	return episodes.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

async function fromDataApi(playlist: string, key: string): Promise<Episode[]> {
	const query = new URLSearchParams({
		part: 'snippet,contentDetails,status', maxResults: '50', playlistId: playlist,
		fields: 'nextPageToken,items(snippet(title,description),contentDetails(videoId,videoPublishedAt),status/privacyStatus)'
	});
	const episodes = new Map<string, Episode>();
	const signal = AbortSignal.timeout(6500);
	let nextPage: string | undefined;
	do {
		if (nextPage) query.set('pageToken', nextPage);
		const response = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${query}`, {
			headers: { 'x-goog-api-key': key }, signal
		});
		if (!response.ok) throw new Error('youtube_unavailable');
		const payload = await response.json() as {
			nextPageToken?: string;
			items?: {
				snippet?: { title?: string; description?: string };
				contentDetails?: { videoId?: string; videoPublishedAt?: string };
				status?: { privacyStatus?: string };
			}[];
		};
		for (const item of payload.items ?? []) {
			const id = item.contentDetails?.videoId ?? '';
			const publishedAt = item.contentDetails?.videoPublishedAt ?? '';
			const title = item.snippet?.title;
			if (title && videoId.test(id) && Number.isFinite(Date.parse(publishedAt)) && item.status?.privacyStatus === 'public') {
				episodes.set(id, { id, title, publishedAt, description: item.snippet?.description?.trim() ?? '' });
			}
		}
		nextPage = payload.nextPageToken;
	} while (nextPage);
	return newestFirst([...episodes.values()]);
}

async function fromFeed(playlist: string): Promise<Episode[]> {
	const query = new URLSearchParams({ playlist_id: playlist });
	const response = await fetch(`https://www.youtube.com/feeds/videos.xml?${query}`, {
		signal: AbortSignal.timeout(4500)
	});
	if (!response.ok) return [];
	const episodes = [...(await response.text()).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap(([, entry]) => {
		const id = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] ?? '';
		const title = entry.match(/<title>([^<]+)<\/title>/)?.[1];
		const publishedAt = entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? '';
		const description = entry.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? '';
		return title && videoId.test(id) && Number.isFinite(Date.parse(publishedAt))
			? [{ id, title: xmlText(title), publishedAt, description: xmlText(description).trim() }] : [];
	});
	return newestFirst(episodes);
}

export function kitakazePlaylist() {
	const custom = env.YOUTUBE_KITAKAZE_PLAYLIST_ID?.trim() ?? '';
	return /^PL[A-Za-z0-9_-]{10,78}$/.test(custom) ? custom : kitakazePlaylistId;
}

export async function kitakazeApiStatus(check: boolean) {
	const key = env.YOUTUBE_DATA_API_KEY?.trim();
	if (!key) return { status: 'missing' as const };
	if (!check) return { status: 'configured' as const };
	try {
		const episodes = await fromDataApi(kitakazePlaylist(), key);
		return { status: 'connected' as const, count: episodes.length };
	} catch {
		return { status: 'failed' as const };
	}
}

export async function kitakazeEpisodes(): Promise<Episode[]> {
	const playlist = kitakazePlaylist();
	const saved = episodesCache.get(playlist);
	if (saved) return saved;
	const key = env.YOUTUBE_DATA_API_KEY?.trim();
	const api = key ? await fromDataApi(playlist, key).catch(() => null) : null;
	const episodes = api ?? await fromFeed(playlist).catch(() => []);
	if (episodes.length) episodesCache.set(playlist, episodes);
	return episodes;
}
