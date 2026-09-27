import { env } from '$env/dynamic/private';

// Guest bookings write directly into the PMS ledger. Keep writes off until
// operations explicitly enables this server-only deployment setting.
export function bathPmsEnabled(): boolean {
	return env.PRIVATE_BATH_PMS_ENABLED === 'true';
}
