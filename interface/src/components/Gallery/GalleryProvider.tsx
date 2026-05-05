import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Gallery, type GalleryItem } from "./Gallery";
import {
  GalleryContext,
  type GalleryContextValue,
  type OpenGalleryArgs,
} from "./gallery-context";

interface GalleryState {
  items: readonly GalleryItem[];
  initialId: string;
}

interface GalleryProviderProps {
  children: ReactNode;
}

/**
 * Mounts the shared gallery once near the root and exposes
 * `openGallery({ items, initialId })` via context. Apps call
 * `useGallery()` to open a full-screen image viewer without
 * each surface owning its own lightbox + portal + key handling.
 */
export function GalleryProvider({ children }: GalleryProviderProps): React.ReactElement {
  const [state, setState] = useState<GalleryState | null>(null);

  const openGallery = useCallback((args: OpenGalleryArgs) => {
    if (args.items.length === 0) return;
    setState({ items: args.items, initialId: args.initialId });
  }, []);

  const closeGallery = useCallback(() => {
    setState(null);
  }, []);

  const value = useMemo<GalleryContextValue>(
    () => ({ openGallery, closeGallery }),
    [openGallery, closeGallery],
  );

  return (
    <GalleryContext.Provider value={value}>
      {children}
      {state ? (
        <Gallery items={state.items} initialId={state.initialId} onClose={closeGallery} />
      ) : null}
    </GalleryContext.Provider>
  );
}
