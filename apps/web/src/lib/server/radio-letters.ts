import { partnerServiceClient } from './partners/admin-client';

export const RADIO_BUCKET = 'book-radio-letters';
export const RADIO_LIMIT = 30 * 1024 * 1024;
const fileExtensions: Record<string, string> = {
	'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
	'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm'
};
export const RADIO_ACCEPT = Object.keys(fileExtensions).join(',');
export type RadioAttachment = { path: string; kind: 'image' | 'video' };

export function radioFileError(files: File[]) {
	if (files.length > 3 || files.reduce((sum, file) => sum + file.size, 0) > RADIO_LIMIT) return 'size';
	if (files.some((file) => !Object.hasOwn(fileExtensions, file.type))) return 'type';
	return null;
}

export async function submitRadioLetter(memberId: string | null, body: string, radioName: string, files: File[]) {
	const service = partnerServiceClient();
	if (!service) throw new Error('unavailable');
	const postId = crypto.randomUUID();
	const bucket = service.storage.from(RADIO_BUCKET);
	const attachments: RadioAttachment[] = [];
	let submitted = false;
	try {
		for (const [index, file] of files.entries()) {
			const path = `${postId}/${index + 1}.${fileExtensions[file.type]}`;
			const { error } = await bucket.upload(path, file, { contentType: file.type, upsert: false });
			if (error) throw new Error('upload_failed');
			attachments.push({ path, kind: file.type.startsWith('video/') ? 'video' : 'image' });
		}
		const { error } = await service.schema('book').rpc('radio_submit_letter', {
			p_post_id: postId, p_member_id: memberId, p_body: body, p_radio_name: radioName || null, p_attachments: attachments
		});
		if (error) throw new Error(error.message);
		submitted = true;
	} finally {
		if (!submitted && attachments.length) {
			const receipt = await service.schema('book').from('otayori_posts').select('id').eq('id', postId).maybeSingle();
			if (!receipt.error && !receipt.data) await bucket.remove(attachments.map(({ path }) => path));
		}
	}
}

export async function radioAttachmentLinks(attachments: RadioAttachment[]) {
	const service = partnerServiceClient();
	if (!service || !attachments.length) return [];
	const { data } = await service.storage.from(RADIO_BUCKET)
		.createSignedUrls(attachments.map(({ path }) => path), 900, { download: true });
	return attachments.flatMap(({ kind }, index) => data?.[index]?.signedUrl ? [{ kind, url: data[index].signedUrl }] : []);
}
