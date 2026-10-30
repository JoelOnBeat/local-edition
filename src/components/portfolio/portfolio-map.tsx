"use client";

import { useEffect, useRef, useState } from "react";
import { preconnect } from "react-dom";
import type { Map as MlMap, Marker } from "maplibre-gl";
import type { Store } from "@/contract";
import { storeColor, storeMonogram } from "../ui";
import { STATUS_META, type StoreWeekStatus } from "./status-meta";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const TILE_HOST = "https://tiles.openfreemap.org";
/** MapLibre's worker, served from our own origin (scripts/vendor-maplibre-worker.mjs copies it from node_modules). */
const WORKER_PATH = "/vendor/maplibre-gl-worker.mjs";

const STATUS_DOT: Record<StoreWeekStatus, string> = {
  approved: "var(--ok)", flagged: "var(--flag)", draft: "var(--warn)", drafting: "var(--info)", none: "var(--stone-300)",
};

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A pin is the store's own 24px monogram tile (white ring, faint shadow) with its status dot at the top-right. */
function pin(store: Store, status: StoreWeekStatus, onOpen: (id: string) => void): HTMLElement {
  const meta = STATUS_META[status];
  const el = document.createElement("button");
  el.type = "button";
  el.className = "le-pin group flex items-center gap-1.5 bg-transparent p-0";
  el.setAttribute("aria-label", `${store.name}: ${meta.label}`);
  el.dataset.storeId = store.id;
  el.setAttribute("data-testid", `map-pin-${store.id}`);
  el.dataset.status = status;
  el.innerHTML = `
    <span class="relative flex size-6 items-center justify-center rounded-md text-[10px] font-semibold leading-none tracking-[-0.02em] text-white"
      style="background:${storeColor(store.colorIndex)};box-shadow:0 0 0 2px #fff,0 1px 3px rgb(0 0 0/.18),0 0 0 3px rgb(0 0 0/.06)">
      <span${storeMonogram(store.name).length > 2 ? ' style="transform:scale(.86)"' : ""}>${esc(storeMonogram(store.name))}</span>
      <span class="absolute -right-1 -top-1 size-2.5 rounded-full" style="background:${STATUS_DOT[status]};box-shadow:0 0 0 2px #fff"></span>
    </span>
    <span class="whitespace-nowrap rounded-md bg-white px-1.5 py-1 text-[12px] font-medium leading-none text-ink-strong max-sm:hidden" style="box-shadow:var(--shadow-ring-xs)">${esc(store.name)}</span>`;
  el.addEventListener("click", () => onOpen(store.id));
  return el;
}

/**
 * Hide a pin's name label when it would overlap a label already placed (top to bottom); the tile stays, and hovering the
 * row or the pin shows the name again. Keeps the map readable where stores sit a few blocks apart.
 */
function declutter(m: MlMap, list: Marker[]) {
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const items = list.map((mk) => ({ mk, p: m.project(mk.getLngLat()) })).sort((a, b) => a.p.y - b.p.y);
  for (const { mk, p } of items) {
    const label = mk.getElement().lastElementChild as HTMLElement | null;
    if (!label) continue;
    const w = label.offsetWidth || 90;
    const box = { x0: p.x + 14, x1: p.x + 20 + w, y0: p.y - 11, y1: p.y + 11 };
    const clash = placed.some((o) => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0);
    label.dataset.hidden = String(clash);
    if (!clash) placed.push(box);
  }
}

/** The portfolio map: every store at its corner, filled with its colour, ringed by its status this week. */
export function PortfolioMap({ stores, statusOf, hot, onHot, onOpen }: {
  stores: Store[];
  statusOf: (storeId: string) => StoreWeekStatus;
  hot: string | null;
  onHot: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [failed, setFailed] = useState(false);
  const statusKey = stores.map((s) => `${s.id}:${statusOf(s.id)}`).join("|");

  useEffect(() => {
    let cancelled = false;
    // The basemap is slow to start from cold (style, then tile index, then tiles, each a round trip to another host: measured 5-12 s on the
    // live site). Open the connection and start the style download while MapLibre's own bundle is still loading.
    preconnect(TILE_HOST);
    void fetch(STYLE_LIGHT).catch(() => undefined);
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !box.current) return;
      // Bundlers rename the worker chunk, so point MapLibre at the self-contained worker of the same version, vendored under public/.
      const workerUrl = new URL(WORKER_PATH, window.location.origin).href;
      if (ml.getWorkerUrl() !== workerUrl) ml.setWorkerUrl(workerUrl);
      let m: MlMap;
      try {
        m = new ml.Map({
        container: box.current,
        style: STYLE_LIGHT,
        center: [-73.965, 40.74],
        zoom: 11,
        attributionControl: { compact: true },
        cooperativeGestures: true,
        });
      } catch {
        setFailed(true); // no WebGL: the table still lists every store
        return;
      }
      m.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      m.on("error", (e) => {
        if (!m.loaded() && /style|fetch/i.test(String(e.error?.message ?? ""))) setFailed(true);
      });
      map.current = m;
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ml = await import("maplibre-gl");
      for (let i = 0; i < 40 && !map.current && !cancelled; i++) await new Promise((r) => setTimeout(r, 50));
      const m = map.current;
      if (!m || cancelled) return;
      markers.current.forEach((mk) => mk.remove());
      markers.current = stores.map((s) => {
        const el = pin(s, statusOf(s.id), onOpen);
        el.addEventListener("mouseenter", () => onHot(s.id));
        el.addEventListener("mouseleave", () => onHot(null));
        return new ml.Marker({ element: el, anchor: "left", offset: [-12, 0] }).setLngLat([s.lon, s.lat]).addTo(m);
      });
      if (stores.length) {
        const b = new ml.LngLatBounds();
        stores.forEach((s) => b.extend([s.lon, s.lat]));
        m.fitBounds(b, { padding: { top: 48, bottom: 40, left: 40, right: 130 }, maxZoom: 13.5, duration: 0 });
      }
      declutter(m, markers.current);
      m.on("moveend", () => declutter(m, markers.current));
    })();
    return () => {
      cancelled = true;
    };
    // statusKey captures every status change; the callbacks are stable per page render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey]);

  useEffect(() => {
    markers.current.forEach((mk) => {
      const el = mk.getElement();
      el.dataset.hot = String(el.dataset.storeId === hot);
      el.style.zIndex = el.dataset.storeId === hot ? "2" : "1";
    });
  }, [hot]);

  return (
    <div className="le-map relative h-[320px] w-full overflow-hidden rounded-lg bg-[#F2F2F0] sm:h-[400px] xl:h-full xl:min-h-[456px]">
      <div ref={box} className="h-full w-full" />
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[14px] text-muted">
          The map tiles did not load. The table lists every store.
        </div>
      ) : null}
    </div>
  );
}

/** The status key shown in the map card's header. */
export function MapLegend() {
  const items: StoreWeekStatus[] = ["approved", "draft", "flagged"];
  return (
    <span className="hidden items-center gap-2.5 text-[12px] text-ink-2 sm:flex">
      {items.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: STATUS_DOT[s] }} />
          {STATUS_META[s].label}
        </span>
      ))}
    </span>
  );
}
