import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Text, Spinner } from "@cypher-asi/zui";

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
        setTimeout(() => navigate("/"), 2000);
      })
      .catch((err) => {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Failed to accept invite");
      });
  }, [token, navigate]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "var(--space-4)" }}>
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
        <Text size="sm" style={{ color: "var(--color-danger)" }}>
          {errorMsg}
        </Text>
      )}
    </div>
  );
}
