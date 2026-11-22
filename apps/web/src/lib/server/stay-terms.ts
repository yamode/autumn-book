import type { Locale } from '$lib/types';

// Book の予約時表示と direct_payment_refund_due の控除順序に合わせる。
export const publicBookingRefundTerms: Record<Locale, string> = {
	ja: `予約時にオンラインでお支払い済みの予約をお客様のご都合で取り消す場合、キャンセル料がかかる期間は規定のキャンセル料を、キャンセル料がかからない期間は事務手数料を差し引いて返金します（両方は差し引きません。予約時決済の割引額は差し引きません）。

事務手数料は、お支払額に予約時にご案内した率（既定5％）を乗じ、1円未満を切り捨てた額です。カード決済や返金事務にかかる費用に充てます。事務手数料は入湯税を除いたお支払額を上限とします。客室の一部を取り消す場合は、対象客室のお支払い分と適用条件に基づいて精算します。

返金がある場合は、原則としてお支払いに使用したカードに返金します。反映時期は発行会社により異なります。チェックアウト日のオンライン決済で取消時に未請求の場合は、事前決済の割引額や事務手数料は適用せず、キャンセル料がかかる場合にその額を登録カードに請求します。

当社の都合で宿泊サービスを提供できない場合、そのサービスについてはキャンセル料、割引額および事務手数料を差し引かず、お支払い済みの対象額を全額返金します。`,
	en: `If you cancel a reservation paid online at booking for your own reasons, we deduct the applicable cancellation fee during the cancellation-fee period, or the administrative fee when no cancellation fee applies, and refund the rest. We never deduct both, and we do not deduct the advance-payment discount.

The administrative fee is the amount paid multiplied by the rate shown when you booked (5% by default), rounded down to the nearest yen. It covers card processing and refund handling. The administrative fee is capped at the amount paid excluding bathing tax. For a partial cancellation, settlement is based on the payment share and conditions for the affected rooms.

Any refund is normally returned to the card used. Posting times depend on the card issuer. If you selected online payment on the check-out date and your card has not yet been charged, the advance-payment discount and administrative fee do not apply. Any applicable cancellation fee is charged to the registered card.

If we are unable to provide the stay for reasons attributable to us, we refund the full amount paid for the affected services, without deducting a cancellation fee, discount or administrative fee.`,
	'zh-TW': `如因旅客自身原因取消預訂時已線上付款的訂單，在收取取消費的期間扣除規定的取消費，在免收取消費的期間扣除手續費，其餘退還（兩者不會同時扣除，亦不扣除預訂時付款折扣金額）。

手續費以已付款金額乘以預訂時顯示的費率（預設為5%）計算，不足1日圓的部分捨去，用於信用卡付款及退款作業。手續費以扣除入湯稅後的已付款金額為上限。若僅取消部分客房，則依受影響客房分攤的實付金額及適用條件結算。

如有退款，原則上退回原付款信用卡，入帳時間依發卡機構而異。若選擇退房日線上扣款，且取消時尚未請款，則不適用預訂時付款折扣及手續費。如須支付取消費，將向已登記的信用卡收取該金額。

如因本公司原因無法提供住宿服務，將全額退還受影響服務的已付款項，不扣除取消費、折扣金額或手續費。`
};

export const stayTerms: Record<Locale, { title: string; body: string }> = {
	ja: {
		title: '宿泊約款',
		body: `適用開始日 2026年11月16日。本約款の公開後に成立する予約に適用します。

## 第1条　適用範囲

本約款は、株式会社山人（以下「当社」）が運営する山人-yamado-（岩手県西和賀町）および山人-oga-（秋田県男鹿市）の宿泊契約と、これに付随するサービスに適用します。法令に反しない範囲で当社とお客様が個別に合意した条件は、その合意に従います。

## 第2条　予約の申込みと成立

お申し込みの際は、宿泊者名、連絡先、宿泊日、人数その他予約に必要な事項をお知らせください。契約は当社が申込みを承諾したときに成立します。Bookでは予約確定画面または予約確認通知で成立をお知らせします。

## 第3条　宿泊料金と支払い

宿泊料金、入湯税などの税、追加サービスの料金と支払方法は、予約時またはお申し込み時にお知らせします。お支払いは、選択した方法に応じて予約時、チェックアウト日または施設が案内する時期に行います。会員特典や割引には、それぞれの利用条件が適用されます。

## 第4条　予約の変更・取消・不泊

1. 予約の変更・取消は、予約確認通知に記載された方法でお申し出ください。旅行会社や他の予約サイトからご予約の場合は、予約元へご連絡ください。
2. キャンセル料は予約時に提示する規定に従います。プラン・会員条件や客室ごとに異なる場合は、それぞれ予約時にご案内した条件を適用します。日付と時刻は日本時間です。
3. 両施設とも、宿泊日当日の20時までにご連絡もご到着もない場合は、不泊として取り扱うことがあります。到着が遅れる場合は施設へご連絡ください。ご連絡があった場合の到着時刻の扱いは、施設から個別にご案内します。不泊には、ご予約に適用される不泊の規定が適用されます。

## 第5条　オンライン決済の返金

${publicBookingRefundTerms.ja}

## 第6条　宿泊の受付・契約の解除

宿泊をお断りする場合や成立した契約を解除する場合は、旅館業法その他の関係法令の範囲で、個別の事情と客観的な事実に基づいて判断します。お客様から求められたときは理由を説明します。障害に関する合理的配慮の申し出自体を理由に宿泊をお断りすることはありません。

## 第7条　宿泊者の登録と施設の利用

1. チェックイン時に、法令に従い宿泊者名簿に必要な事項をご登録ください。客室定員とご滞在中の利用規則は、施設の案内に従ってください。
2. 山人-yamado-のチェックインは15時から18時まで、チェックアウトは11時までです。中学生以上の方はご宿泊いただけます。満12歳の中学生の方も含みます。18歳未満の方のみで宿泊される場合は、法定代理人の同意を得たうえで、事前に施設へご連絡ください（[0197-82-2222](tel:0197822222)）。
3. 山人-oga-のチェックインは15時から、チェックアウトは11時までです。18時を過ぎる場合は事前にご連絡ください。13歳未満の方はご宿泊いただけません。18歳未満の方のみで宿泊される場合は、1名につき1通の親権者同意書が必要です（[0185-47-7776](tel:0185477776)）。
4. 両施設ともペットの同伴はご遠慮いただいています。盲導犬、介助犬、聴導犬など法令に基づく身体障害者補助犬は同伴いただけます。

## 第8条　予約した客室を提供できない場合

当社の都合で予約した客室を提供できない場合は速やかにご連絡し、お客様の同意を得て、可能な限り同等の条件で代替の客室または宿泊施設をご案内します。代替をご利用いただけない場合は、提供できないサービスの料金をいただかず、受領済みの対象額を全額返金します。

## 第9条　手荷物・忘れ物と損害

手荷物の事前預かりは、施設が承諾した場合にお受けします。忘れ物は法令に従って取り扱います。当社またはお客様の責めに帰すべき事由で相手方に損害が生じた場合は、法令に従って賠償します。

## 第10条　個人情報と約款の適用

個人情報は[プライバシーポリシー](/legal/privacy)に従って取り扱います。約款を改定する場合は、内容と適用開始日をBookに掲載します。成立済みの予約には、原則として予約時の条件を適用します。`
	},
	en: {
		title: 'Terms and Conditions of Stay',
		body: `Effective November 16, 2026 for reservations confirmed after publication.

## Article 1　Scope

These terms apply to accommodation and related services provided by Yamado Co., Ltd. at yamado in Nishiwaga, Iwate, and oga in Oga, Akita. Any lawful individual agreement takes precedence.

## Article 2　Application and confirmation

Please provide the guest name, contact details, stay dates, party size and other information needed for your reservation. The contract is formed upon our acceptance. For Book reservations, we indicate acceptance on the confirmation screen or in the confirmation notice.

## Article 3　Charges and payment

We show accommodation charges, taxes, additional charges and payment methods when you book or request a service. Depending on the method selected, payment is due at booking, on the check-out date or as advised by the property. Membership benefits and discounts are subject to their respective conditions.

## Article 4　Changes, cancellations and no-shows

Use the method stated in your confirmation to change or cancel your booking. If you booked through an agent or another website, please contact that provider. The cancellation conditions shown at booking apply to each plan, membership offer and room as applicable. All deadlines use Japan Standard Time. At either property, if you have neither contacted us nor arrived by 20:00 on your scheduled arrival date, we may treat your reservation as a no-show under the applicable booking conditions. If you are running late, contact the property for individual arrival instructions.

## Article 5　Online payment refunds

${publicBookingRefundTerms.en}

## Article 6　Refusal of accommodation or termination

Any refusal or termination is decided on the facts and individual circumstances, within the scope allowed by the Hotel Business Act and other applicable laws. We explain the reason on request. A request for reasonable accommodation related to a disability is not in itself grounds for refusal.

## Article 7　Registration and use of the property

Complete the guest registration required by law and follow the property's occupancy limits and house rules. At yamado, check-in is from 15:00 to 18:00 and check-out is by 11:00. Guests of junior-high school level or above may stay, including 12-year-olds in junior high school. When all guests are under 18, obtain consent from their legal representatives and contact the property in advance ([+81-197-82-2222](tel:+81197822222)). At oga, check-in starts at 15:00 and check-out is by 11:00. Please call in advance if arriving after 18:00. Guests must be at least 13 years old. When all guests are under 18, each guest needs a signed parental consent form ([+81-185-47-7776](tel:+81185477776)). Neither property accepts pets. Legally recognized assistance dogs are welcome.

## Article 8　If the reserved room is unavailable

If we are unable to provide the reserved room for reasons attributable to us, we will contact you promptly and, with your agreement, try to arrange a comparable room or property. If you cannot use the alternative, you will receive a full refund for the affected services.

## Article 9　Baggage, lost property and damages

We accept advance baggage delivery only with the property's agreement. We handle lost property in accordance with the law. If either party causes damage for which it is responsible, that party is liable as provided by law.

## Article 10　Privacy and application of these terms

We handle personal information under our [Privacy Policy](/en/legal/privacy). Changes and their effective dates will be posted on Book. Reservations already confirmed remain subject, in principle, to the terms in effect at booking.`
	},
	'zh-TW': {
		title: '住宿契約條款',
		body: `自2026年11月16日起適用於本條款刊登後成立的預約。

## 第1條　適用範圍

本條款適用於株式會社山人經營的山人-yamado-（岩手縣西和賀町）及山人-oga-（秋田縣男鹿市）的住宿契約與附帶服務。雙方另有不違反法令的個別約定時，依該約定辦理。

## 第2條　申請與契約成立

預約時請提供住宿者姓名、聯絡方式、住宿日期、人數及其他必要資訊。住宿契約於本公司同意申請時成立。使用Book預約時，會透過預約確認畫面或通知告知。

## 第3條　住宿費用與付款

住宿費、稅金、追加服務費及付款方式於預約或申請服務時告知。依所選方式於預約時、退房日或設施告知的時間付款。會員禮遇及折扣適用各自的條件。

## 第4條　預約變更、取消與未入住

請透過預約確認通知載明的方式變更或取消。透過旅行社或其他網站預訂時，請聯絡原預訂管道。各方案、會員優惠或客房適用預約時告知的取消費規定，日期和時間以日本時間為準。兩間設施如於住宿日當天20:00前未收到聯絡，且旅客尚未抵達，得依該筆預約的未入住規定處理。若延遲抵達，請聯絡設施，由設施個別告知抵達安排。

## 第5條　線上付款退款

${publicBookingRefundTerms['zh-TW']}

## 第6條　住宿受理與契約解除

是否拒絕住宿或解除已成立的契約，依旅館業法及其他相關法令，按個別情況與客觀事實判斷。旅客要求時會說明理由。旅客因身心障礙提出合理調整的請求，本身並非拒絕住宿的理由。

## 第7條　住宿登記與設施使用

入住時請依法律規定辦理登記，並遵守客房人數限制與設施使用規則。山人-yamado-的入住時間為15:00至18:00，退房時間為11:00前。國中生及以上可入住，包括12歲的國中生。若住宿者皆未滿18歲，請取得法定代理人同意，並事先聯絡設施（[+81-197-82-2222](tel:+81197822222)）。山人-oga-可於15:00後入住，退房時間為11:00前；如在18:00後抵達，請事先聯絡。未滿13歲恕不接受入住。若住宿者皆未滿18歲，每人須提供一份親權人同意書（[+81-185-47-7776](tel:+81185477776)）。兩間設施均謝絕攜帶寵物，依法認定的輔助犬可同行。

## 第8條　無法提供已預訂的客房

因本公司原因無法提供已預訂的客房時，將儘速聯絡旅客，並在取得同意後盡可能安排同等條件的替代客房或住宿設施。若無法使用替代方案，將全額退還未能提供之服務所收取的款項。

## 第9條　行李、遺失物與損害

設施同意後方可事先寄存行李。遺失物依適用法令處理。因本公司或旅客可歸責事由造成對方損害時，依法承擔賠償責任。

## 第10條　個人資料與適用條款

個人資料依[個人資料保護政策](/zh-TW/legal/privacy)處理。條款修正內容與適用日期將刊載於Book。已成立的預約原則上依預約時的條件辦理。`
	}
};
