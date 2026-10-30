"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Edition, EditionItem, Store, WorkspaceBundle } from "@/contract";
import { getApi } from "@/lib/api-client";
import { mondayOf } from "../lib/format";
import { useAsync, type ShownError } from "../lib/use-async";

interface WorkspaceValue {
  bundle: WorkspaceBundle | undefined;
  loading: boolean;
  error: ShownError | undefined;
  reload: () => void;
  /** The newest week with editions (or this Monday when there are none). */
  currentWeek: string;
  week: string;
  setWeek: (w: string) => void;
  /** Editions for the selected week; undefined while loading. */
  editions: Edition[] | undefined;
  editionsLoading: boolean;
  editionsError: ShownError | undefined;
  reloadEditions: () => void;
  storeById: (id: string) => Store | undefined;
  editionForStore: (storeId: string) => Edition | undefined;
  /** Local updates after a write, so every page shows the new state without a refetch. */
  putEdition: (e: Edition) => void;
  putItem: (editionId: string, item: EditionItem) => void;
}

const Ctx = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const api = getApi();
  const ws = useAsync("workspace", () => api.getWorkspace());
  const latest = ws.data?.latestEditions;
  const currentWeek = useMemo(
    () => (latest?.length ? latest.map((e) => e.weekOf).sort().at(-1)! : mondayOf(new Date())),
    [latest],
  );
  const [picked, setWeek] = useState<string | null>(null);
  const week = picked ?? currentWeek;
  const isCurrent = week === currentWeek;
  const listed = useAsync(ws.data && !isCurrent ? `editions:${week}` : null, () => api.listEditions(week));
  const [local, setLocal] = useState<Record<string, Edition>>({});

  const base = isCurrent ? latest?.filter((e) => e.weekOf === week) : listed.data;
  const editions = useMemo(() => base?.map((e) => local[e.id] ?? e), [base, local]);

  const putEdition = useCallback((e: Edition) => setLocal((m) => ({ ...m, [e.id]: e })), []);
  const putItem = useCallback(
    (editionId: string, item: EditionItem) =>
      setLocal((m) => {
        const from = m[editionId] ?? editions?.find((e) => e.id === editionId);
        if (!from) return m;
        const items = from.items.map((i) => (i.id === item.id ? item : i));
        return { ...m, [editionId]: { ...from, items, status: statusOf(items) } };
      }),
    [editions],
  );
  const reload = ws.reload;
  const reloadAll = useCallback(() => {
    setLocal({});
    reload();
  }, [reload]);

  const value: WorkspaceValue = {
    bundle: ws.data,
    loading: ws.loading && !ws.data,
    error: ws.error,
    reload: reloadAll,
    currentWeek,
    week,
    setWeek,
    editions,
    editionsLoading: isCurrent ? ws.loading && !ws.data : listed.loading,
    editionsError: isCurrent ? ws.error : listed.error,
    reloadEditions: isCurrent ? reloadAll : listed.reload,
    storeById: (id) => ws.data?.stores.find((s) => s.id === id),
    editionForStore: (storeId) => editions?.find((e) => e.storeId === storeId),
    putEdition,
    putItem,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return v;
}

/** Same rule as the server: any flagged item flags the edition; all approved or edited approves it. */
export function statusOf(items: EditionItem[]): Edition["status"] {
  if (items.some((i) => i.status === "flagged")) return "flagged";
  if (items.length > 0 && items.every((i) => i.status === "approved" || i.status === "edited")) return "approved";
  return "draft";
}
