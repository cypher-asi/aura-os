use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::ids::{OrgId, ProfileId, UserId};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Org {
    pub org_id: OrgId,
    pub name: String,
    pub owner_user_id: UserId,
    pub billing: Option<OrgBilling>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrgBilling {
    pub billing_email: Option<String>,
    pub plan: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreditBalance {
    pub balance_cents: i64,
    pub plan: String,
    pub balance_formatted: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreditTransaction {
    pub id: String,
    pub amount_cents: i64,
    pub transaction_type: String,
    pub balance_after_cents: i64,
    pub description: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransactionsResponse {
    pub transactions: Vec<CreditTransaction>,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BillingAccount {
    pub user_id: String,
    pub balance_cents: i64,
    pub balance_formatted: String,
    pub lifetime_purchased_cents: i64,
    pub lifetime_granted_cents: i64,
    pub lifetime_used_cents: i64,
    pub plan: String,
    pub auto_refill_enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CheckoutSessionResponse {
    pub checkout_url: String,
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Follow {
    pub id: String,
    pub follower_profile_id: ProfileId,
    pub target_profile_id: ProfileId,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ZeroAuthSession {
    pub user_id: String,
    #[serde(default)]
    pub network_user_id: Option<UserId>,
    #[serde(default)]
    pub profile_id: Option<ProfileId>,
    pub display_name: String,
    pub profile_image: String,
    pub primary_zid: String,
    pub zero_wallet: String,
    pub wallets: Vec<String>,
    pub access_token: String,
    #[serde(default)]
    pub is_zero_pro: bool,
    #[serde(default)]
    pub is_access_granted: bool,
    pub created_at: DateTime<Utc>,
    pub validated_at: DateTime<Utc>,
}
