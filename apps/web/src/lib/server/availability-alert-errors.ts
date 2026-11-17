export function alertErrorMessage(code: string) {
	if (code.includes('alert_limit')) return '空室通知は同時に10件まで登録できます。不要な通知を停止してください。';
	if (code.includes('room_available')) return 'この条件のお部屋に空きがあります。検索結果を更新してください。';
	if (code.includes('duplicate_alert')) return '同じ条件の空室通知をすでに登録しています。';
	if (code.includes('verified_email_required')) return '確認済みのメールアドレスが必要です。プロフィールでメールアドレスをご確認ください。';
	if (code.includes('invalid_conditions')) return '宿泊日・人数・お部屋・プランの条件を確認してください。';
	if (code.includes('not_found')) return '通知が見つかりません。画面を更新してください。';
	return '処理できませんでした。時間をおいてもう一度お試しください。';
}
