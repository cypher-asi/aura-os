import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";

interface UseMobileFilePreviewArgs {
  enabled: boolean;
  filePath: string | null;
  previewKind: "markdown" | "text" | "image" | "pdf" | "unsupported" | null;
}

interface UseMobileFilePreviewResult {
  previewContent: string | null;
  previewError: string | null;
  previewLoading: boolean;
}

interface PreviewState {
  key: string | null;
  content: string | null;
  error: string | null;
}

export function useMobileFilePreview({
  enabled,
  filePath,
  previewKind,
}: UseMobileFilePreviewArgs): UseMobileFilePreviewResult {
  const [previewState, setPreviewState] = useState<PreviewState>({
    key: null,
    content: null,
    error: null,
  });
  const requestIdRef = useRef(0);
  const previewKey =
    enabled && filePath && (previewKind === "markdown" || previewKind === "text")
      ? `${previewKind}:${filePath}`
      : null;

  useEffect(() => {
    if (!previewKey || !filePath) {
      return;
    }
    const requestId = ++requestIdRef.current;
    let cancelled = false;

    api.readFile(filePath)
      .then((response) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        if (response.ok && response.content != null) {
          setPreviewState({
            key: previewKey,
            content: response.content,
            error: null,
          });
          return;
        }
        setPreviewState({
          key: previewKey,
          content: null,
          error: response.error ?? "Preview unavailable",
        });
      })
      .catch((error) => {
        if (!cancelled && requestId === requestIdRef.current) {
          setPreviewState({
            key: previewKey,
            content: null,
            error: String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, previewKey]);

  const isActivePreview = previewState.key === previewKey;

  return {
    previewContent: isActivePreview ? previewState.content : null,
    previewError: isActivePreview ? previewState.error : null,
    previewLoading: previewKey != null && !isActivePreview,
  };
}
