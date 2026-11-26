<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { SNIPPET_VARIABLES } from '$lib/inquiry-snippets';
	let { data, form } = $props();
	let open = $state<string | null>(null);
</script>

<svelte:head><title>返信の定型文 | お問い合わせ</title></svelte:head>
<section class="snippets">
	<a class="back" href="/admin/inquiries">← お問い合わせ</a>
	<header>
		<h1>返信の定型文</h1>
		<span>山人-yamado-</span>
	</header>
	<p class="lead">
		返信を書く欄で <kbd>/</kbd> を打つと、ここに登録した定型文を探して差し込めます。
		本文には {SNIPPET_VARIABLES.map((v) => `{${v}}`).join('・')} を書けます。分からないときは【要確認】が残り、直すまで送信できません。
	</p>
	{#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
	{#if form?.done}<p class="success" role="status">{form.done}</p>{/if}

	<form class="card new" method="POST" action="?/save" use:enhance data-reset>
		<h2>新しい定型文</h2>
		<label>名前<input name="title" maxlength="80" required placeholder="例：駐車場のご案内" /></label>
		<label>本文<textarea name="body" rows="6" maxlength="10000" required placeholder={'{お名前}\n\nお問い合わせいただき、ありがとうございます。'}></textarea></label>
		<footer><label class="sort">並び順<input name="sort" type="number" value="0" /></label><button>追加する</button></footer>
	</form>

	<ul class="list">
		{#each data.snippets as s (s.id)}
			<li class="card">
				{#if open === s.id}
					<form method="POST" action="?/save" use:enhance={() => async ({ result, update }) => { await update({ reset: false }); if (result.type === 'success') open = null; }}>
						<input type="hidden" name="id" value={s.id} />
						<label>名前<input name="title" maxlength="80" required value={s.title} /></label>
						<label>本文<textarea name="body" rows="8" maxlength="10000" required value={s.body}></textarea></label>
						<footer>
							<label class="sort">並び順<input name="sort" type="number" value={s.sort_order} /></label>
							<button type="button" class="quiet" onclick={() => (open = null)}>やめる</button>
							<button>保存する</button>
						</footer>
					</form>
					<form method="POST" action="?/delete" use:enhance class="delete" onsubmit={(e) => { if (!confirm(`「${s.title}」を消しますか？`)) e.preventDefault(); }}>
						<input type="hidden" name="id" value={s.id} /><button class="danger">この定型文を消す</button>
					</form>
				{:else}
					<button class="row" onclick={() => (open = s.id)}>
						<strong>{s.title}</strong>
						<span>{s.body.replace(/\s+/g, ' ').slice(0, 120)}</span>
					</button>
				{/if}
			</li>
		{:else}
			<li class="empty">まだ定型文はありません。上の欄から追加するか、返信を書く画面の「この本文を定型文に保存」から登録できます。</li>
		{/each}
	</ul>
</section>

<style>
	.snippets { max-width: 860px; margin: auto; color: #304438; }
	.back { font-size: .78rem; color: #7b8b6e; }
	header { display: flex; align-items: center; gap: 1rem; margin: 1.5rem 0 .8rem; }
	h1 { font-size: 1.6rem; font-weight: 650; }
	header > span { font-size: .7rem; color: #7e8e71; border: 1px solid #dbe3d3; border-radius: 1rem; padding: .3rem .7rem; }
	.lead { font-size: .85rem; line-height: 1.9; color: #5c6e55; margin-bottom: 1.2rem; }
	kbd { border: 1px solid #ccd6c3; border-bottom-width: 2px; border-radius: 4px; padding: 0 .35rem; background: #fff; font-family: inherit; }
	.card { background: #fff; border: 1px solid #e0e7d9; border-radius: .9rem; padding: 1.1rem 1.2rem; }
	.new { margin-bottom: 1.4rem; }
	h2 { font-size: .95rem; font-weight: 600; margin-bottom: .6rem; }
	label { display: grid; gap: .35rem; font-size: .78rem; color: #5c6e55; margin-bottom: .7rem; }
	input, textarea { font-size: .9rem; border: 1px solid #d5ddce; border-radius: .5rem; padding: .55rem .7rem; line-height: 1.7; }
	footer { display: flex; align-items: center; gap: .6rem; justify-content: flex-end; }
	.sort { display: flex; align-items: center; gap: .4rem; margin: 0 auto 0 0; }
	.sort input { width: 5rem; }
	button { font-size: .82rem; border-radius: .5rem; padding: .5rem 1rem; background: #49633e; color: #fff; }
	.quiet { background: #fff; color: #5c6e55; border: 1px solid #d5ddce; }
	.danger { background: #fff; color: #a2533f; border: 1px solid #ead1c9; font-size: .75rem; }
	.delete { margin-top: .6rem; display: flex; justify-content: flex-end; }
	.list { display: grid; gap: .6rem; }
	.row { display: grid; gap: .3rem; text-align: left; width: 100%; background: none; color: inherit; padding: 0; }
	.row strong { font-size: .9rem; font-weight: 600; }
	.row span { font-size: .78rem; color: #788570; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.empty { font-size: .82rem; color: #788570; padding: 1.5rem; text-align: center; }
	.error { color: #a2533f; font-size: .82rem; margin-bottom: .8rem; }
	.success { color: #49633e; font-size: .82rem; margin-bottom: .8rem; }
</style>
