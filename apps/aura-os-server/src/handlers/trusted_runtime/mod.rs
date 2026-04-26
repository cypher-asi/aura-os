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
    }
}
