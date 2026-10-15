// QRコードだけを PNG で保存する（ブラウザ専用・canvas を使う）。
// 入口QR（2026-10-10）で作ったものを、客室案内の各QRで使い回せるよう切り出した（2026-10-15）。
// チラシ・館内掲示など別の版下に貼る用。画面の SVG と同じ形（$lib/qr・周りの余白込み）を白地に描く。
import { qrSvg } from '$lib/qr';

/** 1辺はおよそ 1024px 以上（印刷にも足りる）。 */
const MIN_PX = 1024;

/** ファイル名に使えない文字を置き換える（部屋名・お客様名が入るため）。 */
function safeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'QR';
}

/** text の QR を PNG にしてダウンロードさせる。fileName は拡張子なしで渡す。 */
export function downloadQrPng(text: string, fileName: string): void {
	const qr = qrSvg(text);
	if (qr.size <= 0) return;
	// 1マスを整数ピクセルにして縁をにじませない
	const cell = Math.ceil(MIN_PX / qr.size);
	const px = qr.size * cell;
	const canvas = document.createElement('canvas');
	canvas.width = px;
	canvas.height = px;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	ctx.imageSmoothingEnabled = false;
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, px, px);
	ctx.scale(cell, cell);
	ctx.fillStyle = '#000000';
	ctx.fill(new Path2D(qr.path));
	canvas.toBlob((blob) => {
		if (!blob) return;
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${safeFileName(fileName)}.png`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}, 'image/png');
}
