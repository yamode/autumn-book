<svelte:head>
	<title>YAMADO AIコネクター | 山人Book</title>
	<meta name="description" content="山人BookのAIコネクター YAMADO の接続・空室検索・解除の方法。" />
</svelte:head>

<article class="mx-auto max-w-3xl space-y-7 px-4 py-10">
	<img src="/brand/yamado-connector.png" alt="" width="64" height="64" class="rounded-lg" />
	<h1 class="font-display text-2xl text-brand-900">YAMADO AIコネクター</h1>
	<p>Claudeから、岩手県西和賀町の山人-yamado-と秋田県男鹿市の山人-oga-の空室・宿泊料金を検索できます。対象の現地払いプランは、予約対応の連携から確認カードで確定できます。</p>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Claudeと山人Bookを連携する</h2>
		<ol class="list-decimal space-y-2 pl-5">
			<li>Claudeの「カスタマイズ」からコネクターを開き、「YAMADO」を選びます。</li>
			<li>山人Bookの会員メールアドレスと確認コードでログインし、連携を許可します。会員登録がまだの場合は、画面の案内に従って登録してください。</li>
			<li>Claudeの会話で「12月21日から1泊、大人2名で西和賀と男鹿の空室と料金を比較して」のように依頼します。</li>
		</ol>
		<details>
			<summary class="cursor-pointer">カスタムコネクターとして追加する場合</summary>
			<p class="mt-2">表示名は <strong>YAMADO</strong> です。「独自のOAuthクライアントを使用する」を選び、クライアントシークレットは空欄にします。</p>
			<ul class="mt-2 list-disc space-y-2 pl-5">
				<li>予約対応は <code>https://book.yamado.app/mcp/reservations</code>、クライアントIDは <code>autumn-book-claude-reservations</code> です。新たに予約の権限に同意してください。</li>
				<li>検索とBookへの引き継ぎは <code>https://book.yamado.app/mcp</code>、クライアントIDは <code>autumn-book-claude</code> です。</li>
			</ul>
		</details>
		<p>山人Bookが一般公開前の場合は、プレビューをご案内した方が利用できます。</p>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">空室・料金と予約</h2>
		<p>検索はチェックイン日を指定し、大人1〜6名、1室、1〜7泊が対象です。料金は指定人数・全泊分の宿泊料金の見積もりで、残室も検索時点の情報です。</p>
		<p>現地払いの確認カードには、宿泊条件、入湯税込みの料金、取消条件、会員の氏名と確認メールの送付先が表示されます。内容・宿泊約款に同意して「現地払いで予約を確定する」を押すと、山人Bookが予約番号を発行してカードに表示します。予約の確認や取消は山人Bookのマイページで行えます。</p>
		<p>事前カード決済、食事の配慮、ポイントやクーポンの利用、カードが表示されない環境では、公式予約リンクを開いてください。日程・泊数・人数・選んだ客室が山人Bookに引き継がれます。</p>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Museのカスタムコネクター</h2>
		<p>表示名は <strong>YAMADO</strong>、URLは <code>https://book.yamado.app/mcp/muse</code> です。OAuthクライアントIDは <code>autumn-book-muse</code>、シークレットは空欄です。Bookで検索のみ、または検索と現地払い予約の権限を選べます。</p>
		<p>現地払いでは、Museが取得した見積もりから期限付きの確認画面を開き、Bookにログインしたご本人が確定します。Museに戻ると確定状態と予約番号を確認できます。事前カード決済は、日程・人数・客室を引き継いだ山人Bookの予約画面で行います。</p>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">連携の解除と問い合わせ</h2>
		<p>連携は山人Bookの<a href="/account/ai-connections" class="underline">マイページ「AI連携」</a>から解除できます。</p>
		<p>株式会社山人へのお問い合わせは <a href="mailto:info@yamado.co.jp" class="underline">info@yamado.co.jp</a> へご連絡ください。個人情報の取り扱いは<a href="/legal/privacy" class="underline">プライバシーポリシー</a>をご確認ください。</p>
	</section>
</article>
