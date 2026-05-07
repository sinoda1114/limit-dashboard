import type { UsageStore } from "./usage-types";

type Listener = (store: UsageStore) => void;

const globalForUsageEvents = globalThis as typeof globalThis & {
  usageDashboardListeners?: Set<Listener>;
};

function listeners() {
  globalForUsageEvents.usageDashboardListeners ??= new Set<Listener>();
  return globalForUsageEvents.usageDashboardListeners;
}

export function subscribeUsage(listener: Listener) {
  listeners().add(listener);
  return () => listeners().delete(listener);
}

export function publishUsage(store: UsageStore) {
  for (const listener of listeners()) {
    try {
      listener(store);
    } catch {
      listeners().delete(listener);
    }
  }
}
