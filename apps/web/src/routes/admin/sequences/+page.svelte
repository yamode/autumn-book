<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const offsetOptions = [
		{ v: -7, label: 'チェックイン7日前' },
		{ v: -3, label: 'チェックイン3日前' },
		{ v: -1, label: 'チェックイン前日' },
		{ v: 1, label: 'チェックアウト翌日' },
		{ v: 3, label: 'チェックアウト3日後' }
	];

	function offsetLabel(d: number) {
		return offsetOptions.find((o) => o.v === d)?.label ?? (d < 0 ? `${-d}日前` : `${d}日後`);
	}
</script>

<svelte:head><title>ステップメール ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">ステップメール — {data.currentFacility.name}</h1>
<p class="mb-4 text-xs text-stone-400">
	予約確定を起点に、チェックイン日基準で自動配信します（毎朝バッチ）。キャンセル済み予約には送信されません。直前予約は過ぎたステップを自動スキップします。
</p>

{#if form?.tested}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">テストメールを送信しました（デモ）。</p>{/if}
{#if (form as { message?: string } | null)?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(form as { message?: string }).message}</p>{/if}

{#each data.sequences as seq}
	<section class="mb-6 rounded-xl border border-stone-200 bg-white">
		<header class="flex items-center justify-between border-b border-stone-100 px-5 py-3">
			<h2 class="font-medium text-stone-800">{seq.name}</h2>
			<form method="POST" action="?/toggle" use:enhance>
				<input type="hidden" name="sequenceId" value={seq.id} />
				<button type="submit" class="rounded-full px-3 py-1 text-xs font-medium {seq.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}">
					{seq.isActive ? '✔ 稼働中（クリックで停止）' : '停止中（クリックで稼働）'}
				</button>
			</form>
		</header>

		<div class="divide-y divide-stone-100">
			{#each seq.steps as step}
				<details class="px-5 py-3">
					<summary class="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
						<span class="rounded bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">{offsetLabel(step.offsetDays)} {step.sendHour}:00</span>
						<span class="font-medium">{step.title}</span>
						{#if form?.savedStep === step.id}<span class="text-xs text-emerald-600">✔ 保存済み</span>{/if}
					</summary>
					<form method="POST" action="?/saveStep" use:enhance class="mt-3 space-y-2">
						<input type="hidden" name="sequenceId" value={seq.id} />
						<input type="hidden" name="stepId" value={step.id} />
						<div class="flex flex-wrap gap-3 text-sm">
							<label class="flex items-center gap-1.5">
								タイミング
								<select name="offsetDays" class="rounded-md border border-stone-300 px-2 py-1">
									{#each offsetOptions as o}
										<option value={o.v} selected={o.v === step.offsetDays}>{o.label}</option>
									{/each}
								</select>
							</label>
							<label class="flex items-center gap-1.5">
								送信時刻
								<select name="sendHour" class="rounded-md border border-stone-300 px-2 py-1">
									{#each [8, 9, 10, 11, 12, 15, 17, 19] as h}
										<option value={h} selected={h === step.sendHour}>{h}:00</option>
									{/each}
								</select>
							</label>
						</div>
						<label class="block text-sm">
							<span class="text-xs text-stone-500">件名</span>
							<input name="title" value={step.title} class="mt-0.5 w-full rounded-md border border-stone-300 px-3 py-1.5" />
						</label>
						<label class="block text-sm">
							<span class="text-xs text-stone-500">本文（差込変数: {'{氏名} {チェックイン時刻} {部屋名} {プラン名}'}）</span>
							<textarea name="body" rows="4" class="mt-0.5 w-full rounded-md border border-stone-300 px-3 py-1.5 font-mono text-xs">{step.body}</textarea>
						</label>
						<div class="flex gap-2">
							<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-xs text-white hover:bg-brand-700">保存</button>
							<button formaction="?/testStep" class="rounded-md border border-stone-300 px-4 py-1.5 text-xs hover:bg-stone-50">テスト送信</button>
						</div>
					</form>
				</details>
			{/each}
		</div>
	</section>
{/each}

<p class="text-xs text-stone-400">送信ログ（email_sends：予約×ステップで一意・重複送信なし）は P7 実装時にここへ表示します。</p>
