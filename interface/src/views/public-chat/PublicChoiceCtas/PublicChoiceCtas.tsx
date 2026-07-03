import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, MonitorDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { track } from "../../../lib/analytics";
import styles from "./PublicChoiceCtas.module.css";

interface PublicChoiceCtasProps {
  readonly source: "public_chat" | "public_chat_mobile";
  readonly layout?: "inline" | "stacked";
}

export function PublicChoiceCtas({
  source,
  layout = "inline",
}: PublicChoiceCtasProps): React.ReactElement {
  const navigate = useNavigate();
  const { t } = useTranslation("publicChat");

  const handleStartChatClick = useCallback(() => {
    track("public_start_chat_clicked", { source });
    navigate("/chat");
  }, [navigate, source]);

  const handleDesktopClick = useCallback(() => {
    track("public_download_clicked", { source });
    navigate("/download");
  }, [navigate, source]);

  return (
    <div className={`${styles.group} ${layout === "stacked" ? styles.stacked : ""}`}>
      <button
        type="button"
        className={styles.primaryCta}
        onClick={handleStartChatClick}
      >
        <span>{t("choiceCtas.startChat", { defaultValue: "Start chatting" })}</span>
        <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.secondaryCta}
        onClick={handleDesktopClick}
      >
        <MonitorDown size={16} strokeWidth={2} aria-hidden="true" />
        <span>{t("choiceCtas.getDesktop", { defaultValue: "Get Aura Desktop" })}</span>
      </button>
    </div>
  );
}
