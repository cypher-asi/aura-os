import { useState, useEffect } from "react";
import { Modal, Button } from "@cypher-asi/zui";
import { orgsApi } from "../../api/orgs";
import styles from "./TierSubscriptionModal.module.css";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface TierInfo {
  id: string;
  name: string;
  price: string;
  monthlyTopUp: string;
  dailyReward: string;
  referralReward: string;
  features: string[];
}

const TIERS: TierInfo[] = [
  {
    id: "mortal",
    name: "Mortal",
    price: "Free",
    monthlyTopUp: "2,500",
    dailyReward: "50",
    referralReward: "5,000",
    features: [
      "No credit card required",
      "Pay-as-you-go top-ups",
      "Local open source models",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$20/mo",
    monthlyTopUp: "5,000",
    dailyReward: "100",
    referralReward: "7,500",
    features: [
      "Everything in Mortal, plus:",
      "Monthly credit allowance",
      "Remote agents",
    ],
  },
  {
    id: "crusader",
    name: "Crusader",
    price: "$60/mo",
    monthlyTopUp: "12,000",
    dailyReward: "200",
    referralReward: "10,000",
    features: [
      "Everything in Pro, plus:",
      "3x credits for frontier models",
    ],
  },
  {
    id: "sage",
    name: "Sage",
    price: "$200/mo",
    monthlyTopUp: "40,000",
    dailyReward: "400",
    referralReward: "15,000",
    features: [
      "Everything in Crusader, plus:",
      "20x usage on frontier models",
      "Priority access to new features",
    ],
  },
];

export function TierSubscriptionModal({ isOpen, onClose }: Props) {
  const [currentPlan, setCurrentPlan] = useState("mortal");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    orgsApi
      .getSubscriptionStatus()
      .then((status) => {
        setCurrentPlan(status.plan);
        setIsSubscribed(status.is_subscribed);
      })
      .catch(() => {});
  }, [isOpen]);

  const handleSubscribe = async (planId: string) => {
    if (planId === "mortal") return;
    setLoading(true);
    setError(null);
    try {
      const { url } = await orgsApi.createSubscriptionCheckout(planId);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start checkout");
      setLoading(false);
    }
  };

  const handleManage = async () => {
    setLoading(true);
    setError(null);
    try {
      const { url } = await orgsApi.createPortalSession();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open portal");
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="CHOOSE YOUR PLAN" size="xl">
      <div className={styles.root}>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.tierGrid}>
          {TIERS.map((tier) => {
            const isCurrent = tier.id === currentPlan;
            return (
              <div
                key={tier.id}
                className={`${styles.tierCard} ${isCurrent ? styles.tierCardCurrent : ""}`}
              >
                <div className={styles.tierHeader}>
                  <h3 className={styles.tierName}>{tier.name}</h3>
                  <span className={styles.tierPrice}>{tier.price}</span>
                </div>

                <div className={styles.tierCredits}>
                  <div className={styles.creditRow}>
                    <span className={styles.creditLabel}>Monthly top-up</span>
                    <span className={styles.creditValue}>{tier.monthlyTopUp}</span>
                  </div>
                  <div className={styles.creditRow}>
                    <span className={styles.creditLabel}>Daily active reward</span>
                    <span className={styles.creditValue}>{tier.dailyReward}/day</span>
                  </div>
                  <div className={styles.creditRow}>
                    <span className={styles.creditLabel}>Referral reward</span>
                    <span className={styles.creditValue}>{tier.referralReward}</span>
                  </div>
                </div>

                <ul className={styles.features}>
                  {tier.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>

                <div className={styles.tierAction}>
                  {isCurrent ? (
                    isSubscribed ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleManage}
                        disabled={loading}
                      >
                        Manage
                      </Button>
                    ) : (
                      <span className={styles.currentBadge}>Current Plan</span>
                    )
                  ) : tier.id === "mortal" ? null : (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleSubscribe(tier.id)}
                      disabled={loading}
                    >
                      {loading ? "Loading..." : "Upgrade"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
