// 取引先専用ページの「特定商取引法に基づく表記」（2026-10-06 指示: 取引先向けに書き直す）。
// 公式サイト（一般のお客様向け・lib/server/store.ts の legalPages.tokushoho）とは別の文面。
// お支払い方法・お支払い時期・取消の期限は、その取引先の設定（選んでいる施設で合成した booking_settings）から書き出す。
// 宿泊施設の欄は取引先ページで選んでいる施設（複数施設化 §7.2・2026-10-09）。ほかの施設の表記へのリンクはページ側（?f=）。
// 事業者・連絡先は公式サイトの表記と同じ内容（変えるときは両方を直す）。
import { DEPOSIT_PAYMENT_LABEL, describeDeadline, describeInvoiceDue, isStripePaymentOption, paymentOptionLabel } from '$lib/partner-booking';
import { isBillablePaymentOption } from '$lib/partner-invoice';
import { availablePaymentOptions, creditOverPaymentOptions } from './booking';
import type { PartnerContext } from './store';
import { adminFeeNotice, DEFAULT_ADMIN_FEE_PERCENT } from '$lib/cancel-admin-fee';

// 事業者（会社で1つ）。施設ごとの連絡先は FACILITY_CONTACTS（選んでいる施設を先に出す・2026-10-09 複数施設化 §7.2）
const COMPANY = `## 販売事業者

株式会社山人

## 代表者

代表取締役 高鷹 政明

## 運営責任者

佐々木 耀

## 所在地

〒029-5514 岩手県和賀郡西和賀町湯川52-71-10`;

const COMPANY_CONTACT = `- 電話：0197-82-2222
- メール：info@yamado.co.jp`;

/** 宿泊施設の連絡先（core.facilities の slug → 表記）。公式サイトの表記と同じ内容（変えるときは両方を直す） */
const FACILITY_CONTACTS: { slug: string; name: string; address: string; tel: string; email: string }[] = [
  { slug: 'yamado', name: '山人-yamado-', address: '岩手県和賀郡西和賀町湯川52-71-10', tel: '0197-82-2222', email: 'info@yamado.co.jp' },
  { slug: 'oga', name: '山人-oga-', address: '秋田県男鹿市船川港台島字鵜ノ崎62-29', tel: '0185-47-7776', email: 'info@oga.yamado.co.jp' }
];

/**
 * 事業者・宿泊施設・連絡先の欄（純関数）。facilitySlug = 取引先ページで選んでいる施設。
 * 選んでいる施設を「宿泊施設」に書き、連絡先の施設一覧でも先頭にする。知らない施設なら施設の欄は出さず一覧だけ（従来どおり）。
 */
export function tokushohoCompanySection(facilitySlug?: string | null): string {
  const selected = FACILITY_CONTACTS.find((f) => f.slug === facilitySlug) ?? null;
  const ordered = selected ? [selected, ...FACILITY_CONTACTS.filter((f) => f !== selected)] : FACILITY_CONTACTS;
  const facility = selected
    ? `\n\n## 宿泊施設\n\n${selected.name}\n\n- 所在地：${selected.address}\n- 電話：${selected.tel}\n- メール：${selected.email}`
    : '';
  const list = ordered.map((f) => `- ${f.name}（${f.address}）：${f.tel} ／ ${f.email}`).join('\n');
  return `${COMPANY}${facility}\n\n## 連絡先\n\n${COMPANY_CONTACT}\n\n各施設へのお問い合わせは、次の連絡先でも承ります。\n\n${list}`;
}

export function partnerTokushoho(
  partner: Pick<PartnerContext, 'name' | 'facility_name' | 'booking_settings'> &
    Partial<Pick<PartnerContext, 'credit_over_action' | 'pms_guest_id' | 'facility_slug'>>,
  // 予約時決済の事務手数料（取消時に返金しない率・施設の設定 book.payment_settings・2026-10-07）
  adminFeePercent: number = DEFAULT_ADMIN_FEE_PERCENT
): { title: string; body: string } {
  const s = partner.booking_settings;
  const due = describeInvoiceDue(s.invoiceDue);
  const base = availablePaymentOptions(partner);
  // 受付枠（与信）を超えたときだけの支払方法（Phase 3b: 全額の予約時決済・デポジット）
  const overIds = creditOverPaymentOptions({ credit_over_action: partner.credit_over_action ?? 'ignore', pms_guest_id: partner.pms_guest_id ?? null });
  const ids = [...base, ...overIds.filter((id) => !base.includes(id))];

  // お支払い方法と時期（この取引先に許可している支払方法だけ）
  const methods: string[] = [];
  const timings: string[] = [];
  for (const id of ids) {
    const label = paymentOptionLabel(id, s);
    if (id === 'invoice_monthly') {
      methods.push(`- ${label}：ご請求書による銀行振込`);
      timings.push(`- ${label}：ご利用月（チェックアウト日が属する月）の月末締めでご請求書（適格請求書）を発行し、${due}までに指定の口座へお振り込みいただきます。`);
    } else if (id === 'online') {
      methods.push(`- ${label}：クレジットカード（オンライン決済）`);
      timings.push(`- ${label}：ご予約の確定時`);
    } else if (id === 'deposit_online') {
      methods.push(`- ${DEPOSIT_PAYMENT_LABEL}：クレジットカード（オンライン決済）。貴社の受付枠を超えるご予約のときだけ`);
      timings.push(`- ${DEPOSIT_PAYMENT_LABEL}：ご予約の確定時にデポジット（予約画面に表示する額）をお支払いいただき、残額は月末のご請求書または現地でお支払いいただきます。`);
    } else if (id === 'online_checkin') {
      methods.push(`- ${label}：クレジットカード（オンライン決済）`);
      timings.push(`- ${label}：ご予約時にカードをご登録いただき、チェックアウト日に自動でお支払い`);
    } else {
      const note = s.customPaymentOptions.find((o) => o.id === id)?.note ?? '';
      methods.push(`- ${label}${note ? `：${note}` : ''}`);
      timings.push(
        isBillablePaymentOption(id, s)
          ? `- ${label}：ご利用月の月末締めでご請求書を発行し、${due}までにお支払いいただきます。`
          : `- ${label}：貴社とのお取り決めのとおり`
      );
    }
  }
  const cancelText =
    s.cancelDays == null
      ? 'ご予約の取消は、宿へご連絡ください（この画面からは取り消せません）。'
      : `ご予約の取消は、宿泊日の${describeDeadline(s.cancelDays, s.cutoffHour)}、この専用ページの「予約一覧」からできます。それより後は宿へご連絡ください。`;
  const stripe = ids.some(isStripePaymentOption);
  const billable = ids.some((id) => isBillablePaymentOption(id, s));
  // 予約時に支払う方法（全額の予約時決済・デポジット）があるときだけ、事務手数料の説明を出す（チェックアウト日決済は未請求なので対象外）
  const prepaid = ids.some((id) => id === 'online' || id === 'deposit_online');
  const adminFeeText = prepaid
    ? `\n- ${adminFeeNotice(adminFeePercent, 'partner')}キャンセル料の期間に関係なくかかります。${
        ids.includes('deposit_online')
          ? 'デポジットのご予約は、お支払いのデポジットの額に同じ率を掛けた額です。'
          : ''
      }`
    : '';
  // デポジットの取消: キャンセル料をデポジットに充当し、超えた分は残額の精算先にかかわらず請求書で請求（2026-10-07 変更・旧 N3 廃止）
  const depositCancelText = ids.includes('deposit_online')
    ? '\n- デポジットのご予約を取り消した場合は、お支払いのデポジットをキャンセル料に充当し、差額を返金します。キャンセル料がデポジットを超える場合、超えた額は残額の精算方法（ご請求書・現地）にかかわらず、ご利用予定月のご請求書でご請求します（不課税）。'
    : '';

  const body = `このページは、${partner.facility_name}と取引のある法人・旅行会社等のお客様（以下「貴社」）専用の予約ページです。
一般のお客様向けの表記は、公式サイトに掲載します。

${tokushohoCompanySection(partner.facility_slug)}

## 販売価格

料金カレンダー・予約画面に表示する、貴社専用の料金です（消費税込み）。

## 販売価格以外にご負担いただく費用

- 入湯税（施設所在地の市町が定める額。予約画面に表示し、宿泊料金と合わせてご請求します）
- ご滞在中の追加のご飲食・売店など、現地でのご利用分（チェックアウト時に、ご宿泊者様へ別途ご請求します）
- インターネット接続に必要な通信料${billable ? '\n- ご請求書のお振り込みにかかる振込手数料' : ''}

## お支払い方法

貴社とのお取り決めにより、次の方法からお選びいただけます（予約画面に表示します）。

${methods.join('\n') || '- 宿へお問い合わせください'}

## お支払い時期

${timings.join('\n') || '- 宿へお問い合わせください'}

## サービスの提供時期

ご予約いただいた宿泊日に提供します。

## 取消・キャンセル料・返金

- サービスの性質上、返品はございません。
- ${cancelText}
- 取消には、各プランのキャンセル規定に従ってキャンセル料を申し受けます。キャンセル規定は、予約画面と予約確認メールに記載しています。
- キャンセル料は、税込の予約金額（割引前・入湯税を除く）に規定の料率を掛けた額です。逸失利益に対する損害賠償金のため、消費税はかかりません（不課税）。${
    billable ? '\n- 請求書払いのご予約のキャンセル料は、ご利用予定月のご請求書に計上します。' : ''
  }${
    stripe
      ? '\n- 予約時にお支払い済みのご予約は、お支払い額からキャンセル料を差し引いた額を、お支払いに使われたクレジットカードへ返金します。返金が反映される時期は、カード会社によって異なります。\n- チェックアウト日にお支払いのご予約は、キャンセル料をご登録のクレジットカードへ請求します。'
      : ''
  }${adminFeeText}${depositCancelText}
- 当館の都合で宿泊を提供できない場合は、宿泊料金はいただきません（お支払い済みの場合は全額を返金します）。`;

  return { title: '特定商取引法に基づく表記', body };
}
