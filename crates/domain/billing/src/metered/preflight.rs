use std::time::Instant;
use std::sync::atomic::Ordering;

use tracing::{info, warn};

use super::{MeteredLlm, MeteredLlmError, PRE_FLIGHT_CACHE_TTL_SECS};

impl MeteredLlm {
    pub(crate) async fn pre_flight_check(&self) -> Result<(), MeteredLlmError> {
        self.pre_flight_check_for(0).await
    }

    /// Pre-flight check with cost awareness. When `estimated_credits > 0`,
    /// verifies that the user's balance can cover at least that amount before
    /// making the API call.
    pub(crate) async fn pre_flight_check_for(&self, estimated_credits: u64) -> Result<(), MeteredLlmError> {
        let Some(token) = self.access_token() else {
            warn!("No access token available — cannot verify credits");
            self.credits_exhausted.store(true, Ordering::SeqCst);
            return Err(MeteredLlmError::InsufficientCredits);
        };

        if !self.credits_exhausted.load(Ordering::SeqCst) && estimated_credits == 0 {
            let cache = self.last_preflight_ok.lock().await;
            if let Some(ts) = *cache {
                if ts.elapsed().as_secs() < PRE_FLIGHT_CACHE_TTL_SECS {
                    return Ok(());
                }
            }
            drop(cache);
        }

        let required = estimated_credits.max(1);

        if self.credits_exhausted.load(Ordering::SeqCst) {
            match self.billing.ensure_has_credits_for(&token, required).await {
                Ok(_) => {
                    info!("Credits topped up, resetting exhausted flag");
                    self.credits_exhausted.store(false, Ordering::SeqCst);
                }
                Err(_) => return Err(MeteredLlmError::InsufficientCredits),
            }
        } else if let Err(_) = self.billing.ensure_has_credits_for(&token, required).await {
            self.credits_exhausted.store(true, Ordering::SeqCst);
            return Err(MeteredLlmError::InsufficientCredits);
        }

        *self.last_preflight_ok.lock().await = Some(Instant::now());
        Ok(())
    }
}
