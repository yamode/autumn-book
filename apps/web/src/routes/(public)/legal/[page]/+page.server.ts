import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const pages: Record<string, { title: string; body: string }> = {
	tokushoho: {
		title: '特定商取引法に基づく表記',
		body: '## 販売事業者\n\n株式会社山人\n\n## 所在地\n\n岩手県和賀郡西和賀町湯川52-71-10\n\n## 連絡先\n\n0197-82-2222 ／ info@yamado.co.jp\n\n（正式な文面は公開前に確定します）'
	},
	privacy: {
		title: 'プライバシーポリシー',
		body: '## 個人情報の取り扱いについて\n\n当社は、ご予約・会員登録を通じてお預かりした個人情報を、宿泊サービスの提供およびご案内の目的にのみ利用します。\n\n（正式な文面は公開前に確定します）'
	},
	yakkan: {
		title: '宿泊約款',
		body: '## 宿泊約款\n\n旅館業法および国際観光ホテル整備法に基づくモデル宿泊約款に準拠します。\n\n（正式な文面は公開前に確定します）'
	}
};

export const load: PageServerLoad = async ({ params }) => {
	const page = pages[params.page];
	if (!page) error(404, 'ページが見つかりません');
	return { page };
};
