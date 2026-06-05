import { Link } from "react-router-dom";
import "./MarketingFooter.css";

type InternalLink = {
  readonly kind: "internal";
  readonly label: string;
  readonly to: string;
};

type ExternalLink = {
  readonly kind: "external";
  readonly label: string;
  readonly href: string;
};

type FooterLink = InternalLink | ExternalLink;

type FooterColumn = {
  readonly heading: string;
  readonly links: ReadonlyArray<FooterLink>;
};

// THE GRID repo URL mirrors the attribution chip in
// `BottomTaskbar/PoweredByGridButton.tsx`.
const GRID_REPO_URL = "https://github.com/cypher-asi/the-grid";

// TODO: replace the X and YouTube placeholder hrefs with the real
// social URLs once the accounts are finalized.
const X_URL = "#";
const YOUTUBE_URL = "#";

const FOOTER_COLUMNS: ReadonlyArray<FooterColumn> = [
  {
    heading: "Product",
    links: [
      { kind: "internal", label: "Agents", to: "/agents" },
      { kind: "internal", label: "Code", to: "/code" },
      { kind: "external", label: "The GRID", href: GRID_REPO_URL },
    ],
  },
  {
    heading: "Resources",
    links: [
      { kind: "internal", label: "Pricing", to: "/pricing" },
      { kind: "internal", label: "Downloads", to: "/download" },
      { kind: "internal", label: "Changelog", to: "/changelog" },
      { kind: "internal", label: "Blog", to: "/blog" },
      { kind: "internal", label: "Docs", to: "/docs" },
    ],
  },
  {
    heading: "Connect",
    links: [
      { kind: "external", label: "X (@aura_asi)", href: X_URL },
      { kind: "external", label: "YouTube", href: YOUTUBE_URL },
    ],
  },
  {
    heading: "Legal",
    links: [
      { kind: "internal", label: "Terms of Service", to: "/terms" },
      { kind: "internal", label: "Privacy Policy", to: "/privacy" },
    ],
  },
];

/**
 * Marketing footer rendered as a single floating, centered card on the
 * Agents (`/agents`) and Code (`/code`) pages. The card holds four link
 * groups — Product, Resources, Connect, Legal — laid out in a responsive
 * grid that collapses on narrow viewports.
 *
 * Internal destinations use React Router `Link` (same in-app navigation
 * as `ProductCallToAction`); external destinations render as real
 * `<a target="_blank">` so the browser's open-in-new-tab affordances
 * work. X and YouTube currently point at `#` placeholders pending the
 * real social URLs (see the TODO above).
 */
export function MarketingFooter(): React.ReactNode {
  return (
    <footer className="marketingFooter" aria-label="Site footer">
      <div className="marketingFooterCard">
        <nav className="marketingFooterColumns" aria-label="Footer navigation">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.heading} className="marketingFooterColumn">
              <h2 className="marketingFooterHeading">{column.heading}</h2>
              <ul className="marketingFooterList">
                {column.links.map((link) => (
                  <li key={link.label} className="marketingFooterItem">
                    {link.kind === "internal" ? (
                      <Link to={link.to} className="marketingFooterLink">
                        {link.label}
                      </Link>
                    ) : (
                      <a
                        href={link.href}
                        className="marketingFooterLink"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </footer>
  );
}
