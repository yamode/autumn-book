<script lang="ts">
	import { onMount } from 'svelte';
	import 'maplibre-gl/dist/maplibre-gl.css';

	export interface MapItem {
		id: string;
		lat: number;
		lng: number;
		label: string; // バッジ表示（例: ¥23,100〜 / 満室）
		name: string;
		soldOut?: boolean;
		href?: string;
	}

	let {
		items,
		height = '480px',
		highlighted = null,
		onpinclick
	}: {
		items: MapItem[];
		height?: string;
		highlighted?: string | null;
		onpinclick?: (id: string) => void;
	} = $props();

	let container: HTMLDivElement;
	let markers: { id: string; el: HTMLElement }[] = [];

	onMount(() => {
		let map: import('maplibre-gl').Map | undefined;
		let cancelled = false;
		(async () => {
			const maplibregl = (await import('maplibre-gl')).default;
			if (cancelled) return;
			map = new maplibregl.Map({
				container,
				style: 'https://tiles.openfreemap.org/styles/liberty',
				center: [140.2, 39.6], // 東北
				zoom: 6.3,
				attributionControl: { compact: true }
			});
			map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
			for (const item of items) {
				const el = document.createElement('button');
				el.type = 'button';
				el.className = 'ab-pin';
				el.dataset.id = item.id;
				el.innerHTML = `<span class="ab-pin-badge ${item.soldOut ? 'ab-pin-soldout' : ''}">${item.label}</span><span class="ab-pin-tip"></span>`;
				el.addEventListener('click', () => {
					if (onpinclick) onpinclick(item.id);
					else if (item.href) location.href = item.href;
				});
				new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([item.lng, item.lat]).addTo(map);
				markers.push({ id: item.id, el });
			}
			if (items.length > 0) {
				const bounds = new maplibregl.LngLatBounds();
				for (const i of items) bounds.extend([i.lng, i.lat]);
				map.fitBounds(bounds, { padding: 80, maxZoom: 9 });
			}
		})();
		return () => {
			cancelled = true;
			map?.remove();
		};
	});

	$effect(() => {
		for (const m of markers) m.el.classList.toggle('ab-pin-active', m.id === highlighted);
	});
</script>

<div bind:this={container} style="height: {height}" class="w-full overflow-hidden rounded-xl border border-stone-200"></div>

<style>
	:global(.ab-pin) {
		display: flex;
		flex-direction: column;
		align-items: center;
		cursor: pointer;
		background: none;
		border: none;
		padding: 0;
	}
	:global(.ab-pin-badge) {
		background: #2e2b20;
		color: #fff;
		font-size: 12px;
		font-weight: 600;
		padding: 4px 10px;
		border-radius: 9999px;
		box-shadow: 0 2px 6px rgb(0 0 0 / 0.3);
		white-space: nowrap;
	}
	:global(.ab-pin-soldout) {
		background: #a8a29e;
	}
	:global(.ab-pin-tip) {
		width: 0;
		height: 0;
		border-left: 6px solid transparent;
		border-right: 6px solid transparent;
		border-top: 8px solid #2e2b20;
	}
	:global(.ab-pin-active .ab-pin-badge) {
		background: #b08d3e;
		transform: scale(1.1);
	}
</style>
