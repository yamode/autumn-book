// QR コードを SVG のパスにする。**純関数**（DOM も fetch も使わない）。
//
// ■ なぜ SVG なのか（設計書 §4.4）
//   館内図は紙に刷る帳票で、QR は 20mm 角ほどの小ささになる。PNG だと刷る解像度に
//   縛られてつぶれるが、SVG はベクタなので原寸によらず縁が立つ。
//   サーバで画像を作る案もあったが、エンドポイントとキャッシュが増えるだけで利点が無い。
//
// ■ 誤り訂正レベル M
//   紙の汚れ・折れをある程度許容しつつ、モジュール数を増やしすぎない現実的な水準。
//   `https://booking.yamado.co.jp/r/c/<64hex>` ≒ 91文字で 41×41（version 6）に収まる。
//
// ■ 実装は自前で書かない
//   Reed-Solomon とマスク選択まで自分で書くと、間違えても「読めるQR」が出てしまい
//   紙に刷ってから気づくことになる。枯れた qrcode-generator に任せる（依存なし・Workers で動く）。
// ※ 既存の印刷スリップ（/admin/inroom/slip/[id]）は同じライブラリの createSvgTag を
//   サーバ側で呼び、SVG 文字列を {@html} で描いている。あちらは cellSize を px で焼くため
//   原寸を後から変えられない。館内図に刷る QR は用紙・レイアウトで大きさが変わるので、
//   こちらは **viewBox だけを持つ**（大きさは呼び出し側が決める）。
//   スリップを刷り直すときにこちらへ寄せる。
import qrcode from 'qrcode-generator';

export type QrSvg = {
	/** モジュール数（1辺）。余白（quiet zone）を含む viewBox の1辺でもある。 */
	size: number;
	/** 黒モジュールをまとめた path の d 属性。 */
	path: string;
};

/** 紙に刷るときの余白。規格上は4モジュール以上（これを削るとスキャンが落ちる）。 */
const QUIET_ZONE = 4;

/**
 * URL などの文字列を QR の SVG パスにする。
 * 空文字は size=0 / path='' を返す（呼び出し側で「まだ何も無い」を出し分けられるように）。
 */
export function qrSvg(text: string, ecc: 'L' | 'M' | 'Q' | 'H' = 'M'): QrSvg {
	const value = String(text ?? '');
	if (!value) return { size: 0, path: '' };

	const qr = qrcode(0, ecc); // 0 = 収まる最小の型番を自動で選ぶ
	qr.addData(value);
	qr.make();

	const count = qr.getModuleCount();
	const size = count + QUIET_ZONE * 2;

	// 1モジュール＝1×1 の矩形。連続する黒を横に繋いで path を短くする
	// （41×41 で最大1,681個の矩形になるため、繋がないと DOM も文字列も無駄に太る）。
	const parts: string[] = [];
	for (let r = 0; r < count; r++) {
		let runStart = -1;
		for (let c = 0; c <= count; c++) {
			const dark = c < count && qr.isDark(r, c);
			if (dark && runStart < 0) runStart = c;
			if (!dark && runStart >= 0) {
				parts.push(`M${runStart + QUIET_ZONE} ${r + QUIET_ZONE}h${c - runStart}v1h-${c - runStart}z`);
				runStart = -1;
			}
		}
	}
	return { size, path: parts.join('') };
}
