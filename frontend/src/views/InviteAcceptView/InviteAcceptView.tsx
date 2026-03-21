import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { Text, Spinner } from "@cypher-asi/zui";
import styles from "./InviteAcceptView.module.css";

export function InviteAcceptView() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!token) return;
    api.orgs
      .acceptInvite(token)
      .then(() => {
        setStatus("success");
        setTimeout(() => navigate("/projects"), 2000);
      })
      .catch((err) => {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Failed to accept invite");
      });
  }, [token, navigate]);

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
      {status === "error" && (
        <Text size="sm" className={styles.dangerText}>
          {errorMsg}
        </Text>
      )}
    </div>
  );
}
