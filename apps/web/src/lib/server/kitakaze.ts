import { env } from '$env/dynamic/private';
import { TtlCache } from './ttl-cache';

const channelId = 'UClqAw5YP1PVSJ_SPmTe6N_A';
const uploadsId = 'UUlqAw5YP1PVSJ_SPmTe6N_A';
const videoId = /^[A-Za-z0-9_-]{11}$/;
type Episode = { id: string; title: string };
const episodesCache = new TtlCache<Episode[]>(15 * 60_000, 4);

function xmlTitle(value: string) {
	const chars: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
	return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (match, entity: string) => {
		if (entity in chars) return chars[entity];
		if (!entity.startsWith('#')) return match;
		const hexadecimal = entity.startsWith('#x');
		const code = parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
	});
}

async function fromDataApi(playlist: string, key: string): Promise<Episode[]> {
	const query = new URLSearchParams({
		part: 'snippet,contentDetails,status', maxResults: '50', playlistId: playlist,
		fields: 'items(snippet/title,contentDetails/videoId,status/privacyStatus)'
	});
	const response = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${query}`, {
		headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(3500)
	});
	if (!response.ok) throw new Error('youtube_unavailable');
	const payload = await response.json() as {
		items?: { snippet?: { title?: string }; contentDetails?: { videoId?: string }; status?: { privacyStatus?: string } }[];
	};
	return (payload.items ?? []).flatMap((item) => {
		const id = item.contentDetails?.videoId ?? '';
		const title = item.snippet?.title;
		return title && videoId.test(id) && item.status?.privacyStatus === 'public' ? [{ id, title }] : [];
	});
}

async function fromFeed(playlist: string): Promise<Episode[]> {
	const query = new URLSearchParams([[playlist === uploadsId ? 'channel_id' : 'playlist_id', playlist === uploadsId ? channelId : playlist]]);
	const response = await fetch(`https://www.youtube.com/feeds/videos.xml?${query}`, {
		signal: AbortSignal.timeout(4500)
	});
	if (!response.ok) return [];
	return [...(await response.text()).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap(([, entry]) => {
		const id = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] ?? '';
		const title = entry.match(/<title>([^<]+)<\/title>/)?.[1];
		return title && videoId.test(id) ? [{ id, title: xmlTitle(title) }] : [];
	});
}

export function kitakazePlaylist() {
	const custom = env.YOUTUBE_KITAKAZE_PLAYLIST_ID?.trim() ?? '';
	return /^[A-Za-z0-9_-]{12,80}$/.test(custom) ? custom : uploadsId;
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
