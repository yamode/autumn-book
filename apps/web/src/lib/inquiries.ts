export const STATES: Record<string, string> = { new: '未対応', working: '対応中', waiting: 'お客様の返信待ち', done: '完了', no_action: '対応不要' };

export const INQUIRY_TYPES:Record<string,string>={"guest":"当ホテルご利用のお客様","business":"事業者の方","media":"メディア関係者・取材について"};
export const canDraftInquiry=(item:{profile:Record<string,string>;status:string})=>item.profile.inquiry_type!=='business'&&item.status!=='no_action';
