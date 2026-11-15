<svelte:head>
	<title>YAMADO AIコネクター | 山人Book</title>
	<meta name="description" content="山人BookのAIコネクター YAMADO の接続・空室検索・解除の方法。" />
</svelte:head>

<article class="mx-auto max-w-3xl space-y-7 px-4 py-10">
	<img src="/brand/yamado-connector.png" alt="" width="64" height="64" class="rounded-lg" />
	<h1 class="font-display text-2xl text-brand-900">YAMADO AIコネクター</h1>
	<p>Claudeから、岩手県西和賀町の山人-yamado-と秋田県男鹿市の山人-oga-の空室・宿泊料金を検索できます。宿泊の予約確定やお支払いは、検索結果のリンクから山人Bookで行います。</p>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Claudeと山人Bookを連携する</h2>
		<ol class="list-decimal space-y-2 pl-5">
			<li>Claudeの「カスタマイズ」からコネクターを開き、「YAMADO」を選びます。</li>
			<li>山人Bookの会員メールアドレスと確認コードでログインし、連携を許可します。会員登録がまだの場合は、画面の案内に従って登録してください。</li>
			<li>Claudeの会話で「12月21日から1泊、大人2名で西和賀と男鹿の空室と料金を比較して」のように依頼します。</li>
		</ol>
		<details>
			<summary class="cursor-pointer">カスタムコネクターとして追加する場合</summary>
			<p class="mt-2">表示名は <strong>YAMADO</strong>、MCPサーバーURLは <code>https://book.yamado.app/mcp</code> です。「独自のOAuthクライアントを使用する」を選び、クライアントIDに <code>autumn-book-claude</code> を入力してください。クライアントシークレットは空欄にします。</p>
		</details>
		<p>山人Bookが一般公開前の場合は、プレビューをご案内した方が利用できます。</p>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">空室・料金と予約</h2>
		<p>検索はチェックイン日を指定し、大人1〜6名、1室、1〜7泊が対象です。料金は指定人数・全泊分の宿泊料金の見積もりで、残室も検索時点の情報です。公式予約リンクを開くと、日程・泊数・人数・選んだ客室が山人Bookに引き継がれます。最終金額と取消条件は山人Bookでご確認ください。</p>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">連携の解除と問い合わせ</h2>
		<p>Claudeには検索条件・空室数・対象プラン・料金・公式予約リンクが返ります。連携は山人Bookの<a href="/account/ai-connections" class="underline">マイページ「AI連携」</a>から解除できます。</p>
		<p>株式会社山人へのお問い合わせは <a href="mailto:info@yamado.co.jp" class="underline">info@yamado.co.jp</a> へご連絡ください。個人情報の取り扱いは<a href="/legal/privacy" class="underline">プライバシーポリシー</a>をご確認ください。</p>
	</section>
</article>
