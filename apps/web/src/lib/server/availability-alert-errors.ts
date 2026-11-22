import * as m from '$lib/paraglide/messages';

// 空室通知の RPC エラーコードを、リクエストの言語の文言にする
export function alertErrorMessage(code: string) {
	if (code.includes('alert_limit')) return m.alert_error_limit();
	if (code.includes('room_available')) return m.alert_error_room_available();
	if (code.includes('duplicate_alert')) return m.alert_error_duplicate();
	if (code.includes('verified_email_required')) return m.alert_error_verified_email_required();
	if (code.includes('invalid_conditions')) return m.alert_error_invalid_conditions();
	if (code.includes('not_found')) return m.alert_error_not_found();
	return m.alert_error_generic();
}
