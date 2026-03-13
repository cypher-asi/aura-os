export interface SSECallbacks<T extends string> {
  onEvent: (eventType: T, data: unknown) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

export async function streamSSE<T extends string>(
  url: string,
  init: RequestInit,
  callbacks: SSECallbacks<T>,
): Promise<void> {
  const response = await fetch(url, init);

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    const err = new Error(`SSE request failed (${response.status}): ${text}`);
    callbacks.onError?.(err);
    return;
  }

  const body = response.body;
  if (!body) {
    callbacks.onError?.(new Error("Response body is null"));
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        if (!frame.trim()) continue;

        let eventType = "";
        let data = "";

        for (const line of frame.split("\n")) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            data = line.slice(6).trim();
          }
        }

        if (eventType && data) {
          try {
            callbacks.onEvent(eventType as T, JSON.parse(data));
          } catch {
            callbacks.onEvent(eventType as T, data);
          }
        }
      }
    }
  } catch (err) {
    callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  callbacks.onDone?.();
}
