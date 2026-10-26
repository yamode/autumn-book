// 客室内線の通話中だけ、ブラウザの音声セッションを「通話用」にする。
//
// iOS Safari（16.4 以降）の Audio Session API（navigator.audioSession）。type を 'play-and-record' にすると
// OS の通話と同じ扱いになり、相手の声の既定の出力先がスピーカーではなく受話口（通話モード）になる。
// 通話が終わったら 'auto' に戻す（他の音声の扱いを変えたままにしない）。
//
// ・対応していないブラウザ（Chrome の Android など）では何もしない。出力先はブラウザと OS が決める。
// ・Web から受話口／スピーカーを後から切り替える API は無い。切替ボタンは作らない。
// ・getUserMedia の前（ボタン押下のユーザー操作の中）で呼ぶ。
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/**
 * 相手の声が必ずスピーカーから出る端末か（通話モード＝受話口にできない端末）。
 * Android のブラウザは出力先を選べず、スピーカーで聞こえる。通話シートに一言出して知らせる。
 */
export function isSpeakerOnlyDevice(): boolean {
	try {
		if (typeof navigator === 'undefined') return false;
		return /Android/i.test(navigator.userAgent ?? '');
	} catch {
		return false;
	}
}

export function setCallAudioSession(on: boolean): void {
	try {
		if (typeof navigator === 'undefined') return;
		const session = (navigator as AudioSessionNavigator).audioSession;
		if (!session) return;
		session.type = on ? 'play-and-record' : 'auto';
	} catch {
		/* 対応していない・設定できない。通話そのものは続ける */
	}
}
