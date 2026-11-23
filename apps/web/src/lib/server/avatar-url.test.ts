import { describe, expect, it } from 'vitest';
import { ownAvatarUrl } from './avatar-url';

const base = 'https://opkocyapzmsjzhbwlguh.supabase.co';
const uid = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('アバター URL（M-9）', () => {
	it('自分たちの avatars バケットの URL は通す', () => {
		const u = `${base}/storage/v1/object/public/avatars/${uid}/avatar.jpg?v=1732345678901`;
		expect(ownAvatarUrl(u, base)).toBe(u);
		expect(ownAvatarUrl(`${base}/storage/v1/object/public/avatars/${uid}/avatar.png`, base + '/')).not.toBeNull();
	});
	it('外部の URL・別のバケット・変な形は出さない', () => {
		expect(ownAvatarUrl('https://evil.example/x.png', base)).toBeNull();
		expect(ownAvatarUrl(`https://other.supabase.co/storage/v1/object/public/avatars/${uid}/a.jpg`, base)).toBeNull();
		expect(ownAvatarUrl(`${base}/storage/v1/object/public/book-photos/${uid}/a.jpg`, base)).toBeNull();
		expect(ownAvatarUrl(`${base}/storage/v1/object/public/avatars/${uid}/../x.jpg`, base)).toBeNull();
		expect(ownAvatarUrl(null, base)).toBeNull();
		expect(ownAvatarUrl(`${base}/storage/v1/object/public/avatars/${uid}/a.jpg`, '')).toBeNull();
	});
});
