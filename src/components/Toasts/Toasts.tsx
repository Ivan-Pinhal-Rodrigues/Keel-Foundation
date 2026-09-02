"use client";

import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import styles from "./Toasts.module.css";

type ToastEntry = { id: number; message: string };

// Matches the prototype's toast lifetime (fade at 2200ms, remove at 2500ms).
const TTL_MS = 2500;

// Module-level store so `toast()` can be imported and called from anywhere —
// route handlers' client callbacks, event handlers, other components — without
// a hook or a context ref.
let entries: ToastEntry[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ToastEntry[] {
  return entries;
}

const EMPTY: ToastEntry[] = [];
function getServerSnapshot(): ToastEntry[] {
  return EMPTY;
}

/** Show a transient message. Auto-dismisses after ~2.5s. */
export function toast(message: string): void {
  const id = nextId++;
  entries = [...entries, { id, message }];
  emit();
  setTimeout(() => {
    entries = entries.filter((entry) => entry.id !== id);
    emit();
  }, TTL_MS);
}

/**
 * Renders the fixed live-region container. Mount once near the app root. Toasts
 * are pushed imperatively via `toast()`.
 */
export function ToastProvider({ children }: { children?: ReactNode }) {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <>
      {children}
      <div className={styles.toasts} role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={styles.toast}>
            {item.message}
          </div>
        ))}
      </div>
    </>
  );
}
