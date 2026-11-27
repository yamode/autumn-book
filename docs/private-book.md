# プライベートブック（特別会員を公式サイトの中で扱う）— 設計メモ

2026-11-27 決定。特別会員（VIP・PMS の顧客マスタで VIP を付けた方＝ランク platinum）の予約を、
専用ページ（B面 `/p/[token]`）ではなく **公式サイト（A面 `(public)`）の中の「プライベートブックの状態」** として作り直す。
B面 `/p/[token]` は取引先（旅行会社・法人）専用に戻す。前提の経緯は `vip-member-page.md`（§13〜14）。

## 決まっていること（ユーザーの判断）

- 名称は「プライベートブック」。メインメニューのボタンは英字の `PRIVATE BOOK`。画面の言葉は「特別料金でご案内しています」。ランク名（プラチナ）は出さない。
- ゴールドなど通常の会員ランクは別扱い（プライベートブックとは関係ない）。
- 対象: VIP の会員本人と、専用ページに招待されたご家族（rms_partner_members・家族のつながり＝`memberPageAccess`）。
- **ブランド内の全施設が対象**。どの施設のどのプランを特別料金で出すかは、専用ページの料金ルール（RMS の取引先料金）で決まる。
  専用ページは全施設で販売する設定で作る（今ある石田様・楊様のページも全施設をオンにする）。
- 対象外の施設・日程・プランは **ふつうの料金で出し**、「この施設はふつうの料金です」のように添える（隠さない）。
- 本人のページとご家族のページが両方あるときは **本人のページを自動で選ぶ**（帯から切り替えられるのが望ましい）。
- **早期決済（事前決済）の割引は特別料金に重ねる**。さらに、特別会員だけ早期決済の割引率と期間を別に決められるようにする（全特別会員で一律の設定）。
- 対象から外れた方（VIP を外した・家族の招待を外した）も、**外れる前の予約を取り消せる**ようにする（DB の変更が要る）。
- 管理者の確認モード（専用ページの「確認ページを開く」）は当面 B面に残す。

## 状態の持ち方

- クッキー `ab_private_book`（中身は専用ページの partnerId だけ・httpOnly・path=/・セッション限り）。
- **クッキーは信用しない**。`lib/server/private-book.ts` の `resolvePrivateBook(event)` で、リクエストのたびに
  会員ログイン（`locals.user.role==='member'`）・`memberPageAccess`（store.ts）・kind='member'・`partnerUnavailableReason` 無し を確かめる。
  結果は hooks で `locals.privateBook` に1回だけ入れる。通らなければクッキーを消す。ログアウトでも消す。
- 入口 `(public)/private-book/+server.ts`: `?page=` が無ければ `memberPagesFor`（store.ts）から本人→家族の順で選ぶ。クッキーを書いて元の画面（無ければ `/search`）へ。
- 出口 `/private-book/off`（POST）: クッキーを消して同じ画面へ。hold の中からなら仮押さえを解放。
- 施設ごと: `loadPartnerContextAt(db, partnerId, facilityId)` で `memberPageBookingOpen` が真の施設だけ特別料金。偽ならその施設はふつうの料金。
- 表示: `(public)/+layout.server.ts` の privateBookHref を入口 URL に替え、状態（pbActive・ページ名）を返す。状態のときヘッダーの `PRIVATE BOOK` を塗りつぶし、予約手続き以外に帯「○○様のプライベートブック　特別料金でご案内しています ｜ ふつうのご予約に戻る」（部品 `lib/components/booking/PrivateBookBand.svelte`）。プラン一覧・詳細では PC のマイページ左、スマートフォンのヘッダー下に「専用料金」の ON/OFF を出す。押すと表示が先に切り替わり、料金は画面の再読み込みなしで更新する。プラン詳細の料金カレンダーは開いたときに取得する。プラン一覧は通常料金も含めて表示し、「専用料金のプランのみ」で絞り込める。詳細の料金欄では適用時に「専用料金」を表示する（v0.360.3）。

## 画面ごとの差し替え

- `private-book.ts` に、A面と同じ形の値を返す関数を置く（例 `privateBookOffers(ctx, checkin, nights, adults)` → `PlanOffer[]` と同じ形）。
  `loadPartnerRates`（rates.ts）で泊ごとの `pricesPerPerson[adults]×adults` を足して total、perPerson は round(total÷(人数×泊数))。
  対象は `loadMemberPagePlans`（member-hold.ts）と料金ルールの両方にあるプラン。残室は `roomTypeRemaining`（booking.ts）。
  日数・締切・公開期間は `quotePartnerBooking`（booking.ts）と同じ条件（canBookFor・maxNights・clampPartnerRange）。
- A面は ID（rate_plan / room_type の UUID）、B面はコード（PMS の部屋コード・`planCode■planName`）で動く。対応は `loadMemberPagePlans` と pms.room_types で取る。
- プラン一覧 `plans/+page.server.ts`・プラン詳細 `plans/[plan]/+page.server.ts`・検索（supabase-data.ts の検索結果のうち対象施設の最安）・料金カレンダー／空室カレンダー（新しく `/api/private-book/stay-calendar`・no-store。`/api/stay-calendar` は CORS とブラウザキャッシュがあるので使わない）。
- かご: `BookingCart`（props で送り先・保存キー・注記を変えられる）を使い、保存キーは `ab_booking_cart_v1:pb:<partnerId>`（通常のかごと混ぜない）。
- hold: プラン詳細の `?/hold` で、状態が有効な施設なら `createHoldGroup` の代わりに特別会員の束（`create_member_page_hold_group`）を作る。
  `memberPageHold`（member-hold.ts）の中身を `member.userId` だけで呼べる `createMemberPageHoldCore` に切り出す。
  **hold の action ではクッキーを信じず `resolvePrivateBook` をやり直し、料金は `quoteMemberRooms` で計算し直す（画面の金額は受け取らない）**。
- 予約入力: 予約内容に「専用料金」を表示し、専用特典があるときはその内容を表示する。ポイントは支払いと予約内容の欄、キャンセル条件はキャンセルポリシーの欄に表示する（v0.360.3）。完了画面のリンクは `/account/reservations/<code>` へ。
- 確定・確認メール・PMS 連携は今のまま（特別会員の予約は公式の予約の束 `bookings.metadata.member_page` で、rms_partner_bookings は使わない）。

## マイページ（予約後）

- 予約一覧に「プライベートブック」の印（`memberPage` を見る）。
- `account/reservations/[code]` の `denyMemberPageBooking` で断っているのをやめ、専用ページ経由の予約は B面の server（`p/[token]/bookings/[id]/**`）を下敷きに、
  取消（memberPageCancelBooking / memberPageCancelBookingRoom → refundAfterCancel）・日程変更（memberPageQuoteAmendDates / memberPageAmendDates）・
  部屋の変更（memberRoomCandidates・memberPageQuoteAmendRooms・memberPageAmendRooms）・アレンジ（memberPageAddOptions）へ分岐する。
- `booking/ReservationDetail.svelte` の「見るだけ」を外す。

## 安全

- 関所は3か所: DB（束を作る RPC が対象者を確かめる・取消変更は `_member_page_booking_check`）、サーバ（hold で状態と料金をやり直す）、料金表示は no-store。
- 対象から外れた方の取消: `_member_page_booking_check` などが「今ページを使えるか」を見ているので、取消だけは「予約した本人なら通す」に DB を直す。

## B面の特別会員の道を畳む（最後の段）

- `resolvePortal`（portal.ts）の `isMemberPage` 分岐の中だけで、確認モード以外を転送する:
  `/`・`/calendar`・`/plans`・`/rooms`・`/book` → `/private-book?page=<id>`、`/bookings` → `/account/reservations`、`/bookings/<code>…` → `/account/reservations/<code>…`、POST は 410。
- 取引先の分岐（kind が member 以外）には触れない。
- その後、`MemberBookingList`・`PartnerStaySearch` の会員の分岐など使わなくなった部品を消す。

## 作る順番

1. 入口・出口・帯・ボタン（料金はまだ通常）
2. プラン一覧・詳細・カレンダー・検索を特別料金に、hold を特別会員の束へ
3. かご・complete のリンク
4. マイページの取消・日程変更・部屋の変更・アレンジ、外れた方の取消（DB）
5. B面の特別会員の道を転送に替え、要らない部品を消す
   → **v0.356.0 で実施**。`resolvePortal`（portal.ts）の `isMemberPage` 分岐で、確認モード（署名付きクッキー）でなければ `memberPortalForward`（`lib/private-book.ts`・純関数）の行き先へ 303: 料金・予約の画面（`/`・`/calendar`・`/plans`・`/rooms`・`/rate-sheet`・`/book` など）は `/private-book?page=<partnerId>`、`/bookings` は `/account/reservations`、`/bookings/<予約番号>`（`/amend`・`/amend/room/<n>`・`/options`）は `/account/reservations/<予約番号>` の同じ形。GET / HEAD 以外は 410。取引先（kind が member 以外）は分岐に入らない。DB が作る `member_page_url`（確定メール・ゲスト取消の照会の `/p/<token>/bookings/<予約番号>`）は転送でそのまま動く（migration は作っていない）。アプリ側はゲスト取消画面の案内を `memberPageUrlToAccount` でマイページへ、マイページの「プライベートブック」の入口を `/private-book?page=` へ替えた。**消したもの**: 会員ログインの解決（`resolvePortalMember`・`memberSession`・`memberState`）とログイン画面の会員の案内、layout の会員ヘッダー・帯・かごバー、`PartnerBookingCart.svelte`・`member-cart.svelte.ts`、`PartnerStaySearch` の会員のかご・特典の 2 段目、`MemberBookingList.svelte`、`bookings/[id]` の member 版の詳細・`amend`・`options`（取引先の添付 `bookings/[id]/attachments` は残す）、`/book` の member 版 POST（`memberPageHold`・`memberHoldBack`）、`memberPageBookingOf`・`memberPageHrefFor`・`memberPageHrefOf`・`memberPageCalendarHrefOf`。**残したもの**（確認モードで使う・まだ参照がある）: 確認モードのメニュー・近日販売の案内・`/book` GET の `memberBookRedirect`・`/bookings` の確認モードの案内文、`stay-page.ts` の会員の値（`memberBenefits`・`cartPlans`・`memberCancel`）と `PartnerPlanDetailView` の会員の props、`partner-member-page.ts` のかごの型と `parseMemberHoldRooms`（テストあり）、完了画面の古いかご（`ab_member_cart_v1`）の後始末。
並行: 特別会員の早期決済の割引率・期間の設定（全特別会員で一律）
