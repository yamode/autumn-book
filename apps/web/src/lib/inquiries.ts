export const STATES: Record<string, string> = { new: '未対応', working: '対応中', waiting: 'お客様の返信待ち', done: '完了', no_action: '対応不要' };

export const INQUIRY_TYPES:Record<string,string>={"guest":"当ホテルご利用のお客様","business":"事業者の方","media":"メディア関係者・取材について"};
export const canDraftInquiry=(item:{profile:Record<string,string>;status:string})=>item.profile.inquiry_type!=='business'&&item.status!=='no_action';
export function inquiryGuestLabel(name:string){const value=name.trim();if(!value||/^(?:\[?お客様\]?)(?:[\s　]*様)*$/.test(value))return 'お客様';return /(?:様|御中)$/.test(value)?value:value+' 様';}
export const INQUIRY_REPLY_LANGUAGES:Record<string,string>={en:'英語',ja:'日本語','zh-Hant':'中国語（繁体字）','zh-Hans':'中国語（簡体字）',ko:'韓国語',fr:'フランス語',de:'ドイツ語',es:'スペイン語',it:'イタリア語',th:'タイ語',vi:'ベトナム語',pt:'ポルトガル語'};
