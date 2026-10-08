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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_turn_keeps_inline_images_even_when_storage_uses_url_references() {
        let attachments = Some(vec![ChatAttachmentDto {
            type_: "image".into(),
            media_type: "image/jpeg".into(),
            data: "aW1hZ2U=".into(),
            name: Some("photo.jpg".into()),
            source_url: Some("https://cdn.example/photo.jpg".into()),
        }]);
        let protocol = dto_attachments_to_protocol(&attachments).unwrap();
        assert_eq!(protocol[0].data, "aW1hZ2U=");
        assert_eq!(
            protocol[0].source_url.as_deref(),
            Some("https://cdn.example/photo.jpg")
        );
    }
}
