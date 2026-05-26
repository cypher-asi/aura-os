/**
 * Hook for managing an Anam AI avatar session.
 *
 * Connects to the Anam streaming service and provides methods to
 * pipe text through the avatar's lip-synced speech. Uses Anam's
 * built-in LLM by default; switch to CUSTOMER_CLIENT_V1 to pipe
 * AURA's own chat responses through the avatar instead.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, AnamEvent } from "@anam-ai/js-sdk";
import type { AnamClient } from "@anam-ai/js-sdk";

const ANAM_API_KEY = import.meta.env.VITE_ANAM_API_KEY ?? "";
const ANAM_SESSION_TOKEN_URL = "https://api.anam.ai/v1/auth/session-token";
const DEFAULT_LLM_ID = "a7cf662c-2ace-4de1-a21e-ef0fbf144bb7";
const DEFAULT_SYSTEM_PROMPT =
  "You are an AI assistant for AURA. Be helpful and concise.";

export interface AnamAvatarConfig {
  avatarId: string;
  voiceId: string;
  /** Display name for the avatar. */
  name?: string;
}

export type AnamAvatarStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "streaming"
  | "error"
  | "stopped";

export interface AnamAvatarHandle {
  status: AnamAvatarStatus;
  start: (videoElementId: string) => Promise<void>;
  stop: () => void;
  speak: (text: string) => Promise<void>;
  beginTurn: () => TurnStream | null;
  error: string | null;
}

export interface TurnStream {
  sendChunk: (text: string, isLast: boolean) => Promise<void>;
  end: () => Promise<void>;
  isActive: () => boolean;
}

export interface AnamAvatarOptions {
  /** When true, uses CUSTOMER_CLIENT_V1 so text is piped manually. */
  disableBuiltInLlm?: boolean;
  /** Called with the final transcript when the user finishes speaking. */
  onUserSpeech?: (transcript: string) => void;
}

export async function fetchSessionToken(
  config: AnamAvatarConfig,
  options?: Pick<AnamAvatarOptions, "disableBuiltInLlm">,
): Promise<string> {
  const useCustomLlm = options?.disableBuiltInLlm;
  const res = await fetch(ANAM_SESSION_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANAM_API_KEY}`,
    },
    body: JSON.stringify({
      personaConfig: {
        name: config.name ?? "AURA Agent",
        avatarId: config.avatarId,
        voiceId: config.voiceId,
        llmId: useCustomLlm ? "CUSTOMER_CLIENT_V1" : DEFAULT_LLM_ID,
        ...(useCustomLlm ? {} : { systemPrompt: DEFAULT_SYSTEM_PROMPT }),
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anam session token failed (${res.status}): ${body}`);
  }

  const { sessionToken } = await res.json();
  return sessionToken as string;
}

export function useAnamAvatar(
  config: AnamAvatarConfig | null,
  options?: AnamAvatarOptions,
): AnamAvatarHandle {
  const [status, setStatus] = useState<AnamAvatarStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<AnamClient | null>(null);
  const onUserSpeechRef = useRef(options?.onUserSpeech);
  onUserSpeechRef.current = options?.onUserSpeech;

  useEffect(() => {
    return () => {
      clientRef.current?.stopStreaming();
      clientRef.current = null;
    };
  }, []);

  const start = useCallback(
    async (videoElementId: string) => {
      if (!config || !ANAM_API_KEY) {
        setError(
          !ANAM_API_KEY
            ? "VITE_ANAM_API_KEY not configured"
            : "No avatar config",
        );
        setStatus("error");
        return;
      }

      try {
        setStatus("connecting");
        setError(null);

        const sessionToken = await fetchSessionToken(config, options);
        const client = createClient(sessionToken);
        clientRef.current = client;

        client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () =>
          setStatus("ready"),
        );
        client.addListener(AnamEvent.VIDEO_PLAY_STARTED, () =>
          setStatus("streaming"),
        );
        client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
          setStatus("stopped");
          clientRef.current = null;
        });

        // Forward completed user speech transcripts to the consumer.
        client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (evt) => {
          if (evt.role === "user" && evt.endOfSpeech && evt.content) {
            onUserSpeechRef.current?.(evt.content);
          }
        });

        await client.streamToVideoElement(videoElementId);
        setStatus("ready");
      } catch (err) {
        console.error("[anam] start failed:", err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    },
    [config, options],
  );

  const stop = useCallback(() => {
    clientRef.current?.stopStreaming();
    clientRef.current = null;
    setStatus("stopped");
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!clientRef.current) return;
    try {
      await clientRef.current.talk(text);
    } catch (err) {
      console.error("[anam] speak failed:", err);
    }
  }, []);

  const beginTurn = useCallback((): TurnStream | null => {
    if (!clientRef.current) return null;
    try {
      const stream = clientRef.current.createTalkMessageStream();
      return {
        sendChunk: (text, isLast) =>
          stream.isActive()
            ? stream.streamMessageChunk(text, isLast)
            : Promise.resolve(),
        end: () =>
          stream.isActive() ? stream.endMessage() : Promise.resolve(),
        isActive: () => stream.isActive(),
      };
    } catch (err) {
      console.error("[anam] beginTurn failed:", err);
      return null;
    }
  }, []);

  return useMemo(
    () => ({ status, start, stop, speak, beginTurn, error }),
    [status, start, stop, speak, beginTurn, error],
  );
}
