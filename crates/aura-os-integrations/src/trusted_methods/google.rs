//! Trusted Google integration methods.
//!
//! Gmail and Google Calendar both use OAuth bearer tokens, but their
//! agent-facing tool shapes should stay simpler than the raw REST payloads:
//! Gmail send builds the RFC 2822/base64url `raw` message, and Calendar
//! event creation converts attendee email lists into event resources.

use serde_json::{json, Value};

use super::builders::{arg_binding, result_field};
use super::types::{
    TrustedIntegrationArgValueType, TrustedIntegrationHttpMethod,
    TrustedIntegrationMethodDefinition, TrustedIntegrationResultExtraField,
    TrustedIntegrationResultTransform, TrustedIntegrationRuntimeSpec,
    TrustedIntegrationSuccessGuard,
};

pub(crate) fn methods() -> Vec<TrustedIntegrationMethodDefinition> {
    vec![
        TrustedIntegrationMethodDefinition {
            name: "gmail_search_messages".to_string(),
            provider: "google".to_string(),
            description: "Search Gmail messages through a saved Google org integration."
                .to_string(),
            prompt_signature:
                "gmail_search_messages(query?, label_ids?, max_results?, integration_id?)"
                    .to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string" },
                    "query": { "type": "string", "description": "Gmail search query, such as from:alice@example.com newer_than:7d." },
                    "label_ids": {
                        "oneOf": [
                            { "type": "string", "description": "Single Gmail label id." },
                            { "type": "array", "items": { "type": "string" }, "description": "Label ids to constrain the search." }
                        ]
                    },
                    "max_results": { "type": "integer", "description": "Maximum messages to return." }
                }
            }),
            runtime: TrustedIntegrationRuntimeSpec::RestJson {
                method: TrustedIntegrationHttpMethod::Get,
                path: "/gmail/v1/users/me/messages".to_string(),
                query: vec![
                    arg_binding(
                        &["query", "q"],
                        "q",
                        TrustedIntegrationArgValueType::String,
                        false,
                        None,
                    ),
                    arg_binding(
                        &["label_ids", "labelIds"],
                        "labelIds",
                        TrustedIntegrationArgValueType::StringList,
                        false,
                        None,
                    ),
                    arg_binding(
                        &["max_results", "maxResults"],
                        "maxResults",
                        TrustedIntegrationArgValueType::PositiveNumber,
                        false,
                        None,
                    ),
                ],
                body: vec![],
                success_guard: TrustedIntegrationSuccessGuard::None,
                result: TrustedIntegrationResultTransform::ProjectArray {
                    key: "messages".to_string(),
                    pointer: Some("/messages".to_string()),
                    fields: vec![result_field("id", "/id"), result_field("thread_id", "/threadId")],
                    extras: vec![
                        TrustedIntegrationResultExtraField {
                            output: "result_size_estimate".to_string(),
                            pointer: "/resultSizeEstimate".to_string(),
                            default_value: Some(Value::Number(0.into())),
                        },
                        TrustedIntegrationResultExtraField {
                            output: "next_page_token".to_string(),
                            pointer: "/nextPageToken".to_string(),
                            default_value: Some(Value::Null),
                        },
                    ],
                },
            },
        },
        TrustedIntegrationMethodDefinition {
            name: "gmail_get_message".to_string(),
            provider: "google".to_string(),
            description: "Get a Gmail message summary through a saved Google org integration."
                .to_string(),
            prompt_signature: "gmail_get_message(message_id, format?, integration_id?)".to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string" },
                    "message_id": { "type": "string", "description": "Gmail message id from gmail_search_messages." },
                    "format": {
                        "type": "string",
                        "description": "Gmail response format.",
                        "enum": ["metadata", "full", "minimal", "raw"]
                    }
                },
                "required": ["message_id"]
            }),
            runtime: TrustedIntegrationRuntimeSpec::RestJson {
                method: TrustedIntegrationHttpMethod::Get,
                path: "/gmail/v1/users/me/messages/{message_id}".to_string(),
                query: vec![arg_binding(
                    &["format"],
                    "format",
                    TrustedIntegrationArgValueType::String,
                    false,
                    Some(Value::String("metadata".to_string())),
                )],
                body: vec![],
                success_guard: TrustedIntegrationSuccessGuard::None,
                result: TrustedIntegrationResultTransform::ProjectObject {
                    key: "message".to_string(),
                    pointer: None,
                    fields: vec![
                        result_field("id", "/id"),
                        result_field("thread_id", "/threadId"),
                        result_field("snippet", "/snippet"),
                        result_field("label_ids", "/labelIds"),
                        result_field("headers", "/payload/headers"),
                        result_field("internal_date", "/internalDate"),
                    ],
                },
            },
        },
        TrustedIntegrationMethodDefinition {
            name: "gmail_send_email".to_string(),
            provider: "google".to_string(),
            description: "Send an email through a saved Gmail org integration.".to_string(),
            prompt_signature:
                "gmail_send_email(from, to, subject, text?, html?, cc?, bcc?, integration_id?)"
                    .to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string" },
                    "from": { "type": "string", "description": "Sender email, optionally with a display name." },
                    "to": {
                        "oneOf": [
                            { "type": "string", "description": "Single recipient email address." },
                            { "type": "array", "items": { "type": "string" }, "description": "List of recipient email addresses." }
                        ]
                    },
                    "subject": { "type": "string", "description": "Email subject." },
                    "text": { "type": "string", "description": "Optional plain text body." },
                    "html": { "type": "string", "description": "Optional HTML body." },
                    "cc": {
                        "oneOf": [
                            { "type": "string", "description": "Single cc email address." },
                            { "type": "array", "items": { "type": "string" }, "description": "List of cc email addresses." }
                        ]
                    },
                    "bcc": {
                        "oneOf": [
                            { "type": "string", "description": "Single bcc email address." },
                            { "type": "array", "items": { "type": "string" }, "description": "List of bcc email addresses." }
                        ]
                    }
                },
                "required": ["from", "to", "subject"]
            }),
            runtime: TrustedIntegrationRuntimeSpec::GmailSendEmail,
        },
        TrustedIntegrationMethodDefinition {
            name: "google_calendar_list_calendars".to_string(),
            provider: "google".to_string(),
            description:
                "List Google calendars available through a saved Google org integration."
                    .to_string(),
            prompt_signature: "google_calendar_list_calendars(integration_id?)".to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": { "integration_id": { "type": "string" } }
            }),
            runtime: TrustedIntegrationRuntimeSpec::RestJson {
                method: TrustedIntegrationHttpMethod::Get,
                path: "/calendar/v3/users/me/calendarList".to_string(),
                query: vec![],
                body: vec![],
                success_guard: TrustedIntegrationSuccessGuard::None,
                result: TrustedIntegrationResultTransform::ProjectArray {
                    key: "calendars".to_string(),
                    pointer: Some("/items".to_string()),
                    fields: vec![
                        result_field("id", "/id"),
                        result_field("summary", "/summary"),
                        result_field("description", "/description"),
                        result_field("time_zone", "/timeZone"),
                        result_field("access_role", "/accessRole"),
                        result_field("primary", "/primary"),
                    ],
                    extras: vec![TrustedIntegrationResultExtraField {
                        output: "next_page_token".to_string(),
                        pointer: "/nextPageToken".to_string(),
                        default_value: Some(Value::Null),
                    }],
                },
            },
        },
        TrustedIntegrationMethodDefinition {
            name: "google_calendar_list_events".to_string(),
            provider: "google".to_string(),
            description: "List Google Calendar events through a saved Google org integration."
                .to_string(),
            prompt_signature:
                "google_calendar_list_events(calendar_id, time_min?, time_max?, query?, max_results?, order_by?, single_events?, integration_id?)"
                    .to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string" },
                    "calendar_id": { "type": "string", "description": "Calendar id, or primary for the authenticated user's primary calendar." },
                    "time_min": { "type": "string", "description": "Lower bound RFC3339 timestamp." },
                    "time_max": { "type": "string", "description": "Upper bound RFC3339 timestamp." },
                    "query": { "type": "string", "description": "Free-text event search." },
                    "max_results": { "type": "integer", "description": "Maximum events to return." },
                    "order_by": { "type": "string", "description": "Optional orderBy value, such as startTime or updated." },
                    "single_events": { "type": "boolean", "description": "Set to true to expand recurring events." }
                },
                "required": ["calendar_id"]
            }),
            runtime: TrustedIntegrationRuntimeSpec::RestJson {
                method: TrustedIntegrationHttpMethod::Get,
                path: "/calendar/v3/calendars/{calendar_id}/events".to_string(),
                query: vec![
                    arg_binding(
                        &["time_min", "timeMin"],
                        "timeMin",
                        TrustedIntegrationArgValueType::String,
                        false,
                        None,
                    ),
                    arg_binding(
                        &["time_max", "timeMax"],
                        "timeMax",
                        TrustedIntegrationArgValueType::String,
                        false,
                        None,
                    ),
                    arg_binding(
                        &["query", "q"],
                        "q",
                        TrustedIntegrationArgValueType::String,
                        false,
                        None,
                    ),
                    arg_binding(
                        &["max_results", "maxResults"],
                        "maxResults",
                        TrustedIntegrationArgValueType::PositiveNumber,
                        false,
                        None,
                    ),
                    arg_binding(
                        &["order_by", "orderBy"],
                        "orderBy",
                        TrustedIntegrationArgValueType::String,
                        false,
                        None,
                    ),
                    arg_binding(
                        &["single_events", "singleEvents"],
                        "singleEvents",
                        TrustedIntegrationArgValueType::Boolean,
                        false,
                        None,
                    ),
                ],
                body: vec![],
                success_guard: TrustedIntegrationSuccessGuard::None,
                result: TrustedIntegrationResultTransform::ProjectArray {
                    key: "events".to_string(),
                    pointer: Some("/items".to_string()),
                    fields: vec![
                        result_field("id", "/id"),
                        result_field("summary", "/summary"),
                        result_field("description", "/description"),
                        result_field("location", "/location"),
                        result_field("status", "/status"),
                        result_field("html_link", "/htmlLink"),
                        result_field("start", "/start"),
                        result_field("end", "/end"),
                        result_field("attendees", "/attendees"),
                    ],
                    extras: vec![TrustedIntegrationResultExtraField {
                        output: "next_page_token".to_string(),
                        pointer: "/nextPageToken".to_string(),
                        default_value: Some(Value::Null),
                    }],
                },
            },
        },
        TrustedIntegrationMethodDefinition {
            name: "google_calendar_create_event".to_string(),
            provider: "google".to_string(),
            description:
                "Create a Google Calendar event through a saved Google org integration."
                    .to_string(),
            prompt_signature:
                "google_calendar_create_event(calendar_id, summary, start, end, time_zone?, description?, location?, attendees?, integration_id?)"
                    .to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string" },
                    "calendar_id": { "type": "string", "description": "Calendar id, or primary for the authenticated user's primary calendar." },
                    "summary": { "type": "string", "description": "Event title." },
                    "start": { "type": "string", "description": "Event start as an RFC3339 date-time." },
                    "end": { "type": "string", "description": "Event end as an RFC3339 date-time." },
                    "time_zone": { "type": "string", "description": "Optional IANA time zone, such as America/New_York." },
                    "description": { "type": "string", "description": "Optional event description." },
                    "location": { "type": "string", "description": "Optional event location." },
                    "attendees": {
                        "oneOf": [
                            { "type": "string", "description": "Single attendee email address." },
                            { "type": "array", "items": { "type": "string" }, "description": "List of attendee email addresses." }
                        ]
                    },
                    "send_updates": { "type": "string", "description": "Optional sendUpdates value: all, externalOnly, or none." }
                },
                "required": ["calendar_id", "summary", "start", "end"]
            }),
            runtime: TrustedIntegrationRuntimeSpec::GoogleCalendarCreateEvent,
        },
    ]
}
