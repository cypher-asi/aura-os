import { createContext } from "react";
import type { GalleryItem } from "./Gallery";

export interface OpenGalleryArgs {
  items: readonly GalleryItem[];
  initialId: string;
}

export interface GalleryContextValue {
  openGallery: (args: OpenGalleryArgs) => void;
  closeGallery: () => void;
}

export const GalleryContext = createContext<GalleryContextValue | null>(null);
