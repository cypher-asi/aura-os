/**
 * Source of truth for the six agent personas surfaced on the public
 * chat surface (`PublicChatView`) via the right-edge
 * `PersonaTickRail`. Each entry pairs a stable id + display name
 * with an optional visual theme that re-skins the public chat surface
 * the moment the visitor hovers, focuses, or clicks the matching
 * tick.
 *
 * The shape is intentionally pure data — no React, no DOM — so
 * adding a new persona or swapping a theme is a one-line edit to
 * `PERSONAS` below. Theme assets live under
 * `interface/public/personas/<id>/` and are referenced by absolute
 * URL so Vite serves them directly without bundling.
 *
 * Adding a persona / theme
 * ------------------------
 * 1. Drop the wallpaper image at
 *    `interface/public/personas/<persona-id>/desktop.png` and the
 *    page-level background at
 *    `interface/public/personas/<persona-id>/site.png` (or any
 *    extension Vite knows about).
 * 2. Append a `{ id, name, theme: { ... } }` entry to `PERSONAS`.
 * 3. The rail picks up the new tick automatically — the tick rail
 *    renders one tick per `PERSONAS` entry, so the visible column
 *    grows with the array.
 *
 * Leaving any theme field as `null` keeps the existing default for
 * that surface (e.g. `desktopBackgroundUrl: null` keeps the
 * `MockAuraApp` video loop in place; `siteBackgroundColor: null`
 * keeps the shell's normal page color).
 */

export interface PersonaTheme {
  /**
   * Static image URL painted as the wallpaper inside the
   * `MockAuraApp` frame. When `null`, `MockAuraApp` falls back to
   * the default `/AURA_visual_loop.mp4` video loop.
   */
  readonly desktopBackgroundUrl: string | null;
  /**
   * Optional looping video URL painted as the wallpaper inside the
   * `MockAuraApp` frame INSTEAD of the static `desktopBackgroundUrl`
   * image. When set, `MockAuraApp` renders an autoplaying, muted,
   * looped `<video>` (using the same fit/position/scale/offset
   * controls as the image). `desktopBackgroundUrl` is still used as
   * the dock avatar source, so keep both pointed at the same figure.
   */
  readonly desktopBackgroundVideoUrl?: string | null;
  /**
   * Optional `object-position` override for the wallpaper `<img>`
   * inside the `MockAuraApp` frame. Only meaningful when
   * `desktopBackgroundFit` resolves to `"cover"` (the default) —
   * `contain` mode never crops, so `object-position` only nudges
   * a letterboxed image within its bars (rarely useful). The
   * default (`null`) leaves the browser default of `50% 50%` —
   * center-cropped on both axes — which is correct for most
   * wallpapers.
   *
   * Set this when a curated portrait needs a non-centered crop —
   * e.g. a head-and-shoulders shot whose subject is in the upper
   * third of the source asset and would otherwise get sliced
   * mid-chest by the default center crop. Any valid CSS
   * `object-position` value works (`"center 20%"`,
   * `"50% top"`, two-keyword forms, etc.).
   */
  readonly desktopBackgroundPosition: string | null;
  /**
   * `object-fit` mode for the wallpaper `<img>`. Defaults to
   * `"cover"` when `null` — the image fills the 16:10 mock
   * window, cropping whichever axis overflows. Switch to
   * `"contain"` when the source is a tall portrait (or any other
   * non-16:10 asset) that you want to display in full instead of
   * cropping; pair it with `desktopBackgroundColor` set to the
   * dominant tone of the image so the letterbox bars blend with
   * the artwork's own background.
   */
  readonly desktopBackgroundFit: "cover" | "contain" | null;
  /**
   * Solid color painted behind the wallpaper `<img>` inside the
   * `MockAuraApp` frame. Defaults to the frame's own near-black
   * fill when `null`. Pair this with
   * `desktopBackgroundFit: "contain"` and a sampled match of the
   * image's natural background so the letterbox bars left by
   * `contain` mode look like an extension of the artwork rather
   * than dark bands cutting it off.
   */
  readonly desktopBackgroundColor: string | null;
  /**
   * Multiplier applied as a `transform: scale(N)` on the wallpaper
   * `<img>` to zoom the rendered image in (>1) or out (<1) from
   * its baseline `object-fit` size. Defaults to no transform when
   * `null` (i.e. the image renders at its natural `cover`/`contain`
   * size). Use values like `1.2` to push the figure a notch
   * larger inside a `contain`-fit wallpaper without re-cropping
   * the source asset. `.appFrame` carries `overflow: hidden` so
   * scaled-up content is clipped cleanly to the mock window
   * rectangle.
   */
  readonly desktopBackgroundScale: number | null;
  /**
   * Optional vertical translation applied to the wallpaper `<img>`
   * AFTER `desktopBackgroundScale`, expressed as a percent of the
   * frame height (positive = pull image DOWN, negative = push UP).
   * Composed as `translateY(N%) scale(...)`; CSS applies the
   * rightmost transform first so the percent is screen-space
   * relative to the 16:10 frame, not to the pre-scale image size,
   * and the offset stays proportional at any viewport size.
   *
   * Useful when `desktopBackgroundFit: "contain"` plus a scale > 1
   * crops the source vertically and the default frame-centered
   * crop window lands too high on the figure (e.g. the helmet sits
   * pinned to the top of the visible band). A small positive value
   * like `8` shifts the visible window up the source so the focal
   * subject sits more centered in the frame. `null` = no
   * translation.
   */
  readonly desktopBackgroundOffsetY: number | null;
  /**
   * Static image URL painted as the page background behind the
   * whole `PublicChatView` (i.e. the area surrounding the
   * `MockAuraApp` rectangle). Applied via inline `background-image`
   * on the `.chatView` container with `cover` sizing.
   */
  readonly siteBackgroundUrl: string | null;
  /**
   * Solid color paired with `siteBackgroundUrl` — paints under the
   * image so the page never flashes the shell color while the asset
   * is still loading. Also serves as the sole site background when
   * `siteBackgroundUrl` is `null`.
   */
  readonly siteBackgroundColor: string | null;
  /**
   * When `true`, the page background for this persona is painted by
   * an animated WebGL flow/noise field (`FlowFieldBackground`) tinted
   * by `siteBackgroundColor`, instead of the static `siteBackgroundUrl`
   * `<img>`. `siteBackgroundColor` still paints underneath as the
   * pre-GL base tint, and `siteBackgroundUrl` (when set) remains the
   * graceful fallback if WebGL is unavailable. Optional — omit (or
   * leave `false`) to keep the default static-image behavior.
   */
  readonly siteBackgroundFlow?: boolean;
  /**
   * When `true`, the page background for this persona is painted full-
   * bleed by `ScreenOrbBackground` — the same flowing plasma animation
   * (palette + domain-warped marble + travelling ridges) used in the
   * `/agents` "Delegate everything" hero orb, but rendered opaque and
   * edge-to-edge across the whole viewport (no pill mask), exactly like
   * the Vibecoder `FlowFieldBackground` purple field. `siteBackgroundColor`
   * paints underneath as the pre-GL base tint (and the WebGL-unavailable
   * fallback), so pair this with a dark base. Optional — omit (or leave
   * `false`) to keep the default static-image / flow behavior. Takes
   * precedence over `siteBackgroundFlow` when both are set.
   */
  readonly siteBackgroundOrb?: boolean;
  /**
   * Strong foreground color (active / hover) for chrome that floats
   * over the persona's site background — currently the active tick
   * in `PersonaTickRail` and the hovered link in
   * `PublicSidebarFooter`. When `null` the default
   * `--color-text-primary` paints, which is correct for dark / video
   * backgrounds. Set to a hard contrast value (e.g. `#1a1a1a`) for
   * personas whose `siteBackgroundUrl` is light enough that the
   * default near-white token washes out.
   *
   * Published as the `--public-nav-fg-color` custom property on
   * `document.documentElement` while the persona is active so the
   * public nav footer (a sibling outside `PublicChatView`'s subtree)
   * can read the same value.
   */
  readonly siteForegroundColor: string | null;
  /**
   * Muted foreground color (idle) paired with `siteForegroundColor`.
   * Used by idle ticks and idle public nav links so the existing two-
   * level hierarchy (secondary -> primary on hover/active) survives a
   * persona contrast override. When `null` the default
   * `--color-text-secondary` paints.
   *
   * Published as `--public-nav-fg-color-muted` on
   * `document.documentElement` while the persona is active.
   */
  readonly siteForegroundColorMuted: string | null;
  /**
   * Explicit override for the landing hero tagline ("Your Private
   * Agent." etc.) color, published as `--hero-headline-color`. By
   * default the tagline polarity is derived from `siteForegroundColor`
   * (light/unset nav fg -> white tagline; dark nav fg -> that dark
   * color). Set this when the tagline needs a DIFFERENT polarity than
   * the nav — e.g. a persona whose page bg is dark (so the nav stays
   * light) but whose hero band sits over a bright patch where a dark
   * tagline reads better. Optional — omit (or leave `null`) to keep the
   * derived behavior.
   */
  readonly heroHeadlineColor?: string | null;
  /**
   * Neon accent color used for the public CTA's glowing border and
   * bloom shadow (the "Create your agent" pill in `PublicChatView`).
   * Published as `--public-cta-glow-color` on `.chatView` while this
   * persona is active so only the CTA reads it. When `null` the CSS
   * default — a neon violet matching the reference — paints, which
   * is correct for personas with a dark / video site background.
   *
   * Override on personas whose `siteBackgroundColor` would wash out
   * the default violet: pick a hue that pops off the page bg (warm
   * accent on cool washes, cool accent on warm washes). The glow is
   * the only surface that consumes this value, so changing it never
   * affects the rail, the public nav footer, or the chat palette.
   */
  readonly siteCtaGlowColor: string | null;
  /**
   * Per-persona crop hint for the bottom-left avatar dock inside
   * `MockAuraApp`. The dock reuses `desktopBackgroundUrl` as the
   * avatar image and zooms ~2x via `background-size: 200%`, so a
   * `background-position` value here decides which slice of the
   * source portrait lands in the 18px circle. When `null` the dock
   * falls back to `"50% 18%"` — the upper-third sweet spot where
   * the head sits in every existing character portrait.
   *
   * NO_THEME personas don't paint an avatar image at all (they
   * render an initial-letter fallback instead), so this field is
   * ignored for them.
   */
  readonly avatarObjectPosition: string | null;
}

export interface Persona {
  /**
   * Stable kebab-case id. Used as the asset folder name under
   * `interface/public/personas/<id>/` and as a React list key so
   * renaming `name` never reorders existing personas.
   */
  readonly id: string;
  /** Display label shown inside the rail's hover panel. */
  readonly name: string;
  /**
   * Short tagline rendered alongside `name` on surfaces that need a
   * descriptor — e.g. the hover overlay on the product page's
   * `<AgentMarquee />` row, where each card flips from a bare
   * portrait into a "Name / Role" caption when hovered.
   *
   * Kept intentionally short (2–3 words) so the caption fits on a
   * single line inside the marquee card without truncation. The
   * field is required so every persona ships a label and the
   * marquee never has to fall back to displaying just the name.
   */
  readonly role: string;
  /** Visual override applied when this persona is the active tick. */
  readonly theme: PersonaTheme;
}

export const PERSONAS: ReadonlyArray<Persona> = [
  {
    // The default landing persona — first tick, `activeIndex` starts
    // at 0 so this is what a logged-out visitor sees on first paint.
    id: "creator",
    name: "Creator",
    role: "Creator",
    theme: {
      // Portrait of the red-haired figure on a near-white studio field.
      // Painted `cover` so the looping clip fills the whole 16:10 mock
      // window edge-to-edge (down to the taskbar) with no letterbox gap;
      // the source is wider than the frame, so cover crops the sides and
      // keeps the full figure height visible top-to-bottom.
      desktopBackgroundUrl: "/personas/creator/desktop.png",
      // Looping clip of the same red-haired figure (keeps the static
      // PNG above as the dock avatar source + video poster fallback).
      desktopBackgroundVideoUrl: "/personas/creator/desktop.mp4",
      desktopBackgroundPosition: null,
      desktopBackgroundFit: "cover",
      // Sampled near-white of the source's studio backdrop — shows only
      // briefly under the video before it paints.
      desktopBackgroundColor: "#f3f3f3",
      desktopBackgroundScale: null,
      desktopBackgroundOffsetY: null,
      // Page background is the live full-screen WebGL plasma — the
      // same animation as the `/agents` "Delegate everything" hero,
      // rendered edge-to-edge like the Vibecoder purple field.
      siteBackgroundUrl: null,
      // Dark base painted under the orb before the GL paints (and the
      // WebGL-unavailable fallback); also feeds `deriveChatPalette` for
      // a dark chat bubble palette. Matches the AgentConsole stage's
      // deepest gradient stop so the surround reads as one dark field.
      siteBackgroundColor: "#0c0c0c",
      siteBackgroundOrb: true,
      // Light nav / tick foreground floats legibly over the dark,
      // luminous orb.
      siteForegroundColor: "#e6e8eb",
      siteForegroundColorMuted: "#c9c9cf",
      // Dark hero tagline variant: the "Your private agent." headline
      // sits over the brightest part of the warm plasma, where pure
      // white washes out — a near-black tagline reads with full
      // contrast while the nav/tick chrome stays light.
      heroHeadlineColor: "#0a0a0a",
      // Default neon-violet CTA bloom reads cleanly against the dark
      // plasma page bg.
      siteCtaGlowColor: null,
      // Nudge the 2x-zoomed avatar dock crop down from the shared
      // `50% 18%` so the face (sitting around the upper-middle of this
      // landscape source) lands centered in the 18px circle.
      avatarObjectPosition: "50% 28%",
    },
  },
  {
    id: "vibecoder",
    name: "Vibecoder",
    role: "Creative coder",
    theme: {
      // Cyberpunk portrait fills the mock desktop window's
      // wallpaper rectangle. The source is a 1024×1024 square
      // head-and-shoulders shot of the AURA-jacket character on
      // a saturated pink field. The figure was authored at the
      // image's natural center (head leans slightly right, body
      // slightly left — natural pose with negligible net
      // horizontal offset), so no asset pre-processing is needed
      // to keep the visor centered inside the wallpaper window.
      //
      // Uses the same shape as the other curated personas
      // (`solo-builder`, `coordinator`): default `cover` fit
      // with an `object-position` tweak to control which slice
      // survives the vertical crop. Sharing one fit mode across
      // personas means switching ticks cross-fades cleanly
      // between two correctly-positioned wallpapers (the fade
      // is driven by `MockAuraApp`) instead of jumping between
      // `contain` + scale + frame-bg-color overrides.
      desktopBackgroundUrl: "/personas/vibecoder/desktop.png",
      // Position is irrelevant under `contain` (the image fits
      // entirely inside the frame and there is no crop axis to
      // anchor). Leave null and document the fact rather than
      // setting a misleading value that suggests the position
      // does something here.
      desktopBackgroundPosition: null,
      // `contain` shows the full source vertically: the
      // 1024×1024 square fits to the frame's 1000px height and
      // the leftover ~600px of frame width becomes horizontal
      // letterbox bars. Switched from `cover` because that mode
      // was cropping ~37% of the source's height to fill the
      // frame width — the user explicitly wants the figure read
      // end-to-end top to bottom.
      desktopBackgroundFit: "contain",
      // Matches the sampled hot-pink corners of the source
      // (~`#ea3580`). With `contain` fit it paints the
      // horizontal letterbox bars on either side of the
      // centered image; the source's own pink bg then appears
      // to extend seamlessly to the window edges instead of
      // revealing the default near-black appFrame fill behind
      // the bars.
      desktopBackgroundColor: "#ea3580",
      // Zoom in 10% from the `contain` baseline. The painted
      // contain rectangle (1000×1000 inside a 1600×1000 frame)
      // scales to 1100×1100 around the frame center: the figure
      // grows 10% larger, the horizontal letterbox bars shrink
      // from 300px to 250px each side, and a ~4.5% slice at
      // the top / bottom of the source falls outside the frame
      // and gets trimmed by `.appFrame`'s `overflow: hidden`.
      // The matching pink bg above still fills the (narrower)
      // letterbox bars so the seam stays invisible.
      desktopBackgroundScale: 1.1,
      // Default-centered crop is correct for this 1024×1024
      // square portrait — the figure is authored centered in
      // the source so no vertical translation is needed.
      desktopBackgroundOffsetY: null,
      // Deep purple-violet gradient with diagonal light streaks
      // painted as the page bg behind the mock desktop window —
      // the cool atmospheric backdrop offsets the hot pink
      // portrait inside the window without competing for
      // attention.
      siteBackgroundUrl: "/personas/vibecoder/site.png",
      // Mid-tone of the gradient (sampled from the image's
      // center band) so the page paints a matching deep purple
      // immediately on first paint and there is no dark flash
      // before the static asset finishes loading.
      siteBackgroundColor: "#2a0258",
      // Paint this persona's page bg as an animated WebGL flow/noise
      // field tinted by `siteBackgroundColor` rather than the static
      // `site.png`. The image above stays as the no-WebGL fallback.
      siteBackgroundFlow: true,
      // Pin the dark-mode `--color-text-primary` / `--color-text-
      // secondary` hex pair (sampled from `vendor/zui/src/styles/
      // themes.css` and `interface/src/styles/tokens.css`) rather
      // than leaving these null and letting the CSS fallbacks walk
      // through `--color-text-*`. The persona's `siteBackgroundColor`
      // is theme-invariant — `#2a0258` paints in both light and dark
      // user theme — so the nav / tick foreground must be theme-
      // invariant too, otherwise light-mode visitors see the muted
      // token collapse to near-black `#374151` on the deep-purple bg
      // and the public nav strip becomes unreadable.
      siteForegroundColor: "#e6e8eb",
      siteForegroundColorMuted: "#c9c9cf",
      // CTA keeps the default neon-violet bloom which is tuned
      // to pop against the deep purple page bg.
      siteCtaGlowColor: null,
      // Default `50% 18%` framing keeps the visor + face centered
      // inside the 18px circle once the dock zooms in 2x on the
      // 1024x1024 source — the figure was authored with the head
      // near the top so no per-persona override is needed.
      avatarObjectPosition: null,
    },
  },
  {
    id: "solo-builder",
    name: "Solo Builder",
    role: "Indie engineer",
    theme: {
      desktopBackgroundUrl: "/personas/solo-builder/desktop.png",
      // Position is irrelevant under `contain` (the image fits
      // entirely inside the frame and there is no crop axis to
      // anchor). Same shape as Vibecoder / Cypher Punk below.
      desktopBackgroundPosition: null,
      // `contain` shows the full source vertically: the
      // 1024×1024 square fits to the frame's 1000px height and
      // the leftover ~600px of frame width becomes horizontal
      // letterbox bars. Matches Vibecoder + Cypher Punk so the
      // figure renders at the same visible size across all three
      // character-portrait personas — cross-fading between them
      // is a clean image dissolve with no size jump.
      desktopBackgroundFit: "contain",
      // Sampled midpoint of the source's left/right edges,
      // which run from `#7ea2b0` at the top to `#7195a5` at the
      // bottom in a gentle vertical gradient. `#7a9eac` sits
      // right in the middle of that range, so the seam between
      // the letterbox bar and any image edge stays imperceptible
      // along the full height of the frame.
      desktopBackgroundColor: "#7a9eac",
      // Calibrated against the Vibecoder + Cypher Punk `1.1`
      // baseline. The Solo Builder source authors its helmeted
      // figure smaller within its own 1024×1024 frame than the
      // other two character portraits (whose hair / hood reach
      // the top edge and whose shoulders reach the bottom edge),
      // so the right number for "matching visual presence" is
      // landed by eye rather than by math. Current value started
      // from a `0.85` test and was bumped up 25% from there per
      // direct user feedback.
      desktopBackgroundScale: 1.221875,
      // Centered crop reads correctly for this 1024×1024 source.
      desktopBackgroundOffsetY: null,
      siteBackgroundUrl: "/personas/solo-builder/site.png",
      // Sampled from the dominant mid-tone of `site.png` so the page
      // paints a matching dusty-blue immediately on first paint and
      // there is no dark flash before the image finishes loading.
      siteBackgroundColor: "#b3c4d2",
      // The dusty-blue site is light enough that the default
      // near-white nav/tick tokens wash out. Override with a near-
      // black pair so the public nav links and the right-edge
      // tick column stay legible — strong for active/hover, muted
      // for idle. Both are intentionally close to pure black; the
      // 16-point gap is just enough hierarchy for the hover state
      // to read without sacrificing idle legibility on the bg.
      siteForegroundColor: "#0a0a0a",
      siteForegroundColorMuted: "#1a1a1a",
      // Warm coral accent contrasts cleanly against the dusty-blue
      // site bg so the CTA's neon border + bloom read as a separate
      // light source instead of melting into the page color.
      siteCtaGlowColor: "#ff7a59",
      // Default framing — the helmeted figure is centered in the
      // 1024x1024 source with the helmet brim near the top edge,
      // so the shared `50% 18%` slice lands the visor on the
      // vertical centerline of the 18px avatar circle.
      avatarObjectPosition: null,
    },
  },
  {
    id: "giga-brain",
    name: "Giga Brain",
    role: "Research lead",
    theme: {
      // Chrome-visor figure on a soft cream studio field — a
      // woman in a cream hooded fleece zipper jacket, head
      // wrapped in a mirror-finish chrome helmet (dome visor +
      // jaw guard + chrome neck collar). Source is a 1024×1024
      // square, same aspect as the Vibecoder / Cypher Punk
      // portraits, so the wallpaper framing inherits the same
      // `contain` + matching-frame-bg math: the figure renders
      // end-to-end vertically and the sampled cream paints the
      // horizontal letterbox bars so the source's own backdrop
      // appears to extend to the window edges with no visible
      // seam.
      //
      // The page-level surround (`siteBackgroundColor` below)
      // is painted in the same flat cream so the area outside
      // the mock window reads as one continuous backdrop with
      // the photo's own studio field — the chrome figure inside
      // the mock window then floats on a uniform cream
      // composition that runs corner to corner of the viewport.
      desktopBackgroundUrl: "/personas/giga-brain/desktop.png",
      // Position is irrelevant under `contain` (the image fits
      // entirely inside the frame and there is no crop axis to
      // anchor). Same shape as the other character portraits.
      desktopBackgroundPosition: null,
      desktopBackgroundFit: "contain",
      // User-picked cream `#e3d8cc` (sampled from a flat color
      // swatch — averaged R=227 G=216 B=204 across the swatch).
      // Sits within ~3 levels of every channel of the source
      // photo's own studio backdrop (gradient runs from ~`#e9dfd0`
      // top to ~`#dccfba` bottom), so the seam between the
      // letterbox bar painted at this color and the image edge
      // stays imperceptible along the full height of the frame.
      // Identical to `siteBackgroundColor` below so the bars
      // visually continue into the page surround as one
      // unbroken cream plane.
      desktopBackgroundColor: "#e3d8cc",
      // Zoom in 10% from the `contain` baseline — matches the
      // Vibecoder + Cypher Punk scale exactly so all three
      // 1024×1024 character portraits render at the same
      // visible 1100×1100 size, keeping cross-fades between
      // them a clean dissolve with no size jump. The painted
      // contain rectangle (1000×1000 inside a 1600×1000 frame)
      // scales to 1100×1100 around the frame center: the figure
      // grows 10% larger, the horizontal letterbox bars shrink
      // from 300px to 250px each side, and a ~4.5% slice at
      // the top / bottom of the source falls outside the frame
      // and gets trimmed by `.appFrame`'s `overflow: hidden`.
      // The matching cream bg above still fills the (narrower)
      // letterbox bars so the seam stays invisible.
      desktopBackgroundScale: 1.1,
      // Default-centered crop is correct for this 1024×1024
      // square portrait — no vertical nudge needed.
      desktopBackgroundOffsetY: null,
      // No surrounding site image — the page paints a flat
      // user-picked cream behind the `MockAuraApp` rectangle so
      // the chrome-helmeted portrait inside the mock window
      // sits on the same uniform studio field that fills the
      // viewport.
      siteBackgroundUrl: null,
      // Same `#e3d8cc` cream the user sampled from a flat color
      // swatch — paints both the page surround AND (above) the
      // letterbox bars inside the mock window, so the entire
      // public chat surface reads as one continuous cream plane
      // with the chrome character floating in the mock window
      // at its center.
      siteBackgroundColor: "#e3d8cc",
      // The cream wash is light enough that the default near-
      // white nav/tick tokens lose contrast against it. Mirror
      // the `solo-builder` / `coordinator` approach: near-black
      // for active/hover, a slightly lighter near-black for
      // idle, so the public nav footer (bottom-left links) and
      // right-edge tick rail keep a legible two-step hierarchy
      // on the bg.
      siteForegroundColor: "#0a0a0a",
      siteForegroundColorMuted: "#1a1a1a",
      // Cool electric blue accent — pops cleanly off the warm
      // cream page bg (which would wash out the default neon
      // violet) and resonates with the cool chrome highlights
      // on the helmet, so the CTA's neon border + bloom read
      // as if lit by the same reflective surfaces as the
      // character.
      siteCtaGlowColor: "#3b82f6",
      // Default `50% 18%` framing keeps the chrome visor +
      // helmet centered inside the 18px avatar circle once the
      // dock zooms in 2x on the 1024×1024 source — the head
      // sits in the upper third of the source like every other
      // curated portrait, so no per-persona override is needed.
      avatarObjectPosition: null,
    },
  },
  {
    id: "coordinator",
    name: "Coordinator",
    role: "Team orchestrator",
    theme: {
      // Helmeted "WILDER WORLD / CYPHER / AURA" figure on a cool
      // steel-blue studio field. Source is a 1024×1024 square,
      // same aspect as the Vibecoder / Cypher Punk / Giga Brain
      // portraits, so the wallpaper framing inherits the same
      // canonical `contain` + matching-frame-bg math: the figure
      // renders end-to-end vertically and the sampled steel-blue
      // paints the horizontal letterbox bars so the source's own
      // backdrop appears to extend to the window edges with no
      // visible seam.
      desktopBackgroundUrl: "/personas/coordinator/desktop.png",
      // Position is irrelevant under `contain` (the image fits
      // entirely inside the frame and there is no crop axis to
      // anchor). Same shape as the other character portraits.
      desktopBackgroundPosition: null,
      // `contain` shows the full source vertically: the
      // 1024×1024 square fits to the frame's 1000px height and
      // the leftover ~600px of frame width becomes horizontal
      // letterbox bars. Matches Vibecoder / Cypher Punk / Giga
      // Brain so the figure renders at the same visible size
      // across all four square-source character portraits —
      // cross-fading between them is a clean image dissolve
      // with no size jump.
      desktopBackgroundFit: "contain",
      // Sampled mid-tone of the asset's cool blue-gray field
      // (`#7d9fad`, picked directly off the source's upper expanse
      // around the helmet — the prior `#7c919a` guess sat noticeably
      // more desaturated than the actual asset, leaving the letterbox
      // bars looking gray next to the saturated cyan-blue image
      // edges). The asset itself runs a gentle vertical gradient
      // (~`#87a7b4` top → `~#6e92a2` bot), so this value lands at
      // the upper-mid mean and matches what shows beside the visible
      // image columns at most heights. With `contain` fit it paints
      // the horizontal letterbox bars on either side of the centered
      // image; the source's own muted blue-gray bg then appears to
      // extend seamlessly to the window edges instead of revealing
      // the default near-black appFrame fill behind the bars.
      desktopBackgroundColor: "#7d9fad",
      // Zoom in 10% from the `contain` baseline — matches the
      // Vibecoder / Cypher Punk / Giga Brain scale exactly so all
      // four 1024×1024 character portraits render at the same
      // visible 1100×1100 size, keeping cross-fades between them
      // a clean dissolve with no size jump. The painted contain
      // rectangle (1000×1000 inside a 1600×1000 frame) scales to
      // 1100×1100 around the frame center: the figure grows 10%
      // larger, the horizontal letterbox bars shrink from 300px
      // to 250px each side, and a ~4.5% slice at the top / bottom
      // of the source falls outside the frame and gets trimmed
      // by `.appFrame`'s `overflow: hidden`. The matching
      // steel-blue bg above still fills the (narrower) letterbox
      // bars so the seam stays invisible.
      desktopBackgroundScale: 1.1,
      // Default-centered crop is correct for this 1024×1024
      // square portrait — no vertical nudge needed.
      desktopBackgroundOffsetY: null,
      // No surrounding site image — the page paints a solid lavender
      // wash behind the `MockAuraApp` rectangle so the helmeted
      // portrait sits on a flat saturated field.
      siteBackgroundUrl: null,
      siteBackgroundColor: "#B06AB3",
      // The lavender wash is mid-tone but still bright enough that
      // the default near-white nav/tick tokens lose contrast against
      // it. Mirror the `solo-builder` approach: near-black for the
      // active/hover state, a slightly lighter near-black for idle,
      // so the public nav footer (bottom-left links) and right-edge
      // tick rail keep a legible two-step hierarchy on the bg.
      siteForegroundColor: "#0a0a0a",
      siteForegroundColorMuted: "#1a1a1a",
      // Cyan accent so the CTA's neon glow sits opposite the
      // lavender page wash on the color wheel — the default neon
      // violet would disappear into the bg here.
      siteCtaGlowColor: "#5ce0ff",
      // Default `50% 18%` framing keeps the helmet + visor
      // centered inside the 18px avatar circle once the dock zooms
      // in 2x on the 1024×1024 source — the head sits in the upper
      // third of the source like every other curated portrait, so
      // no per-persona override is needed.
      avatarObjectPosition: null,
    },
  },
  {
    id: "researcher",
    name: "Researcher",
    role: "Research analyst",
    theme: {
      // Glossy black-and-gold researcher android (single amber-lens
      // helmet, gold-trimmed chestplate, charcoal hoodie) on a cool
      // blue-gray studio field. Source is a 1024×1024 square, same
      // aspect as Vibecoder / Cypher Punk / Giga Brain / Coordinator,
      // so the wallpaper framing inherits the same canonical
      // `contain` + matching-frame-bg math: the figure renders
      // end-to-end vertically and the sampled blue-gray paints the
      // horizontal letterbox bars so the source's own backdrop
      // appears to extend to the window edges with no visible seam.
      desktopBackgroundUrl: "/personas/researcher/desktop.png",
      // Position is irrelevant under `contain` (the image fits
      // entirely inside the frame and there is no crop axis to
      // anchor). Same shape as the other character portraits.
      desktopBackgroundPosition: null,
      desktopBackgroundFit: "contain",
      // Sampled mid-tone of the new asset's cool blue-gray field
      // (`#809fb0`, picked directly off the source's upper expanse
      // around the helmet — the prior `#8b9da7` guess sat noticeably
      // more desaturated than the actual asset, leaving the letterbox
      // bars looking gray next to the saturated cyan-blue image
      // edges). The asset itself runs a gentle vertical gradient
      // (~`#85a5b4` top → `~#6a8da0` bot), so this value lands at
      // the top-strip mean and matches what shows beside the visible
      // image columns at most heights. With `contain` fit it paints
      // the horizontal letterbox bars on either side of the centered
      // image; the source's own muted blue-gray bg then appears to
      // extend seamlessly to the window edges instead of revealing
      // the default near-black appFrame fill behind the bars.
      desktopBackgroundColor: "#809fb0",
      // Zoom in 10% from the `contain` baseline — matches the
      // Vibecoder / Cypher Punk / Giga Brain / Coordinator scale
      // exactly so all five 1024×1024 character portraits render
      // at the same visible 1100×1100 size, keeping cross-fades
      // between them a clean dissolve with no size jump.
      desktopBackgroundScale: 1.1,
      // Default-centered crop is correct for this 1024×1024
      // square portrait — no vertical nudge needed.
      desktopBackgroundOffsetY: null,
      // Warm amber wash behind the mock desktop, kept from the prior
      // warm-beige portrait — the gold details on the helmet, lens,
      // and chestplate still anchor a warm CTA accent and the amber
      // page texture reads as a "studio gold" backdrop the figure's
      // own gold trim picks up, even though the figure's local
      // backdrop is now cool blue-gray inside the mock window.
      siteBackgroundUrl: "/personas/researcher/site.png",
      siteBackgroundColor: "#c7b6a6",
      siteForegroundColor: "#0a0a0a",
      siteForegroundColorMuted: "#1a1a1a",
      siteCtaGlowColor: "#d79a2e",
      // Default `50% 18%` framing keeps the amber lens + helmet
      // centered inside the 18px avatar circle once the dock zooms
      // in 2x on the 1024×1024 source — the head sits in the upper
      // third of the source like every other curated portrait, so
      // no per-persona override is needed.
      avatarObjectPosition: null,
    },
  },
  {
    id: "cypher-punk",
    name: "Cypher Punk",
    role: "Security operator",
    theme: {
      // Hooded operator with a green-lit neon visor on a pure-
      // black field. The source is a 1024×1024 square — same
      // aspect as the Vibecoder portrait — so the wallpaper
      // framing inherits the same `cover`-fit math (scaled to
      // fill the 16:10 frame width, ~37% of height cropped).
      //
      // `center 20%` pushes the crop window high in the source
      // so the visible content slides DOWN inside the mock
      // window: with the default center crop the visor sat in
      // the upper-third of the frame and the top of the hood
      // got clipped; pinning at 20% exposes more of the hood
      // top and lands the visor + face on the vertical
      // centerline of the wallpaper window, making the face
      // read as the focal point instead of feeling pushed up
      // against the titlebar.
      desktopBackgroundUrl: "/personas/cypher-punk/desktop.png",
      // Same shape as Vibecoder above: `contain` shows the full
      // source vertically, with the matching black bg filling
      // the horizontal letterbox bars so the figure's natural
      // black backdrop appears to extend to the window edges.
      // Position is null because `contain` has no crop axis to
      // anchor — the prior `"center 20%"` was a `cover`-mode
      // nudge that became a no-op when we switched to `contain`,
      // so it's been dropped rather than left as misleading
      // dead code.
      desktopBackgroundPosition: null,
      desktopBackgroundFit: "contain",
      // Matches the wallpaper's near-pure-black corners
      // (sampled at #030303).
      desktopBackgroundColor: "#030303",
      // Zoom in 10% from the `contain` baseline — matches the
      // Vibecoder scale exactly so the two personas (which share
      // a 1024×1024 source) render the figure at the same
      // visible 1100×1100 size, keeping the cross-fade between
      // them a clean dissolve with no size jump.
      desktopBackgroundScale: 1.1,
      // Default-centered crop reads correctly for this 1024×1024
      // square portrait — no vertical nudge needed.
      desktopBackgroundOffsetY: null,
      // No surrounding site image — the page paints a flat dark
      // blue-gray wash behind the `MockAuraApp` rectangle so the
      // pure-black wallpaper inside the window reads as a darker
      // inset against the slightly lighter page bg.
      siteBackgroundUrl: null,
      siteBackgroundColor: "#22272E",
      // Pin the dark-mode `--color-text-primary` / `--color-text-
      // secondary` hex pair (matches Vibecoder's override) rather
      // than leaving these null. The persona's `siteBackgroundColor`
      // is theme-invariant — `#22272E` paints in both light and dark
      // user theme — so the nav / tick foreground must be theme-
      // invariant too, otherwise light-mode visitors see the CSS
      // fallback collapse `--color-text-secondary` to `#374151` and
      // the public nav strip becomes unreadable on the dark wash.
      siteForegroundColor: "#e6e8eb",
      siteForegroundColorMuted: "#c9c9cf",
      // Spring-green / cyan-lifted neon sampled from the helmet
      // visor stripes in the wallpaper portrait — slightly cooler
      // than a pure matrix `#39ff14` so it tracks the actual
      // emissive green inside the mock window. The CTA's border +
      // bloom inherit it via `--public-cta-glow-color`, so the
      // "Create your agent" pill reads as if lit by the same
      // visor light source against the dark blue-gray page bg.
      siteCtaGlowColor: "#3aff8a",
      // Default framing — the hooded operator's visor sits in the
      // upper third of the 1024x1024 source, so the shared
      // `50% 18%` slice lands the visor centered in the 18px
      // avatar circle.
      avatarObjectPosition: null,
    },
  },
];

/**
 * Convenience accessor — clamps the requested index into the
 * `PERSONAS` range and returns the matching persona. Used by the
 * `PublicChatView` orchestrator to look up the active theme.
 */
export function getPersonaAt(index: number): Persona {
  if (PERSONAS.length === 0) {
    throw new Error("PERSONAS array is empty");
  }
  const clamped = Math.min(Math.max(index, 0), PERSONAS.length - 1);
  return PERSONAS[clamped];
}
