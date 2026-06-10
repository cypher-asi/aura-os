import { useTranslation } from "react-i18next";
import "./SupportView.css";

// Standalone, auth-independent support page served at `/support`.
//
// This satisfies App Store Guideline 1.5 (Support URL): App Review needs a
// reachable page where users can ask questions and request support. It is
// mounted as a top-level route (outside `AppShell`/`RequireAuth` and the
// `!isAuthenticated` marketing gate) so it renders identically whether the
// visitor is logged in, logged out, or a reviewer opening the URL directly.
const SUPPORT_EMAIL = "support@aura.ai";

export function SupportView() {
  const { t } = useTranslation("marketing");

  return (
    <main className="supportPage">
      <div className="supportCard">
        <p className="supportWordmark">AURA</p>
        <h1 className="supportHeadline">
          {t("support.headline", { defaultValue: "Support" })}
        </h1>
        <p className="supportBody">
          {t("support.body", {
            defaultValue:
              "Need help with AURA? We\u2019re here for you. Email our support team and we\u2019ll get back to you as soon as we can.",
          })}
        </p>
        <a className="supportEmail" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
        <p className="supportNote">
          {t("support.note", {
            defaultValue:
              "For account or billing questions, please include the email address associated with your AURA account.",
          })}
        </p>
      </div>
    </main>
  );
}
