import { Link, useLocation } from "react-router-dom";
import { track } from "../../../lib/analytics";
import "./ProductCallToAction.css";

type ProductCallToActionProps = {
  readonly tagline?: string;
  readonly downloadHref?: string;
};

/**
 * Shared bottom banner for the public marketing surfaces (Agents
 * `/product` and Code `/code`). Renders a centered tagline above a
 * Register / Download button pair.
 *
 * The Register pill mirrors the titlebar `PublicActions` signup link
 * (`AuraShell/AuraTitlebar.tsx`): it routes to `/login?tab=register`
 * and stashes the current location as `state.backgroundLocation` so
 * the underlying marketing surface stays mounted behind the login
 * overlay instead of unmounting and flashing the public chat surface.
 */
export function ProductCallToAction({
  tagline = "Feel the AGI.",
  downloadHref = "/download",
}: ProductCallToActionProps): React.ReactNode {
  const location = useLocation();

  const registerParams = new URLSearchParams(location.search);
  registerParams.set("tab", "register");
  const registerSearch = `?${registerParams.toString()}`;

  const backgroundState = { backgroundLocation: location };

  return (
    <section
      className="productCtaSection"
      aria-label="Product call to action"
    >
      <h2 className="productCtaTagline">{tagline}</h2>
      <div className="productCtaActions">
        <Link
          to={{ pathname: "/login", search: registerSearch }}
          state={backgroundState}
          className="productCtaButton productCtaButtonPrimary"
          onClick={() =>
            track("public_signup_clicked", { source: "product_cta" })
          }
        >
          Register
        </Link>
        <Link
          to={downloadHref}
          className="productCtaButton productCtaButtonSecondary"
          onClick={() =>
            track("public_download_clicked", { source: "product_cta" })
          }
        >
          Download
        </Link>
      </div>
    </section>
  );
}
