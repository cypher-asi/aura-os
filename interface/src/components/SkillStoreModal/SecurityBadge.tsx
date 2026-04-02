import { Badge } from "@cypher-asi/zui";
import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import type { CSSProperties } from "react";

const CONFIG = {
  safe: { variant: "running" as const, label: "Safe", Icon: ShieldCheck },
  caution: { variant: "provisioning" as const, label: "Caution", Icon: Shield },
  warning: { variant: "error" as const, label: "Warning", Icon: ShieldAlert },
};

const CAUTION_STYLE: CSSProperties = {
  background: "rgba(59, 130, 246, 0.15)",
  color: "#60a5fa",
  borderColor: "rgba(59, 130, 246, 0.3)",
};

interface SecurityBadgeProps {
  rating: "safe" | "caution" | "warning";
  size?: "sm" | "md";
}

export function SecurityBadge({ rating, size = "sm" }: SecurityBadgeProps) {
  const { variant, label, Icon } = CONFIG[rating];
  const iconSize = size === "sm" ? 10 : 12;
  return (
    <Badge
      variant={variant}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: size === "sm" ? 10 : 11,
        ...(rating === "caution" ? CAUTION_STYLE : {}),
      }}
    >
      <Icon size={iconSize} />
      {label}
    </Badge>
  );
}
