use aura_core::{parse_dt, Spec};

use crate::StorageSpec;

impl TryFrom<StorageSpec> for Spec {
    type Error = String;

    fn try_from(s: StorageSpec) -> Result<Self, Self::Error> {
        Ok(Spec {
            spec_id: s.id.parse().map_err(|e| format!("invalid spec id: {e}"))?,
            project_id: s
                .project_id
                .as_deref()
                .unwrap_or("")
                .parse()
                .map_err(|e| format!("invalid project id: {e}"))?,
            title: s.title.unwrap_or_default(),
            order_index: s.order_index.unwrap_or(0) as u32,
            markdown_contents: s.markdown_contents.unwrap_or_default(),
            created_at: parse_dt(&s.created_at),
            updated_at: parse_dt(&s.updated_at),
        })
    }
}
