"use client";

/**
 * Every verifiable artefact the app produces, in one place.
 *
 * Three sponsors all ask for evidence — transactions, entity keys, queries, Swarm
 * references — and hunting for them across a console at judging time is how you end up
 * describing your project instead of showing it. Anything provable gets recorded here
 * as it happens, and the Evidence panel renders it with a link where one exists.
 *
 * Persisted to localStorage so a reload mid-demo does not wipe the trail.
 */

export type EvidenceKind =
  | "arkiv-entity"
  | "arkiv-tx"
  | "arkiv-query"
  | "fuji-tx"
  | "swarm-ref"
  | "local";

export type Evidence = {
  id: string;
  kind: EvidenceKind;
  label: string;
  value: string;
  url: string | null;
  at: number;
};

const STORAGE_KEY = "vespro:evidence";
const ARKIV_EXPLORER = "https://tiramisu.explorer.arkiv.network";
const FUJI_EXPLORER = "https://testnet.snowtrace.io";
const SWARM_GATEWAY = "https://download.gateway.ethswarm.org/bzz";

let entries: Evidence[] = [];
const listeners = new Set<(entries: Evidence[]) => void>();

function load() {
  if (typeof window === "undefined") return;
  try {
    entries = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    entries = [];
  }
}
load();

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 200)));
  } catch {
    // A full quota should not take the demo down with it.
  }
}

function linkFor(kind: EvidenceKind, value: string): string | null {
  switch (kind) {
    case "arkiv-tx":
      return `${ARKIV_EXPLORER}/tx/${value}`;
    case "arkiv-entity":
      return `${ARKIV_EXPLORER}/entity/${value}`;
    case "fuji-tx":
      return `${FUJI_EXPLORER}/tx/${value}`;
    case "swarm-ref":
      return `${SWARM_GATEWAY}/${value}`;
    default:
      return null;
  }
}

export function record(kind: EvidenceKind, label: string, value: string): Evidence {
  const entry: Evidence = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    label,
    value,
    url: linkFor(kind, value),
    at: Date.now(),
  };
  entries = [entry, ...entries].slice(0, 200);
  persist();
  listeners.forEach((fn) => fn(entries));
  return entry;
}

export function clearEvidence() {
  entries = [];
  persist();
  listeners.forEach((fn) => fn(entries));
}

export function onEvidence(fn: (entries: Evidence[]) => void): () => void {
  listeners.add(fn);
  fn(entries);
  return () => listeners.delete(fn);
}

export function truncate(value: string, head = 10, tail = 6): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
