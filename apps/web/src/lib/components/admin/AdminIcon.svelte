<script lang="ts" module>
	// 管理画面の線画アイコン（2026-10-17 管理画面のモダン化。絵文字の代わり）。
	// 24×24・線 1.75・角丸の線画。形は Lucide（ISC ライセンス）にならった最小限の自前のセット（依存を増やさない）。
	export const ADMIN_ICONS = {
		dashboard: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
		calendar: ['M8 2v4', 'M16 2v4', 'M3 9h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
		users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
		upgrade: ['M12 19V5', 'M5 12l7-7 7 7'],
		partner: ['M3 21h18', 'M5 21V7l7-4 7 4v14', 'M9 21v-6h6v6', 'M9 10h.01', 'M15 10h.01'],
		phone: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M11 18h2'],
		bath: ['M4 12h16v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z', 'M6 12V5a2 2 0 0 1 3.4-1.4', 'M8 20l-1 2', 'M16 20l1 2'],
		plan: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h5'],
		rules: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6l1 1 2-2', 'M4 12l1 1 2-2', 'M4 18l1 1 2-2'],
		member: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
		globe: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M2 12h20', 'M12 2a15 15 0 0 1 0 20', 'M12 2a15 15 0 0 0 0 20'],
		shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'],
		chevron: ['M9 6l6 6-6 6'],
		menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
		close: ['M6 6l12 12', 'M18 6L6 18'],
		logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
		external: ['M15 3h6v6', 'M10 14L21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
		megaphone: ['M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z', 'M17 9a4 4 0 0 1 0 6', 'M20 6a8 8 0 0 1 0 12'],
		droplet: ['M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12z'],
		receipt: ['M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z', 'M9 7h6', 'M9 11h6', 'M9 15h4'],
		ticket: ['M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-2a2 2 0 0 1 0-4 2 2 0 0 1 0-4V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z', 'M14 5v14'],
		settings: ['M4 6h10', 'M18 6h2', 'M4 12h4', 'M12 12h8', 'M4 18h12', 'M20 18h0', 'M16 4v4', 'M10 10v4', 'M18 16v4'],
		eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
		chart: ['M3 3v18h18', 'M7 15l4-4 3 3 5-6'],
		book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z', 'M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5'],
		qr: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h3v3h-3z', 'M20 14v.01', 'M14 20h.01', 'M17 20h4v-3']
	} as const;
	export type AdminIconName = keyof typeof ADMIN_ICONS;
</script>

<script lang="ts">
	let { name, class: cls = 'h-4 w-4' }: { name: AdminIconName; class?: string } = $props();
</script>

<svg viewBox="0 0 24 24" class={cls} fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	{#each ADMIN_ICONS[name] as d (d)}<path {d} />{/each}
</svg>
