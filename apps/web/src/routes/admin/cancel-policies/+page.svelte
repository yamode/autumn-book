<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	// 各グレードの編集状態（ルール行の追加/削除をローカルで扱う）。
	// rate は画面上は % 入力（0〜100）。保存時にサーバーで /100 して fraction 化する。
	function initEditors() {
		return data.policies.map((p) => ({
			rankCode: p.rankCode,
			label: p.label,
			rewardRate: p.rewardRate,
			note: p.note ?? '',
			allowAmendInPenalty: p.allowAmendInPenalty,
			rows: p.rules.map((r) => ({ days: r.days_before, rate: Math.round(r.rate * 100) }))
		}));
	}
	let editors = $state(initEditors());

	function addRow(idx: number) {
		editors[idx].rows = [...editors[idx].rows, { days: 0, rate: 0 }];
	}
	function removeRow(idx: number, row: number) {
		editors[idx].rows = editors[idx].rows.filter((_, i) => i !== row);
	}
</script>

<svelte:head><title>キャンセル規定 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">グレード別キャンセル料規定</h1>
<p class="mb-4 max-w-3xl text-xs text-stone-400">
	会員グレードごとに「チェックイン◯日前から◯%」のキャンセル料ルールを設定します。スタンダード行が非会員・退会者にも適用される基準規定です。
	ルールが空のグレードはキャンセル料がかかりません（現行と同じ挙動）。プラン独自のキャンセル規定があるプランでは、そちらが優先されます。
</p>

{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}

<div class="space-y-4">
	{#each editors as ed, idx (ed.rankCode)}
		<div class="rounded-xl border border-stone-200 bg-white p-4">
			<form method="POST" action="?/save" use:enhance class="text-sm">
				<input type="hidden" name="rankCode" value={ed.rankCode} />
				<div class="flex items-center justify-between">
					<h2 class="font-medium text-stone-800">
						{ed.label}
						<span class="ml-1 text-xs font-normal text-stone-400">（{ed.rankCode}・還元 {Math.round(ed.rewardRate * 100)}%）</span>
					</h2>
					{#if form?.saved === ed.rankCode}<span class="text-xs text-emerald-600">✔ 保存しました</span>{/if}
				</div>

				<!-- ルール表（◯日前から◯%） -->
				<div class="mt-3 space-y-2">
					{#if ed.rows.length === 0}
						<p class="text-xs text-emerald-700">キャンセル料はかかりません（ルール未設定）。</p>
					{/if}
					{#each ed.rows as row, ri (ri)}
						<div class="flex flex-wrap items-center gap-2 text-sm">
							<span class="text-stone-400">チェックイン</span>
							<input
								type="number"
								name="days"
								bind:value={row.days}
								min="0"
								class="w-20 rounded-md border border-stone-300 px-2 py-1.5 text-right"
							/>
							<span class="text-stone-500">日前から</span>
							<input
								type="number"
								name="rate"
								bind:value={row.rate}
								min="0"
								max="100"
								class="w-20 rounded-md border border-stone-300 px-2 py-1.5 text-right"
							/>
							<span class="text-stone-500">%</span>
							<button
								type="button"
								onclick={() => removeRow(idx, ri)}
								class="ml-1 text-xs text-red-500 hover:underline">削除</button
							>
						</div>
					{/each}
					<button
						type="button"
						onclick={() => addRow(idx)}
						class="rounded-md border border-stone-300 px-3 py-1 text-xs text-stone-600 hover:bg-stone-50">＋ 行を追加</button
					>
				</div>

				<!-- ペナルティ期間内の日程変更許可 -->
				<label class="mt-3 flex items-center gap-2 text-xs text-stone-600">
					<input type="checkbox" name="allowAmendInPenalty" bind:checked={ed.allowAmendInPenalty} class="h-4 w-4" />
					キャンセル料発生期間内でも宿泊日の変更を許可する（グレード特典）
				</label>

				<!-- 説明文（会員向け・/membership 表示） -->
				<label class="mt-3 block text-xs text-stone-500">
					説明文（会員向け表示・任意）
					<input
						name="note"
						bind:value={ed.note}
						placeholder="例：ゴールド会員は7日前まで無料"
						class="mt-1 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-800"
					/>
				</label>

				<button type="submit" class="mt-3 rounded-md bg-brand-800 px-4 py-1.5 text-xs text-white hover:bg-brand-700">保存</button>
			</form>
		</div>
	{/each}
</div>
