import { create, type StoreApi } from "zustand";

type StoreWithInitialState<T> = StoreApi<T> & {
  __initialState: T;
};

const trackedStores: StoreWithInitialState<unknown>[] = [];

export function trackStore<T>(store: StoreApi<T>, initialState: T): void {
  const tracked = store as StoreWithInitialState<T>;
  tracked.__initialState = initialState;
  trackedStores.push(tracked as StoreWithInitialState<unknown>);
}

export function resetAllStores(): void {
  for (const store of trackedStores) {
    store.setState(store.__initialState, true);
  }
}

export function createMockStore<T extends object>(
  initialState: T,
): StoreApi<T> & { reset: () => void } {
  const store = create<T>()(() => initialState);
  return Object.assign(store, {
    reset: () => store.setState(initialState, true),
  });
}
