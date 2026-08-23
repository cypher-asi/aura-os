import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function joinDictation(base: string, transcript: string): string {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return base;
  if (!base) return cleanTranscript;
  return `${base}${/\s$/.test(base) ? "" : " "}${cleanTranscript}`;
}

export interface VoiceDictationState {
  supported: boolean;
  listening: boolean;
  error: string | null;
  start: (currentText: string) => void;
  stop: () => void;
}

/**
 * Thin, privacy-explicit wrapper around the browser Web Speech API. Audio is
 * requested only after the mic button is clicked. Interim text is surfaced in
 * the composer, but this hook never submits it.
 */
export function useVoiceDictation(
  onTranscript: (text: string) => void,
): VoiceDictationState {
  const [supported] = useState(() => recognitionConstructor() !== null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef("");
  const transcriptCallbackRef = useRef(onTranscript);
  transcriptCallbackRef.current = onTranscript;

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      recognition.stop();
    }
    setListening(false);
  }, []);

  const start = useCallback((currentText: string) => {
    const Recognition = recognitionConstructor();
    if (!Recognition || recognitionRef.current) return;
    const recognition = new Recognition();
    baseTextRef.current = currentText;
    setError(null);
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? "";
      }
      transcriptCallbackRef.current(joinDictation(baseTextRef.current, transcript));
    };
    recognition.onerror = (event) => {
      recognitionRef.current = null;
      setListening(false);
      setError(
        event.error === "not-allowed"
          ? "Microphone permission was denied"
          : "Voice dictation stopped unexpectedly",
      );
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setError("Voice dictation could not start");
      setListening(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      recognition?.abort?.();
    };
  }, []);

  return { supported, listening, error, start, stop };
}
