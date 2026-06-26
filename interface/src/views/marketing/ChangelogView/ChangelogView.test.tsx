import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChangelogView } from "./ChangelogView";
import * as githubCommits from "../../../api/marketing/github-commits";
import * as changelogApi from "../../../api/marketing/changelog";
import type { ChangelogEntry } from "../../../api/marketing/changelog";
import * as desktopManifest from "../../../api/marketing/desktop-manifest";
import type { DesktopManifest } from "../../../api/marketing/desktop-manifest";

// Mirrors `getCurrentPstMonthKey` in ChangelogView so mocked snapshots
// line up with the current PST month and the this-month figure renders
// (a mismatch would intentionally fall back to a dash).
const CURRENT_PST_MONTH_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
}).format(new Date());

function renderChangelogView(embedded = false) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ChangelogView embedded={embedded} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function getCommitStatValueElement(label: RegExp): HTMLElement {
  const labelEl = screen.getByText(label);
  const stat = labelEl.closest(".changelogStat");
  if (!stat) {
    throw new Error(`Could not find .changelogStat parent for ${label}`);
  }
  const value = stat.querySelector<HTMLElement>(".changelogStatValue");
  if (!value) {
    throw new Error(`Missing .changelogStatValue for ${label}`);
  }
  return value;
}

describe("ChangelogView", () => {
  beforeEach(() => {
    // The commit-stats card persists last-known-good totals in
    // localStorage so a transient outage shows the previous numbers
    // instead of a placeholder. Clear it between tests so each case
    // starts from a known-empty cache and assertions stay deterministic.
    window.localStorage.clear();

    // Collapse the count-up animation to a single frame so the resolved
    // value is observable immediately. The rAF callback is invoked with a
    // timestamp far in the future, which drives the hook's progress to 1
    // and lands it on the exact target in one tick — keeping these
    // assertions deterministic without a fake clock. `useCountUp.test.ts`
    // has the dedicated animation-timing coverage.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(
      (cb: FrameRequestCallback): number => {
        cb(performance.now() + 1_000_000);
        return 0;
      },
    );

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without throwing and shows the Changelog heading", () => {
    renderChangelogView();
    expect(
      screen.getByRole("heading", { level: 1, name: /Changelog/ }),
    ).toBeInTheDocument();
  });

  it("shows a loading sentinel for the live commit stats while the GitHub fetch is pending", () => {
    // Return a Promise that never resolves during this test so the
    // query stays in the pending state and the stats render their
    // initial count-up state (0 under reduced-motion).
    vi.spyOn(githubCommits, "fetchAuraCommitStats").mockReturnValue(
      new Promise(() => undefined),
    );

    renderChangelogView();

    const thisMonth = getCommitStatValueElement(/Commits this month/);
    expect(thisMonth).toHaveAttribute("aria-busy", "true");
    expect(thisMonth.textContent).toBe("0");

    const allTime = getCommitStatValueElement(/All-time commits/);
    expect(allTime).toHaveAttribute("aria-busy", "true");
    expect(allTime.textContent).toBe("0");
  });

  it("renders the live commit totals once fetchAuraCommitStats resolves", async () => {
    vi.spyOn(githubCommits, "fetchAuraCommitStats").mockResolvedValue({
      commitsThisMonth: 137,
      commitsAllTime: 9421,
      perRepo: Object.fromEntries(
        githubCommits.AURA_PUBLIC_REPOS.map((repo) => [
          repo,
          { thisMonth: 0, allTime: 0 },
        ]),
      ),
      monthKey: CURRENT_PST_MONTH_KEY,
      fetchedAt: new Date().toISOString(),
      partial: false,
    });

    renderChangelogView();

    await waitFor(() => {
      expect(
        getCommitStatValueElement(/Commits this month/).textContent,
      ).toBe("137");
    });

    const thisMonth = getCommitStatValueElement(/Commits this month/);
    expect(thisMonth).toHaveAttribute("aria-busy", "false");
    expect(thisMonth).toHaveAttribute(
      "title",
      `Live total across ${githubCommits.AURA_PUBLIC_REPOS.length} AURA repositories`,
    );

    const allTime = getCommitStatValueElement(/All-time commits/);
    expect(allTime.textContent).toBe("9,421");
    expect(allTime).toHaveAttribute("aria-busy", "false");
  });

  it("renders a dash instead of 0 when the commit stats fetch fails and nothing is cached", async () => {
    vi.spyOn(githubCommits, "fetchAuraCommitStats").mockRejectedValue(
      new Error("rate limited"),
    );

    renderChangelogView();

    await waitFor(() => {
      expect(
        getCommitStatValueElement(/Commits this month/).textContent,
      ).toBe("\u2014");
    });

    const thisMonth = getCommitStatValueElement(/Commits this month/);
    expect(thisMonth).toHaveAttribute("aria-busy", "false");
    expect(getCommitStatValueElement(/All-time commits/).textContent).toBe(
      "\u2014",
    );
  });

  it("treats a partial all-time-zero aggregate as unavailable (dash, not 0)", async () => {
    vi.spyOn(githubCommits, "fetchAuraCommitStats").mockResolvedValue({
      commitsThisMonth: 0,
      commitsAllTime: 0,
      perRepo: Object.fromEntries(
        githubCommits.AURA_PUBLIC_REPOS.map((repo) => [
          repo,
          { thisMonth: 0, allTime: 0 },
        ]),
      ),
      monthKey: CURRENT_PST_MONTH_KEY,
      fetchedAt: new Date().toISOString(),
      partial: true,
    });

    renderChangelogView();

    await waitFor(() => {
      expect(
        getCommitStatValueElement(/All-time commits/).textContent,
      ).toBe("\u2014");
    });
    expect(getCommitStatValueElement(/Commits this month/).textContent).toBe(
      "\u2014",
    );
  });

  it("falls back to the last-known cached totals when a later fetch degrades", async () => {
    window.localStorage.setItem(
      "aura.changelog.commitStats.v2",
      JSON.stringify({
        commitsThisMonth: 12,
        commitsAllTime: 3456,
        monthKey: CURRENT_PST_MONTH_KEY,
      }),
    );
    vi.spyOn(githubCommits, "fetchAuraCommitStats").mockRejectedValue(
      new Error("rate limited"),
    );

    renderChangelogView();

    await waitFor(() => {
      expect(
        getCommitStatValueElement(/All-time commits/).textContent,
      ).toBe("3,456");
    });
    expect(getCommitStatValueElement(/Commits this month/).textContent).toBe(
      "12",
    );
  });

  it("shows 0 for this-month (but keeps all-time) when the snapshot is from a previous month", async () => {
    vi.spyOn(githubCommits, "fetchAuraCommitStats").mockResolvedValue({
      commitsThisMonth: 999,
      commitsAllTime: 9421,
      perRepo: Object.fromEntries(
        githubCommits.AURA_PUBLIC_REPOS.map((repo) => [
          repo,
          { thisMonth: 0, allTime: 0 },
        ]),
      ),
      // A month key that can never equal the current PST month so the
      // this-month figure is treated as stale across the rollover.
      monthKey: "1999-01",
      fetchedAt: new Date().toISOString(),
      partial: false,
    });

    renderChangelogView();

    await waitFor(() => {
      expect(
        getCommitStatValueElement(/All-time commits/).textContent,
      ).toBe("9,421");
    });
    // Stale-month snapshots no longer carry last month's count into the
    // current month; this-month resets to 0 (matching "releases this
    // month") until the next release refreshes the snapshot.
    expect(getCommitStatValueElement(/Commits this month/).textContent).toBe(
      "0",
    );
  });

  it("prefers the snapshot's release counts over the changelog-derived figures", async () => {
    vi.spyOn(githubCommits, "fetchAuraCommitStats").mockResolvedValue({
      commitsThisMonth: 137,
      commitsAllTime: 9421,
      releasesThisMonth: 4,
      releasesAllTime: 210,
      perRepo: Object.fromEntries(
        githubCommits.AURA_PUBLIC_REPOS.map((repo) => [
          repo,
          { thisMonth: 0, allTime: 0 },
        ]),
      ),
      monthKey: CURRENT_PST_MONTH_KEY,
      fetchedAt: new Date().toISOString(),
      partial: false,
    });

    renderChangelogView();

    // The changelog index isn't mocked here, so its derived release
    // counts are 0; seeing the snapshot's numbers proves it wins.
    await waitFor(() => {
      expect(
        getCommitStatValueElement(/Releases this month/).textContent,
      ).toBe("4");
    });
    expect(getCommitStatValueElement(/All-time releases/).textContent).toBe(
      "210",
    );
  });

  it("shows 0 releases this month for a stale-month snapshot but keeps all-time releases", async () => {
    vi.spyOn(githubCommits, "fetchAuraCommitStats").mockResolvedValue({
      commitsThisMonth: 999,
      commitsAllTime: 9421,
      releasesThisMonth: 99,
      releasesAllTime: 210,
      perRepo: Object.fromEntries(
        githubCommits.AURA_PUBLIC_REPOS.map((repo) => [
          repo,
          { thisMonth: 0, allTime: 0 },
        ]),
      ),
      monthKey: "1999-01",
      fetchedAt: new Date().toISOString(),
      partial: false,
    });

    renderChangelogView();

    await waitFor(() => {
      expect(
        getCommitStatValueElement(/All-time releases/).textContent,
      ).toBe("210");
    });
    // Stale-month snapshot: this-month release figure is gated off and
    // falls back to the changelog-derived 0.
    expect(getCommitStatValueElement(/Releases this month/).textContent).toBe(
      "0",
    );
  });

  it("renders Current Version as a stat block in the card header (top-right) with the version number, release age, Download and GitHub links", async () => {
    // Anchor the timestamp 2 hours before the actual test-runner clock
    // so the relative-time string is deterministic ("2 hours ago")
    // without us having to stand up a fake timer (which would interfere
    // with React Query's internal scheduling here).
    const generatedAt = new Date(
      Date.now() - 2 * 60 * 60 * 1000,
    ).toISOString();
    const fakeEntry: ChangelogEntry = {
      repo: "aura-os",
      date: "2026-05-28",
      channel: "nightly",
      version: "1.2.3",
      generatedAt,
      releaseUrl: "https://github.com/cypher-asi/aura-os/releases/tag/v1.2.3",
      rawCommitCount: 0,
      filteredCommitCount: 0,
      rendered: {
        title: "Test release",
        intro: "",
        highlights: [],
        entries: [],
      },
    };

    vi.spyOn(changelogApi, "fetchChangelogEntries").mockResolvedValue([
      fakeEntry,
    ]);

    renderChangelogView();

    // Label and value render in the same stat block, which now lives
    // in the top-right of the card header — confirm both the class and
    // the parent `<header>` so future markup moves don't silently
    // reintroduce the in-grid placement.
    const label = await screen.findByText(/Current version/i);
    const stat = label.closest(".changelogStat");
    expect(stat).not.toBeNull();
    expect(stat).toHaveClass("changelogStatVersion");
    expect(stat!.closest("header")).not.toBeNull();
    expect(stat!.closest("header")).toHaveClass("changelogStatsCardHeader");

    const value = stat!.querySelector(".changelogStatValue");
    expect(value?.textContent).toBe("1.2.3");

    const time = stat!.querySelector("time");
    expect(time?.textContent).toMatch(/Released 2 hours ago/);
    expect(time).toHaveAttribute("datetime", generatedAt);

    // The Current Version stat block hosts two links: an in-app
    // /download link (router-handled) and an external GitHub link that
    // opens the aura-os repo in a new tab.
    const links = stat!.querySelectorAll<HTMLAnchorElement>("a");
    expect(links.length).toBe(2);

    const [downloadLink, githubLink] = Array.from(links);
    expect(downloadLink).toHaveAttribute("href", "/download");
    expect(downloadLink.textContent).toMatch(/Download/);
    expect(downloadLink.getAttribute("target")).not.toBe("_blank");

    expect(githubLink).toHaveAttribute(
      "href",
      "https://github.com/cypher-asi/aura-os",
    );
    expect(githubLink).toHaveAttribute("target", "_blank");
    expect(githubLink.getAttribute("rel") ?? "").toMatch(/noopener/);
    expect(githubLink.getAttribute("rel") ?? "").toMatch(/noreferrer/);
    expect(githubLink.textContent).toMatch(/GitHub/);
  });

  it("hides the Download/GitHub links and version download in embedded mode", async () => {
    // In the in-app modal (embedded), the out-of-app affordances are hidden:
    // an in-app user updates via Settings, not a web download, and shouldn't
    // be punted out to GitHub. The version/"Released …" info still shows.
    const generatedAt = new Date(
      Date.now() - 2 * 60 * 60 * 1000,
    ).toISOString();
    const fakeEntry: ChangelogEntry = {
      repo: "aura-os",
      date: "2026-05-28",
      channel: "nightly",
      version: "1.2.3",
      generatedAt,
      releaseUrl: "https://github.com/cypher-asi/aura-os/releases/tag/v1.2.3",
      rawCommitCount: 0,
      filteredCommitCount: 0,
      rendered: { title: "Test release", intro: "", highlights: [], entries: [] },
    };

    vi.spyOn(changelogApi, "fetchChangelogEntries").mockResolvedValue([
      fakeEntry,
    ]);

    renderChangelogView(true);

    const label = await screen.findByText(/Current version/i);
    const stat = label.closest(".changelogStat")!;

    // Version + release age still show (info, not links).
    const value = stat.querySelector(".changelogStatValue");
    expect(value?.textContent).toBe("1.2.3");
    expect(stat.querySelector("time")?.textContent).toMatch(/Released 2 hours ago/);

    // No Download/GitHub links, and the version is plain text — not the
    // click-to-download button used on the public page.
    expect(stat.querySelectorAll("a").length).toBe(0);
    expect(stat.querySelector(".changelogStatValueButton")).toBeNull();
    expect(stat.querySelector("button")).toBeNull();
  });

  it("auto-downloads the platform-specific installer when the version button is clicked", async () => {
    // Pretend the visitor is on Windows so detectDownloadPlatform()
    // returns "windows" deterministically.
    Object.defineProperty(window, "navigator", {
      configurable: true,
      writable: true,
      value: new Proxy(window.navigator, {
        get(target, prop) {
          if (prop === "platform") return "Win32";
          if (prop === "userAgent")
            return "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
          if (prop === "userAgentData") return { platform: "Windows" };
          return Reflect.get(target, prop, target);
        },
      }),
    });

    const generatedAt = new Date(
      Date.now() - 2 * 60 * 60 * 1000,
    ).toISOString();
    const fakeEntry: ChangelogEntry = {
      repo: "aura-os",
      date: "2026-05-28",
      channel: "nightly",
      version: "0.1.0-nightly.562.1",
      generatedAt,
      releaseUrl:
        "https://github.com/cypher-asi/aura-os/releases/tag/nightly-562.1",
      rawCommitCount: 0,
      filteredCommitCount: 0,
      rendered: {
        title: "Test release",
        intro: "",
        highlights: [],
        entries: [],
      },
    };

    const windowsInstallerUrl =
      "https://github.com/cypher-asi/aura-os/releases/download/nightly-562.1/aura-os-desktop_0.1.0_x64-setup.exe";
    const manifest: DesktopManifest = {
      channel: "nightly",
      version: "0.1.0-nightly.562.1",
      release_url:
        "https://github.com/cypher-asi/aura-os/releases/tag/nightly-562.1",
      desktop: {
        windows: { url: windowsInstallerUrl },
        linux: { url: "https://example.invalid/linux" },
        mac: {
          "apple-silicon": { url: "https://example.invalid/mac-arm" },
          intel: { url: "https://example.invalid/mac-intel" },
        },
      },
    };

    vi.spyOn(changelogApi, "fetchChangelogEntries").mockResolvedValue([
      fakeEntry,
    ]);
    const fetchManifestSpy = vi
      .spyOn(desktopManifest, "fetchDesktopManifest")
      .mockResolvedValue(manifest);

    // jsdom's `window.location` doesn't honor `href` assignments and
    // logs a navigation warning. Capture the assignment via a Proxy so
    // we can assert against it without crashing.
    let navigatedTo: string | null = null;
    const locationProxy = new Proxy(window.location, {
      set(target, prop, value) {
        if (prop === "href") {
          navigatedTo = String(value);
          return true;
        }
        return Reflect.set(target, prop, value);
      },
    });
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: locationProxy,
    });

    renderChangelogView();

    const versionButton = (await screen.findByRole("button", {
      name: /Download AURA 0\.1\.0-nightly\.562\.1/i,
    })) as HTMLButtonElement;
    expect(versionButton.tagName.toLowerCase()).toBe("button");

    // Wait for the prefetched manifest to land before clicking, so the
    // click handler reads the resolved manifest URL rather than the
    // entry-level fallback.
    await waitFor(() => {
      expect(fetchManifestSpy).toHaveBeenCalledWith(
        "nightly",
        expect.anything(),
      );
    });
    await waitFor(() => {
      expect(fetchManifestSpy.mock.results[0]?.value).toBeDefined();
    });

    fireEvent.click(versionButton);

    await waitFor(() => {
      expect(navigatedTo).toBe(windowsInstallerUrl);
    });
  });
});
