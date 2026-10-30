"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MlMap, Marker } from "maplibre-gl";
import type { Store } from "@/contract";
import { storeColor } from "../ui";
import { STATUS_META, type StoreWeekStatus } from "./status-meta";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";
const WORKER_HOST = "https://cdn.jsdelivr.net/npm";

function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function pin(store: Store, status: StoreWeekStatus, onOpen: (id: string) => void): HTMLElement {
  const meta = STATUS_META[status];
  const el = document.createElement("button");
  el.type = "button";
  el.className = "le-pin group flex items-center gap-1.5 bg-transparent p-0";
  el.setAttribute("aria-label", `${store.name}: ${meta.label}`);
  el.dataset.storeId = store.id;
  el.innerHTML = `
    <span class="relative block h-[15px] w-[15px] rounded-full transition-transform group-hover:scale-110 group-data-[hot=true]:scale-125"
      style="background:${storeColor(store.colorIndex)};box-shadow:0 0 0 2px var(--paper),0 0 0 ${meta.dashed ? "3px" : "4px"} ${meta.ring}">
      ${status === "flagged" ? `<span class="absolute -right-2.5 -top-2.5 flex h-[13px] w-[13px] items-center justify-center rounded-full text-[10px] font-bold" style="background:var(--flag);color:var(--paper)">!</span>` : ""}
    </span>
    <span class="rounded-[4px] px-1.5 py-0.5 text-[12px] font-semibold leading-none shadow-sm max-sm:hidden" style="background:var(--paper);color:var(--ink);border:1px solid var(--rule)">${store.name.replace(/</g, "&lt;")}</span>`;
  el.addEventListener("click", () => onOpen(store.id));
  return el;
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
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !box.current) return;
      // Bundlers rename the worker chunk, so point MapLibre at the published, self-contained worker of the same version.
      if (!ml.getWorkerUrl().includes(WORKER_HOST)) ml.setWorkerUrl(`${WORKER_HOST}/maplibre-gl@${ml.getVersion()}/dist/maplibre-gl-worker.mjs`);
      let m: MlMap;
      try {
        m = new ml.Map({
        container: box.current,
        style: isDark() ? STYLE_DARK : STYLE_LIGHT,
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
        return new ml.Marker({ element: el, anchor: "left", offset: [-7, 0] }).setLngLat([s.lon, s.lat]).addTo(m);
      });
      if (stores.length) {
        const b = new ml.LngLatBounds();
        stores.forEach((s) => b.extend([s.lon, s.lat]));
        m.fitBounds(b, { padding: { top: 40, bottom: 40, left: 40, right: 120 }, maxZoom: 14, duration: 0 });
      }
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
    <div className="relative h-[340px] w-full overflow-hidden rounded-[var(--radius)] border border-rule bg-paper-2 sm:h-[440px] lg:h-[560px]">
      <div ref={box} className="h-full w-full" />
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
          The map tiles did not load. The status table has every store.
        </div>
      ) : null}
      <Legend />
    </div>
  );
}

function Legend() {
  const items: StoreWeekStatus[] = ["approved", "flagged", "draft"];
  return (
    <div className="pointer-events-none absolute left-2 top-2 flex gap-3 rounded-[4px] border border-rule bg-paper/90 px-2.5 py-1.5 text-[11px] text-ink-2">
      {items.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ boxShadow: `0 0 0 2px ${STATUS_META[s].ring}`, background: "var(--paper)" }} />
          {STATUS_META[s].label}
        </span>
      ))}
    </div>
  );
}
