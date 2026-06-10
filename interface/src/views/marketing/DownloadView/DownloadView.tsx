import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./DownloadView.css";

type DownloadPlatform = "mac" | "windows" | "linux" | "unknown";

interface DownloadManifest {
  release_url?: string;
  desktop?: {
    windows?: { url?: string };
    linux?: { url?: string };
    mac?: {
      "apple-silicon"?: { url?: string };
      intel?: { url?: string };
    };
  };
}

interface DownloadCard {
  platform: DownloadPlatform;
  defaultForPlatform: boolean;
  eyebrow: string;
  title: string;
  description: string;
  assetKey: string;
  cta: string;
  meta: string;
}

const DOWNLOAD_CARDS: readonly DownloadCard[] = [
  {
    platform: "mac",
    defaultForPlatform: true,
    eyebrow: "macOS",
    title: "Apple Silicon",
    description: "Native build for M1, M2, M3, and M4 Macs.",
    assetKey: "mac-apple-silicon",
    cta: "Download",
    meta: "Recommended for most Macs",
  },
  {
    platform: "mac",
    defaultForPlatform: false,
    eyebrow: "macOS",
    title: "Intel Mac",
    description:
      "Desktop build for x86-based Macs and older MacBook Pro and iMac hardware.",
    assetKey: "mac-intel",
    cta: "Download",
    meta: "Only for pre-Apple Silicon Macs",
  },
  {
    platform: "windows",
    defaultForPlatform: true,
    eyebrow: "Windows",
    title: "Windows",
    description:
      "Signed Windows installer with the latest desktop runtime and updater support.",
    assetKey: "windows",
    cta: "Download",
    meta: "x64 installer",
  },
  {
    platform: "linux",
    defaultForPlatform: true,
    eyebrow: "Linux",
    title: "Linux",
    description:
      "Portable AppImage for Linux desktops, suitable for direct download and launch.",
    assetKey: "linux",
    cta: "Download",
    meta: "x86_64 AppImage",
  },
];

function detectPlatform(): DownloadPlatform {
  if (typeof window === "undefined") return "unknown";
  const nav = window.navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const src = [nav.userAgentData?.platform, nav.platform, nav.userAgent]
    .join(" ")
    .toLowerCase();
  if (src.includes("win")) return "windows";
  if (src.includes("mac") || src.includes("iphone") || src.includes("ipad"))
    return "mac";
  if (src.includes("linux") || src.includes("x11")) return "linux";
  return "unknown";
}

function resolveUrl(
  manifest: DownloadManifest | null,
  assetKey: string,
): string | undefined {
  if (!manifest?.desktop) return manifest?.release_url;
  switch (assetKey) {
    case "mac-apple-silicon":
      return manifest.desktop.mac?.["apple-silicon"]?.url;
    case "mac-intel":
      return manifest.desktop.mac?.intel?.url;
    case "windows":
      return manifest.desktop.windows?.url;
    case "linux":
      return manifest.desktop.linux?.url;
    default:
      return manifest.release_url;
  }
}

export function DownloadView() {
  const { t } = useTranslation("marketing");
  const [platform] = useState<DownloadPlatform>(() => detectPlatform());
  const [manifest, setManifest] = useState<DownloadManifest | null>(null);

  useEffect(() => {
    const url = import.meta.env.VITE_DOWNLOAD_MANIFEST_URL;
    if (url) {
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setManifest(data as DownloadManifest))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    document.title = t("download.documentTitle", {
      defaultValue: "Download \u2014 AURA",
    });
  }, [t]);

  return (
    <section className="downloadPage">
      <div className="downloadPageContent">
        <h1 className="downloadPageHeadline">
          {t("download.headline", {
            defaultValue: "Download AURA for every major desktop platform.",
          })}
        </h1>
        <div className="downloadGrid">
          {DOWNLOAD_CARDS.map((card) => {
            const isPrimary =
              platform !== "unknown" &&
              card.platform === platform &&
              card.defaultForPlatform;
            const href = resolveUrl(manifest, card.assetKey);

            return (
              <article
                key={card.assetKey}
                className={`downloadCard${isPrimary ? " downloadCardRecommended" : ""}`}
              >
                <div className="downloadCardBody">
                  <div className="downloadCardHeading">
                    <div className="downloadCardTitleRow">
                      <h2 className="downloadCardTitle">{card.title}</h2>
                    </div>
                    <span className="downloadCardEyebrow">{card.eyebrow}</span>
                    <p className="downloadCardDescription">
                      {t(`download.cards.${card.assetKey}.description`, {
                        defaultValue: card.description,
                      })}
                    </p>
                  </div>
                </div>
                <div className="downloadCardFooter">
                  <a
                    href={href ?? "#"}
                    className={`downloadCardButton${isPrimary ? " downloadCardButtonPrimary" : ""}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (!href) e.preventDefault();
                    }}
                  >
                    {href
                      ? t("download.cta", { defaultValue: card.cta })
                      : t("download.loading", { defaultValue: "Loading..." })}
                  </a>
                  <p className="downloadCardMeta">
                    {t(`download.cards.${card.assetKey}.meta`, {
                      defaultValue: card.meta,
                    })}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
