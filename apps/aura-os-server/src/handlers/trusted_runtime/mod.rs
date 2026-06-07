use aura_os_integrations::trusted_methods::TrustedIntegrationArgSource;
use aura_os_integrations::{
    app_provider_authenticated_url_with_config, app_provider_base_url, app_provider_headers,
    AppProviderKind, TrustedIntegrationArgBinding, TrustedIntegrationArgValueType,
    TrustedIntegrationHttpMethod, TrustedIntegrationResultField, TrustedIntegrationResultTransform,
    TrustedIntegrationRuntimeSpec, TrustedIntegrationSuccessGuard,
};
use reqwest::header::{HeaderMap, ACCEPT};
use serde_json::{json, Value};

use crate::error::{ApiError, ApiResult};

mod helpers;

use helpers::*;

pub(crate) async fn execute_trusted_integration_tool(
    client: &reqwest::Client,
    kind: AppProviderKind,
    secret: &str,
    provider_config: Option<&Value>,
    args: &Value,
    spec: &TrustedIntegrationRuntimeSpec,
) -> ApiResult<Value> {
    match spec {
        TrustedIntegrationRuntimeSpec::RestJson {
            method,
            path,
            query,
            body,
            success_guard,
            result,
        } => {
            let url = build_runtime_url(kind, secret, provider_config, path, query, args)?;
            let response = provider_json_request(
                client,
                trusted_http_method(*method),
                &url,
                app_provider_headers(kind, secret).map_err(ApiError::bad_request)?,
                build_object_from_bindings(body, args, provider_config)?,
            )
            .await?;
            apply_success_guard(&response, success_guard)?;
            apply_result_transform(&response, result, args)
        }
        TrustedIntegrationRuntimeSpec::RestForm {
            method,
            path,
            query,
            body,
            success_guard,
            result,
        } => {
            let url = build_runtime_url(kind, secret, provider_config, path, query, args)?;
            let response = provider_form_request(
                client,
                trusted_http_method(*method),
                &url,
                build_form_fields_from_bindings(body, args, provider_config)?,
            )
            .await?;
            apply_success_guard(&response, success_guard)?;
            apply_result_transform(&response, result, args)
        }
        TrustedIntegrationRuntimeSpec::Graphql {
            query,
            variables,
            success_guard,
            result,
        } => {
            let url = app_provider_base_url(kind)
                .ok_or_else(|| ApiError::internal("trusted provider base url missing"))?;
            let response = provider_json_request(
                client,
                reqwest::Method::POST,
                &url,
                app_provider_headers(kind, secret).map_err(ApiError::bad_request)?,
                Some(json!({
                    "query": query,
                    "variables": build_object_from_bindings(variables, args, provider_config)?
                        .unwrap_or_else(|| json!({})),
                })),
            )
            .await?;
            apply_success_guard(&response, success_guard)?;
            apply_result_transform(&response, result, args)
        }
        TrustedIntegrationRuntimeSpec::BraveSearch { vertical } => {
            let query = required_string(args, &["query", "q"])?;
            let base_url = app_provider_base_url(kind)
                .ok_or_else(|| ApiError::internal("trusted provider base url missing"))?;
            let mut url = reqwest::Url::parse(&format!("{base_url}/res/v1/{vertical}/search"))
                .map_err(|error| {
                    ApiError::internal(format!("invalid brave search base url: {error}"))
                })?;
            {
                let mut params = url.query_pairs_mut();
                params.append_pair("q", &query);
                params.append_pair(
                    "count",
                    &optional_positive_number(args, &["count"])
                        .unwrap_or(10)
                        .to_string(),
                );
                if let Some(freshness) = optional_string(args, &["freshness"]) {
                    params.append_pair("freshness", &freshness);
                }
                if let Some(country) = optional_string(args, &["country"]) {
                    params.append_pair("country", &country);
                }
                if let Some(search_lang) = optional_string(args, &["search_lang", "searchLang"]) {
                    params.append_pair("search_lang", &search_lang);
                }
            }
            let response = provider_json_request(
                client,
                reqwest::Method::GET,
                url.as_str(),
                app_provider_headers(kind, secret).map_err(ApiError::bad_request)?,
                None,
            )
            .await?;
            apply_result_transform(
                &response,
                &TrustedIntegrationResultTransform::BraveSearch {
                    vertical: vertical.clone(),
                },
                args,
            )
        }
        TrustedIntegrationRuntimeSpec::ResendSendEmail => {
            let from = required_string(args, &["from"])?;
            let to = required_string_list(args, &["to"])?;
            let subject = required_string(args, &["subject"])?;
            let url = format!(
                "{}/emails",
                app_provider_base_url(kind)
                    .ok_or_else(|| ApiError::internal("trusted provider base url missing"))?
            );
            let response = provider_json_request(
                client,
                reqwest::Method::POST,
                &url,
                app_provider_headers(kind, secret).map_err(ApiError::bad_request)?,
                Some(json!({
                    "from": from,
                    "to": to,
                    "subject": subject,
                    "html": optional_string(args, &["html"]),
                    "text": optional_string(args, &["text"]),
                    "cc": optional_string_list(args, &["cc"]),
                    "bcc": optional_string_list(args, &["bcc"]),
                })),
            )
            .await?;
            Ok(json!({
                "email": {
                    "id": response.get("id").and_then(Value::as_str).unwrap_or_default(),
                }
            }))
        }
        TrustedIntegrationRuntimeSpec::GmailSendEmail => {
            let from = required_string(args, &["from"])?;
            let to = required_string_list(args, &["to"])?;
            let subject = required_string(args, &["subject"])?;
            let text = optional_string(args, &["text"]);
            let html = optional_string(args, &["html"]);
            if text.is_none() && html.is_none() {
                return Err(ApiError::bad_request(
                    "gmail_send_email requires at least one of `text` or `html`",
                ));
            }

            let raw = build_gmail_raw_message(
                &from,
                &to,
                optional_string_list(args, &["cc"]).as_deref(),
                optional_string_list(args, &["bcc"]).as_deref(),
                &subject,
                text.as_deref(),
                html.as_deref(),
            )?;
            let message = build_gmail_message_resource(
                raw,
                optional_string(args, &["thread_id", "threadId"]),
            );
            let url = format!(
                "{}/gmail/v1/users/me/messages/send",
                app_provider_base_url(kind)
                    .ok_or_else(|| ApiError::internal("trusted provider base url missing"))?
            );
            let response = provider_json_request(
                client,
                reqwest::Method::POST,
                &url,
                app_provider_headers(kind, secret).map_err(ApiError::bad_request)?,
                Some(message),
            )
            .await?;
            Ok(json!({
                "message": {
                    "id": response.get("id").and_then(Value::as_str).unwrap_or_default(),
                    "thread_id": response.get("threadId").and_then(Value::as_str).unwrap_or_default(),
                    "label_ids": response.get("labelIds").cloned().unwrap_or_else(|| json!([])),
                }
            }))
        }
        TrustedIntegrationRuntimeSpec::GmailCreateDraft => {
            let from = required_string(args, &["from"])?;
            let to = required_string_list(args, &["to"])?;
            let subject = required_string(args, &["subject"])?;
            let text = optional_string(args, &["text"]);
            let html = optional_string(args, &["html"]);
            if text.is_none() && html.is_none() {
                return Err(ApiError::bad_request(
                    "gmail_create_draft requires at least one of `text` or `html`",
                ));
            }

            let raw = build_gmail_raw_message(
                &from,
                &to,
                optional_string_list(args, &["cc"]).as_deref(),
                optional_string_list(args, &["bcc"]).as_deref(),
                &subject,
                text.as_deref(),
                html.as_deref(),
            )?;
            let message = build_gmail_message_resource(
                raw,
                optional_string(args, &["thread_id", "threadId"]),
            );
            let url = format!(
                "{}/gmail/v1/users/me/drafts",
                app_provider_base_url(kind)
                    .ok_or_else(|| ApiError::internal("trusted provider base url missing"))?
            );
            let response = provider_json_request(
                client,
                reqwest::Method::POST,
                &url,
                app_provider_headers(kind, secret).map_err(ApiError::bad_request)?,
                Some(json!({ "message": message })),
            )
            .await?;
            Ok(json!({
                "draft": {
                    "id": response.get("id").and_then(Value::as_str).unwrap_or_default(),
                    "message": {
                        "id": response.pointer("/message/id").and_then(Value::as_str).unwrap_or_default(),
                        "thread_id": response.pointer("/message/threadId").and_then(Value::as_str).unwrap_or_default(),
                    }
                }
            }))
        }
        TrustedIntegrationRuntimeSpec::GoogleCalendarCreateEvent => {
            let calendar_id = required_string(args, &["calendar_id", "calendarId"])?;
            let event = build_google_calendar_event_resource(args, true)?;

            let mut url = app_provider_authenticated_url_with_config(
                kind,
                &format!("/calendar/v3/calendars/{calendar_id}/events"),
                secret,
                provider_config,
            )
            .map_err(ApiError::bad_request)?;
            if let Some(send_updates) = optional_string(args, &["send_updates", "sendUpdates"]) {
                url.query_pairs_mut()
                    .append_pair("sendUpdates", &send_updates);
            }
            if optional_bool(args, &["create_google_meet", "createGoogleMeet"]).unwrap_or(false) {
                url.query_pairs_mut()
                    .append_pair("conferenceDataVersion", "1");
            }
            let response = provider_json_request(
                client,
                reqwest::Method::POST,
                url.as_str(),
                app_provider_headers(kind, secret).map_err(ApiError::bad_request)?,
                Some(event),
            )
            .await?;
            Ok(json!({
                "event": {
                    "id": response.get("id").and_then(Value::as_str).unwrap_or_default(),
                    "summary": response.get("summary").and_then(Value::as_str).unwrap_or_default(),
                    "html_link": response.get("htmlLink").and_then(Value::as_str),
                    "status": response.get("status").and_then(Value::as_str),
                    "start": response.get("start").cloned().unwrap_or(Value::Null),
                    "end": response.get("end").cloned().unwrap_or(Value::Null),
                    "attendees": response.get("attendees").cloned().unwrap_or_else(|| json!([])),
                }
            }))
        }
        TrustedIntegrationRuntimeSpec::GoogleCalendarUpdateEvent => {
            let calendar_id = required_string(args, &["calendar_id", "calendarId"])?;
            let event_id = required_string(args, &["event_id", "eventId"])?;
            let event = build_google_calendar_event_resource(args, false)?;
            let mut url = app_provider_authenticated_url_with_config(
                kind,
                &format!("/calendar/v3/calendars/{calendar_id}/events/{event_id}"),
                secret,
                provider_config,
            )
            .map_err(ApiError::bad_request)?;
            if let Some(send_updates) = optional_string(args, &["send_updates", "sendUpdates"]) {
                url.query_pairs_mut()
                    .append_pair("sendUpdates", &send_updates);
            }
            if optional_bool(args, &["create_google_meet", "createGoogleMeet"]).unwrap_or(false) {
                url.query_pairs_mut()
                    .append_pair("conferenceDataVersion", "1");
            }
            let response = provider_json_request(
                client,
                reqwest::Method::PATCH,
                url.as_str(),
                app_provider_headers(kind, secret).map_err(ApiError::bad_request)?,
                Some(event),
            )
            .await?;
            Ok(json!({
                "event": {
                    "id": response.get("id").and_then(Value::as_str).unwrap_or_default(),
                    "summary": response.get("summary").and_then(Value::as_str).unwrap_or_default(),
                    "html_link": response.get("htmlLink").and_then(Value::as_str),
                    "status": response.get("status").and_then(Value::as_str),
                    "start": response.get("start").cloned().unwrap_or(Value::Null),
                    "end": response.get("end").cloned().unwrap_or(Value::Null),
                    "attendees": response.get("attendees").cloned().unwrap_or_else(|| json!([])),
                    "conference_data": response.get("conferenceData").cloned().unwrap_or(Value::Null),
                }
            }))
        }
        TrustedIntegrationRuntimeSpec::GoogleCalendarDeleteEvent => {
            let calendar_id = required_string(args, &["calendar_id", "calendarId"])?;
            let event_id = required_string(args, &["event_id", "eventId"])?;
            let mut url = app_provider_authenticated_url_with_config(
                kind,
                &format!("/calendar/v3/calendars/{calendar_id}/events/{event_id}"),
                secret,
                provider_config,
            )
            .map_err(ApiError::bad_request)?;
            if let Some(send_updates) = optional_string(args, &["send_updates", "sendUpdates"]) {
                url.query_pairs_mut()
                    .append_pair("sendUpdates", &send_updates);
            }
            let _response = provider_json_request(
                client,
                reqwest::Method::DELETE,
                url.as_str(),
                app_provider_headers(kind, secret).map_err(ApiError::bad_request)?,
                None,
            )
            .await?;
            Ok(json!({
                "event": {
                    "id": event_id,
                    "deleted": true,
                }
            }))
        }
    }
}
