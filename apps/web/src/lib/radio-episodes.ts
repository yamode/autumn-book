export type RadioEpisode = { id: string; title: string; publishedAt: string };
export type RadioEpisodePage = { items: RadioEpisode[]; next: string | null };
