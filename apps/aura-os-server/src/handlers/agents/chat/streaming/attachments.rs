//! Translate the DTO-side chat attachment payload into the
//! `aura_os_harness::MessageAttachment` wire shape.

use aura_os_harness::MessageAttachment;

use crate::dto::ChatAttachmentDto;

pub(super) fn dto_attachments_to_protocol(
    atts: &Option<Vec<ChatAttachmentDto>>,
) -> Option<Vec<MessageAttachment>> {
    atts.as_ref().and_then(|v| {
        if v.is_empty() {
            None
        } else {
            Some(
                v.iter()
                    .map(|a| MessageAttachment {
                        type_: a.type_.clone(),
                        media_type: a.media_type.clone(),
                        data: a.data.clone(),
                        name: a.name.clone(),
                        source_url: a.source_url.clone(),
                    })
                    .collect(),
            )
        }
    })
}
