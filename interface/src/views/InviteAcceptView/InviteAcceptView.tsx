import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../stores/auth-store";
import { Text, Spinner, Button } from "@cypher-asi/zui";
import styles from "./InviteAcceptView.module.css";

type Status = "loading" | "success" | "already_member" | "expired" | "error";

export function InviteAcceptView() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || !user || attempted.current) return;
    attempted.current = true;

    api.orgs
      .acceptInvite(token, user.display_name || "Member")
      .then(() => {
        setStatus("success");
        setTimeout(() => navigate("/projects"), 2000);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Failed to accept invite";
        if (/already a member/i.test(msg)) {
          setStatus("already_member");
        } else if (/no longer valid/i.test(msg) || /expired/i.test(msg)) {
          setStatus("expired");
        } else {
          setStatus("error");
          setErrorMsg(msg);
        }
      });
  }, [token, user, navigate]);

  return (
    <div className={styles.centeredLayout}>
      {status === "loading" && (
        <>
          <Spinner size="lg" />
          <Text size="sm">Accepting invite...</Text>
        </>
      )}
      {status === "success" && (
        <Text size="sm">Invite accepted! Redirecting...</Text>
      )}
      {status === "already_member" && (
        <>
          <Text size="sm">You're already a member of this team.</Text>
          <Button variant="ghost" size="sm" onClick={() => navigate("/projects")} style={{ marginTop: 16 }}>
            Go to Projects
          </Button>
        </>
      )}
      {status === "expired" && (
        <>
          <Text size="sm" className={styles.dangerText}>
            This invite link has expired or already been used.
          </Text>
          <Text variant="muted" size="sm" style={{ marginTop: 8 }}>
            Ask the team owner to send a new invite.
          </Text>
          <Button variant="ghost" size="sm" onClick={() => navigate("/projects")} style={{ marginTop: 16 }}>
            Go to Projects
          </Button>
        </>
      )}
      {status === "error" && (
        <>
          <Text size="sm" className={styles.dangerText}>
            {errorMsg}
          </Text>
          <Button variant="ghost" size="sm" onClick={() => navigate("/projects")} style={{ marginTop: 16 }}>
            Go to Projects
          </Button>
        </>
      )}
    </div>
  );
}
