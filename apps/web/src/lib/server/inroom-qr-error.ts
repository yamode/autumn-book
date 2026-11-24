// URL・QR の発行（book.get_or_issue_stay_token）が断った理由を、画面で分かる言葉にする（2026-11-24）。
// supabase-js のエラーは Error ではない（PostgrestError のただのオブジェクト）ので、以前は instanceof Error が
// 外れて理由が消え、いつも「URLの取得に失敗しました」になっていた。チェックアウト日の 11:00 を過ぎた
// お客様（stay_expired）を押しても、壊れているように見えていた。
export function issueQrErrorMessage(e: unknown): string {
	const raw = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message ?? '') : '';
	if (raw.includes('stay_expired')) return 'チェックアウト日の 11:00 を過ぎたため、このお客様の客室案内は終了しています。';
	if (raw.includes('stay_not_found')) return 'このご予約は取消・ノーショーになっているため出せません。';
	if (raw.includes('forbidden')) return 'この施設の客室案内を出す権限がありません。';
	if (raw.includes('not_authenticated')) return 'ログインが切れています。ログインし直してください。';
	return raw ? `URLの取得に失敗しました（${raw}）` : 'URLの取得に失敗しました';
}
