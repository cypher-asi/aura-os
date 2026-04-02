import { Badge } from "@cypher-asi/zui";
import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";

const CONFIG = {
  safe: { variant: "running" as const, label: "Safe", Icon: ShieldCheck },
  caution: { variant: "pending" as const, label: "Caution", Icon: Shield },
  warning: { variant: "failed" as const, label: "Warning", Icon: ShieldAlert },
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
      }}
    >
      <Icon size={iconSize} />
      {label}
    </Badge>
  );
}
