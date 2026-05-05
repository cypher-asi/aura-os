import { useContext } from "react";
import { GalleryContext, type GalleryContextValue } from "./gallery-context";

const NOOP_GALLERY: GalleryContextValue = {
  openGallery: () => {},
  closeGallery: () => {},
};

/**
 * Access the gallery imperative API. When no provider is mounted (in
 * standalone tests, isolated previews, or storybook-style harnesses)
 * this falls back to a no-op so consumers never crash and the
 * behaviour merely degrades to "click does nothing". The real provider
 * is mounted in `main.tsx`, so production renders always get the live
 * implementation.
 */
export function useGallery(): GalleryContextValue {
  const ctx = useContext(GalleryContext);
  return ctx ?? NOOP_GALLERY;
}
