import { Link, useLocation } from "react-router-dom";
import "./MarketingFooter.css";

/**
 * Smooth-scrolls the marketing scroll column (mounted by
 * `PublicMarketingPanel`) back to the top. Used when a footer link
 * targets the page the visitor is already on — React Router treats
 * that as a no-op navigation, so the column would otherwise stay at
 * the bottom where the footer lives.
 */
function scrollMarketingColumnToTop(): void {
  const column = document.querySelector<HTMLElement>(
    "[data-marketing-scroll-column]",
  );
  column?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
}

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

const X_URL = "https://x.com/aura_asi";

const GITHUB_URL = "https://github.com/cypher-asi/";

const COMPANY_URL = "https://cypher.net";

const FOOTER_COLUMNS: ReadonlyArray<FooterColumn> = [
  {
    heading: "Product",
    links: [
      { kind: "internal", label: "Agents", to: "/agents" },
      { kind: "internal", label: "Code", to: "/code" },
      { kind: "internal", label: "OS", to: "/os" },
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
      { kind: "external", label: "GitHub", href: GITHUB_URL },
      { kind: "external", label: "X", href: X_URL },
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
 * work.
 */
export function MarketingFooter(): React.ReactNode {
  const { pathname } = useLocation();
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
                      <Link
                        to={link.to}
                        className="marketingFooterLink"
                        onClick={() => {
                          if (pathname === link.to) scrollMarketingColumnToTop();
                        }}
                      >
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
        <div className="marketingFooterBottom">
          <span className="marketingFooterCopyright">
            Copyright {new Date().getFullYear()}
          </span>
          <a
            href={COMPANY_URL}
            className="marketingFooterCompany"
            target="_blank"
            rel="noopener noreferrer"
          >
            CYPHER, INC.
          </a>
        </div>
      </div>
      <img
        className="marketingFooterWordmark"
        src="/AURA_logo_text_mark.png"
        alt="AURA"
        draggable={false}
      />
    </footer>
  );
}
