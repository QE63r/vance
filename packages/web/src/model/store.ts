import { useSyncExternalStore } from "react";
import { initialState, reduce, type Action, type State } from "./reduce";

class Store {
  private state: State = initialState;
  private listeners = new Set<() => void>();

  getSnapshot = (): State => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  dispatch = (action: Action): void => {
    const next = reduce(this.state, action);
    if (next === this.state) return;
    this.state = next;
    for (const fn of this.listeners) fn();
  };
}

export const store = new Store();

export function useVance(): State {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
