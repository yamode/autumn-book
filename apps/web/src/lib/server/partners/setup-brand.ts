// 取引先のログインID・パスワード設定メールの「名乗り」と、子ユーザーのログインIDの接頭辞（純関数）。
// 複数施設化 S5b（docs/partner-multi-facility.md §7.11・§9・2026-10-09）。
//
// パスワード設定リンク・子ユーザー作成のメールは、予約と違って「施設」が1つに決まらない。
//   - 差出人 = 既定の施設（primary_facility_id。オフならオンの先頭）の施設名・返信先（sendPartnerMail に facilityId を渡す）
//   - 本文の名乗り = オンの施設が2つ以上なら「山人（山人-yamado-・山人-oga-）」のように列挙。1つならその施設名（従来どおり）
//   - 件名 = 2つ以上なら施設名の共通部分（「山人」）、1つならその施設名
import type { PartnerContext } from './store';

export type PartnerSetupBrand = {
  /** 差出人・返信先に使う施設（既定の施設） */
  facilityId: string;
  /** 差出人の施設名 */
  senderName: string;
  /** 本文の名乗り（2施設なら列挙） */
  label: string;
  /** 件名の【】の中 */
  subjectName: string;
};

/** 施設名の共通の頭（「山人-yamado-」「山人-oga-」→「山人」）。区切りの記号・空白は落とす。共通部分が無ければ空 */
export function commonFacilityBrand(names: readonly string[]): string {
  if (!names.length) return '';
  let prefix = names[0];
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix.replace(/[\s\-_・－—–]+$/u, '').trim();
}

export function partnerSetupBrand(
  partner: Pick<PartnerContext, 'facilities' | 'primary_facility_id' | 'facility_id' | 'facility_name'>
): PartnerSetupBrand {
  const enabled = partner.facilities.filter((f) => f.enabled);
  const sender =
    enabled.find((f) => f.id === partner.primary_facility_id) ??
    enabled[0] ??
    partner.facilities.find((f) => f.id === partner.primary_facility_id) ?? { id: partner.facility_id, name: partner.facility_name };
  const senderName = sender.name || partner.facility_name;
  if (enabled.length < 2) return { facilityId: sender.id, senderName, label: senderName, subjectName: senderName };
  const names = enabled.map((f) => f.name);
  const brand = commonFacilityBrand(names);
  return {
    facilityId: sender.id,
    senderName,
    label: `${brand || senderName}（${names.join('・')}）`,
    subjectName: brand || senderName
  };
}

/**
 * 子ユーザーのログインIDの接頭辞（§9: 施設の接頭辞をやめる）。作るマスタユーザーのログインIDから取る:
 *   「saishunkan-ab12cd」→「saishunkan」（最初の - の前）／「saishunkan」（- が無い短いID）→ そのまま。
 * 英数字 2〜20 文字に収まらなければ「partner」。既存のログインIDは変えない（新しく作るときだけ）。
 */
export function childLoginIdPrefix(masterLoginId: string | null | undefined): string {
  const id = String(masterLoginId ?? '').trim().toLowerCase();
  const head = id.includes('-') ? id.slice(0, id.indexOf('-')) : id;
  return /^[a-z0-9]{2,20}$/.test(head) ? head : 'partner';
}
