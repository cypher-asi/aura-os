import type { EventType, AuraEventOfType } from "../shared/types/aura-events";

type EventSubscriber = <T extends EventType>(
  type: T,
  callback: (event: AuraEventOfType<T>) => void,
) => () => void;

interface EventSubscriptionGroup {
  bootstrap: () => void;
  teardown: () => void;
}

export function createEventSubscriptionGroup(
  subscribe: () => EventSubscriber,
  register: (subscribe: EventSubscriber) => Array<() => void>,
  onTeardown?: () => void,
): EventSubscriptionGroup {
  let bootstrapped = false;
  let registeredDisposers: Array<() => void> = [];

  return {
    bootstrap(): void {
      if (bootstrapped) return;
      bootstrapped = true;
      const eventSubscribe = subscribe();
      registeredDisposers = register(eventSubscribe);
    },

    teardown(): void {
      for (const dispose of registeredDisposers) {
        try {
          dispose();
        } catch {
          // Disposer failures should not block further cleanup.
        }
      }
      registeredDisposers = [];
      onTeardown?.();
      bootstrapped = false;
    },
  };
}
