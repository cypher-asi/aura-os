import { expect, test, type Page } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test.use({ serviceWorkers: "block" });

test("desktop task completion event shows toast and posts native notification IPC", async ({ page }) => {
  await installDesktopNotificationHarness(page);
  await mockAuthenticatedApp(page);
  await page.route("**/api/auth/ws-ticket", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ticket: "test-ticket" }),
    });
  });
  await page.route("**/api/projects/proj-1/sessions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.goto("/projects");

  await expect(page.getByRole("tree", { name: "Projects" })).toBeVisible();
  await page.waitForFunction(() => window.__auraSockets?.length > 0);

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("aura-desktop-focus-changed", {
        detail: { focused: false },
      }),
    );
    window.__auraSockets[0].emit({
      seq: 1,
      type: "task_completed",
      session_id: "session-smoke-1",
      project_id: "proj-1",
      project_agent_id: "agent-inst-1",
      agent_id: "agent-1",
      task_id: "task-1",
      task_title: "Smoke notification task",
      outcome: "completed",
      duration_ms: 250,
    });
  });

  await expect(page.getByText("Task complete", { exact: true })).toBeVisible();
  await expect(page.getByText("Smoke notification task", { exact: true })).toBeVisible();

  const notifications = await page.evaluate(() =>
    window.__auraNativeMessages.filter(
      (message): message is AuraNativeNotificationMessage =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "native_notification",
    ),
  );

  expect(notifications).toEqual([
    {
      type: "native_notification",
      payload: expect.objectContaining({
        id: "task_completed:task-1",
        title: "Task complete",
        body: "Smoke notification task",
        sound: true,
        badgeCount: 1,
      }),
    },
  ]);
});

async function installDesktopNotificationHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__auraNativeMessages = [];
    window.__auraSockets = [];
    window.ipc = {
      postMessage(message: string) {
        try {
          window.__auraNativeMessages.push(JSON.parse(message) as AuraIpcMessage);
        } catch {
          window.__auraNativeMessages.push(message);
        }
      },
    };
    window.requestIdleCallback = (callback) =>
      window.setTimeout(
        () =>
          callback({
            didTimeout: false,
            timeRemaining: () => 50,
          }),
        0,
      );
    window.cancelIdleCallback = (handle) => window.clearTimeout(handle);

    class FakeWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      readyState = FakeWebSocket.CONNECTING;

      constructor(public readonly url: string) {
        window.__auraSockets.push(this);
        window.setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.onopen?.(new Event("open"));
        }, 0);
      }

      send(): void {}

      close(): void {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.(new CloseEvent("close"));
      }

      emit(payload: Record<string, unknown>): void {
        this.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify(payload),
          }),
        );
      }
    }

    window.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
}

interface AuraNativeNotificationMessage {
  type: "native_notification";
  payload: {
    id: string;
    title: string;
    body: string;
    sound: boolean;
    badgeCount?: number;
  };
}

type AuraIpcMessage = string | AuraNativeNotificationMessage;

declare global {
  interface Window {
    __auraNativeMessages: AuraIpcMessage[];
    __auraSockets: Array<WebSocket & { emit(payload: Record<string, unknown>): void }>;
  }
}
