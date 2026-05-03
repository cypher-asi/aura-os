export interface CreditBalance {
  balance_cents: number;
  plan: string;
  balance_formatted: string;
}

export interface CreditTransaction {
  id: string;
  amount_cents: number;
  transaction_type: string;
  balance_after_cents: number;
  description: string;
  created_at: string;
}

export interface TransactionsResponse {
  transactions: CreditTransaction[];
  has_more: boolean;
}

export interface BillingAccount {
  user_id: string;
  balance_cents: number;
  balance_formatted: string;
  lifetime_purchased_cents: number;
  lifetime_granted_cents: number;
  lifetime_used_cents: number;
  plan: string;
  auto_refill_enabled: boolean;
  created_at: string;
}

export interface CheckoutSessionResponse {
  checkout_url: string;
  session_id: string;
}

export interface DailyCommitActivity {
  date: string;
  count: number;
}
