// AAGUID は表示名のヒントだけに使う。出典: passkeydeveloper/passkey-authenticator-aaguids の aaguid.json。
const providerNames = new Map([
	['ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4', 'Google Password Manager'],
	['fbfc3007-154e-4ecc-8c0b-6e020557d7bd', 'Apple Passwords'],
	['dd4ec289-e01d-41c9-bb89-70fa845d4bf2', 'iCloud Keychain (Managed)'],
	['d3452668-01fd-4c12-926c-83a4204853aa', 'Microsoft Password Manager'],
	['08987058-cadc-4b81-b6e1-30de50dcbe96', 'Windows Hello'],
	['9ddd1817-af5a-4672-a2b9-3e3dd95000a9', 'Windows Hello'],
	['6028b017-b1d4-4c02-b4b3-afcdafc96bb2', 'Windows Hello'],
	['adce0002-35bc-c60a-648b-0b25f1f05503', 'Chrome on Mac'],
	['771b48fd-d3d4-4f74-9232-fc157ab0507a', 'Edge on Mac'],
	['53414d53-554e-4700-0000-000000000000', 'Samsung Pass'],
	['bada5566-a7aa-401f-bd96-45619a55120d', '1Password'],
	['d548826e-79b4-db40-a3d8-11116f7e8349', 'Bitwarden'],
	['531126d6-e717-415c-9320-3d9aa6981239', 'Dashlane'],
	['0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6', 'Keeper'],
	['b84e4048-15dc-4dd0-8640-f4f60813c8af', 'NordPass'],
	['50726f74-6f6e-5061-7373-50726f746f6e', 'Proton Pass'],
	['b78a0a55-6ef8-d246-a042-ba0f6d55050c', 'LastPass'],
	['f3809540-7f14-49c1-a8b3-8f813b225541', 'Enpass'],
	['fdb141b2-5d84-443e-8a35-4698c205a502', 'KeePassXC'],
	['eaecdef2-1c31-5634-8639-f1cbd9c00a08', 'KeePassDX']
]);

function deviceLabel(userAgent: string) {
	if (/iPhone/i.test(userAgent)) return 'iPhone';
	if (/iPad/i.test(userAgent)) return 'iPad';
	if (/Android/i.test(userAgent)) return 'Android';
	if (/Windows/i.test(userAgent)) return 'Windows PC';
	if (/Macintosh/i.test(userAgent)) return 'Mac';
	if (/CrOS/i.test(userAgent)) return 'Chromebook';
	if (/Linux/i.test(userAgent)) return 'Linux PC';
	return null;
}

export function defaultMemberPasskeyName(details: {
	aaguid: string;
	deviceBound: boolean;
	attachment?: 'platform' | 'cross-platform';
	transports?: string[];
	userAgent: string;
}) {
	const provider = providerNames.get(details.aaguid.toLowerCase());
	const transports = details.transports ?? [];
	const externalKey = transports.some((transport) => ['usb', 'nfc', 'ble'].includes(transport));
	const platform = details.attachment === 'platform' ||
		(!details.attachment && transports.includes('internal') && !externalKey);
	const name = provider ?? (externalKey ? 'Security key' : 'Passkey');
	const device = details.deviceBound && platform ? deviceLabel(details.userAgent) : null;
	return device && !name.endsWith(` ${device}`) ? `${name} (${device})` : name;
}
