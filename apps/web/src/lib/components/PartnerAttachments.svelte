<script lang="ts">
  // 取引先予約の添付ファイル欄（2026-10-07・設計 docs/partner-booking-attachments.md §10）。
  // 取引先ページの予約入力（仮置き）・予約一覧と、Book の管理画面の予約詳細で同じ部品を使う。
  //   - ドロップ／ファイル選択で 1 件ずつ順に上げる（1リクエスト1ファイル・サーバ中継）。複数選んでも順番に送る
  //   - 削除は確認のうえ DELETE（各行の href）。消せない行には削除ボタンを出さない（サーバでも同じ条件で断る）
  //   - notifyUrl があれば、追加・削除が一区切りついたところで1回だけ「宿（PMS）へ知らせる」を呼ぶ
  // 種類・サイズ・件数はサーバが決める。ここでも同じ純関数で先に確かめて、送る前に理由を出す。
  import { checkAttachmentFile } from '$lib/partner-attachments';

  export type AttachmentItem = {
    id: string;
    fileName: string;
    mime: string;
    bytes: number;
    size: string;
    uploader: string;
    byPartner: boolean;
    createdAt: string;
    canDelete: boolean;
    href: string;
  };

  let {
    items = $bindable([]),
    uploadUrl = null,
    notifyUrl = null,
    accept,
    hint,
    note = null,
    showUploader = true,
    notifiedText = '宿（PMS）へは数分以内に反映されます。',
    onchange
  }: {
    items?: AttachmentItem[];
    /** null なら追加できない（ドロップ枠を出さない） */
    uploadUrl?: string | null;
    /** 追加・削除のあとに1回呼ぶ通知の URL（予約入力の仮置きは null） */
    notifyUrl?: string | null;
    accept: string;
    hint: string;
    /** 追加できない理由など（枠の代わりに出す） */
    note?: string | null;
    /** 誰が・いつを出すか（予約入力では自分が上げたものだけなので出さない） */
    showUploader?: boolean;
    notifiedText?: string;
    onchange?: (items: AttachmentItem[]) => void;
  } = $props();

  type Job = { key: number; name: string; status: 'waiting' | 'uploading' | 'error'; message: string };
  let jobs = $state<Job[]>([]);
  let dragging = $state(false);
  let deleting = $state<string | null>(null);
  let message = $state('');
  let notice = $state('');
  let inputEl: HTMLInputElement | undefined = $state();
  let seq = 0;
  // 通知の材料（一区切りまでに追加・削除したファイル名）
  let added: string[] = [];
  let removed: string[] = [];
  let chain: Promise<void> = Promise.resolve();
  let running = 0;

  const dt = (iso: string) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' });
  const icon = (mime: string) => (mime === 'application/pdf' ? '📄' : mime.startsWith('image/') ? '🖼️' : mime.includes('sheet') || mime.includes('excel') || mime === 'text/csv' ? '📊' : '📎');

  function setItems(next: AttachmentItem[]) {
    items = next;
    onchange?.(next);
  }

  function addFiles(list: FileList | File[] | null | undefined) {
    if (!uploadUrl || !list) return;
    message = '';
    for (const file of Array.from(list)) {
      const key = ++seq;
      jobs = [...jobs, { key, name: file.name, status: 'waiting', message: '' }];
      running += 1;
      // 1件ずつ順に送る（同時に送ると件数・合計の検査がすり抜ける・Worker のメモリを使い切らない）
      chain = chain.then(() => uploadOne(key, file)).finally(() => {
        running -= 1;
        if (running === 0) void flushNotify();
      });
    }
    if (inputEl) inputEl.value = '';
  }

  const patchJob = (key: number, p: Partial<Job>) => (jobs = jobs.map((j) => (j.key === key ? { ...j, ...p } : j)));

  async function uploadOne(key: number, file: File) {
    // 送る前の検査（サーバも同じ規則で確かめる）
    const pre = checkAttachmentFile(file, { count: items.length, bytes: items.reduce((s, a) => s + a.bytes, 0) });
    if (!pre.ok) {
      patchJob(key, { status: 'error', message: pre.message });
      return;
    }
    patchJob(key, { status: 'uploading' });
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch(uploadUrl as string, { method: 'POST', body: fd });
      if (res.status === 401) {
        location.reload();
        return;
      }
      const j = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; attachment?: AttachmentItem } | null;
      if (!res.ok || !j?.ok || !j.attachment) {
        patchJob(key, { status: 'error', message: j?.message || 'アップロードできませんでした。時間をおいてお試しください。' });
        return;
      }
      setItems([...items, j.attachment]);
      added.push(j.attachment.fileName);
      jobs = jobs.filter((x) => x.key !== key);
    } catch {
      patchJob(key, { status: 'error', message: '通信できませんでした。通信状況をご確認ください。' });
    }
  }

  async function remove(a: AttachmentItem) {
    if (!confirm(`「${a.fileName}」を削除しますか？`)) return;
    deleting = a.id;
    message = '';
    try {
      const res = await fetch(a.href, { method: 'DELETE' });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!res.ok || !j?.ok) {
        message = j?.message || '削除できませんでした。';
        return;
      }
      setItems(items.filter((x) => x.id !== a.id));
      removed.push(a.fileName);
      if (running === 0) await flushNotify();
    } catch {
      message = '通信できませんでした。通信状況をご確認ください。';
    } finally {
      deleting = null;
    }
  }

  // 追加・削除が一区切りついたら1回だけ知らせる（PMS へは attachments 電文・取込は毎分）
  async function flushNotify() {
    if (!notifyUrl || (!added.length && !removed.length)) return;
    const body = { added, removed };
    added = [];
    removed = [];
    try {
      const res = await fetch(notifyUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; sent?: boolean } | null;
      // 送れなくても、未通知の変化は掃除の cron が知らせ直す
      notice = res.ok && j?.ok ? (j.sent ? notifiedText : '') : '';
      if (notice) setTimeout(() => (notice = ''), 6000);
    } catch {
      // 同上
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    addFiles(e.dataTransfer?.files);
  }
</script>

<div class="grid gap-2">
  {#if items.length}
    <ul class="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
      {#each items as a (a.id)}
        <li class="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
          <span aria-hidden="true">{icon(a.mime)}</span>
          <a href={a.href} target="_blank" rel="noopener" class="min-w-0 truncate font-medium text-sky-700 hover:underline">{a.fileName}</a>
          <span class="text-xs text-stone-500">{a.size}</span>
          {#if showUploader}<span class="text-xs text-stone-500">{a.uploader}・{dt(a.createdAt)}</span>{/if}
          <span class="ml-auto flex items-center gap-1.5">
            <a href={a.href} download={a.fileName} class="rounded border border-stone-300 px-2 py-0.5 text-xs hover:bg-stone-50">ダウンロード</a>
            {#if a.canDelete}
              <button type="button" onclick={() => remove(a)} disabled={deleting === a.id} class="rounded border border-rose-300 px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50">{deleting === a.id ? '削除中…' : '削除'}</button>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#each jobs as j (j.key)}
    <p class={`rounded-lg px-3 py-1.5 text-sm ${j.status === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-stone-50 text-stone-600'}`}>
      {j.name}: {j.status === 'error' ? j.message : j.status === 'uploading' ? 'アップロード中…' : '順番を待っています…'}
      {#if j.status === 'error'}<button type="button" onclick={() => (jobs = jobs.filter((x) => x.key !== j.key))} class="ml-2 text-xs underline">閉じる</button>{/if}
    </p>
  {/each}

  {#if uploadUrl}
    <!-- ドロップ枠（クリック・Enter でもファイルを選べる） -->
    <label
      class={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition ${dragging ? 'border-[var(--pt-accent,#0369a1)] bg-sky-50' : 'border-stone-300 hover:bg-stone-50'}`}
      ondragover={(e) => {
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={onDrop}
    >
      <span class="font-medium">ここにファイルをドロップ、または<span class="text-sky-700 underline">ファイルを選ぶ</span></span>
      <span class="text-xs text-stone-500">{hint}</span>
      <input bind:this={inputEl} type="file" multiple {accept} class="sr-only" onchange={(e) => addFiles((e.currentTarget as HTMLInputElement).files)} />
    </label>
  {:else if note}
    <p class="text-sm text-stone-500">{note}</p>
  {/if}
  {#if !items.length && !uploadUrl && !note}<p class="text-sm text-stone-500">添付ファイルはありません。</p>{/if}

  {#if message}<p class="text-sm text-rose-700">{message}</p>{/if}
  {#if notice}<p class="rounded-lg bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800" role="status">✓ {notice}</p>{/if}
</div>
