use aura_os_integrations::{
    app_provider_authenticated_url, app_provider_base_url, app_provider_headers, AppProviderKind,
    TrustedIntegrationArgBinding, TrustedIntegrationArgValueType, TrustedIntegrationHttpMethod,
    TrustedIntegrationResultField, TrustedIntegrationResultTransform,
    TrustedIntegrationRuntimeSpec, TrustedIntegrationSuccessGuard,
};
use reqwest::header::{HeaderMap, ACCEPT};
use serde_json::{json, Value};

use crate::error::{ApiError, ApiResult};

pub(crate) async fn execute_trusted_integration_tool(
    client: &reqwest::Client,
    kind: AppProviderKind,
    secret: &str,
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
            let url = build_runtime_url(kind, secret, path, query, args)?;
            let response = provider_json_request(
                client,
                trusted_http_method(*method),
                &url,
                app_provider_headers(kind, secret).map_err(ApiError::bad_request)?,
                build_object_from_bindings(body, args)?,
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
            let url = build_runtime_url(kind, secret, path, query, args)?;
            let response = provider_form_request(
                client,
                trusted_http_method(*method),
                &url,
                build_form_fields_from_bindings(body, args)?,
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
                    "variables": build_object_from_bindings(variables, args)?
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

fn trusted_http_method(method: TrustedIntegrationHttpMethod) -> reqwest::Method {
    match method {
        TrustedIntegrationHttpMethod::Get => reqwest::Method::GET,
        TrustedIntegrationHttpMethod::Post => reqwest::Method::POST,
    }
}

fn build_runtime_url(
    kind: AppProviderKind,
    secret: &str,
    path: &str,
    query_bindings: &[TrustedIntegrationArgBinding],
    args: &Value,
) -> ApiResult<String> {
    let expanded_path = expand_path_template(path, args)?;
    let mut url = app_provider_authenticated_url(kind, &expanded_path, secret)
        .map_err(ApiError::bad_request)?;
    for binding in query_bindings {
        if let Some(value) = resolve_binding_value(args, binding)? {
            append_query_value(&mut url, &binding.target, value);
        }
    }
    Ok(url.to_string())
}

fn expand_path_template(path: &str, args: &Value) -> ApiResult<String> {
    let mut expanded = String::new();
    let mut chars = path.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '{' {
            let mut key = String::new();
            for next in chars.by_ref() {
                if next == '}' {
                    break;
                }
                key.push(next);
            }
            expanded.push_str(&required_string(args, &[key.as_str()])?);
        } else {
            expanded.push(ch);
        }
    }
    Ok(expanded)
}

fn append_query_value(url: &mut reqwest::Url, key: &str, value: Value) {
    let mut pairs = url.query_pairs_mut();
    match value {
        Value::Array(items) => {
            for item in items {
                pairs.append_pair(key, &form_field_value(item));
            }
        }
        other => {
            pairs.append_pair(key, &form_field_value(other));
        }
    }
}

fn build_object_from_bindings(
    bindings: &[TrustedIntegrationArgBinding],
    args: &Value,
) -> ApiResult<Option<Value>> {
    if bindings.is_empty() {
        return Ok(None);
    }

    let mut body = json!({});
    let mut inserted = false;
    for binding in bindings {
        if let Some(value) = resolve_binding_value(args, binding)? {
            insert_json_path(&mut body, &binding.target, value)?;
            inserted = true;
        }
    }
    Ok(inserted.then_some(body))
}

fn build_form_fields_from_bindings(
    bindings: &[TrustedIntegrationArgBinding],
    args: &Value,
) -> ApiResult<Vec<(String, String)>> {
    let mut fields = Vec::new();
    for binding in bindings {
        if let Some(value) = resolve_binding_value(args, binding)? {
            match value {
                Value::Array(items) => {
                    for item in items {
                        fields.push((binding.target.clone(), form_field_value(item)));
                    }
                }
                other => fields.push((binding.target.clone(), form_field_value(other))),
            }
        }
    }
    Ok(fields)
}

fn form_field_value(value: Value) -> String {
    match value {
        Value::String(value) => value,
        other => other.to_string(),
    }
}

fn resolve_binding_value(
    args: &Value,
    binding: &TrustedIntegrationArgBinding,
) -> ApiResult<Option<Value>> {
    if binding.arg_names.is_empty() {
        return Ok(binding.default_value.clone());
    }

    let resolved = match binding.value_type {
        TrustedIntegrationArgValueType::String => {
            optional_string_from_names(args, &binding.arg_names).map(Value::String)
        }
        TrustedIntegrationArgValueType::StringList => {
            optional_string_list_from_names(args, &binding.arg_names).map(|items| json!(items))
        }
        TrustedIntegrationArgValueType::PositiveNumber => {
            optional_positive_number_from_names(args, &binding.arg_names).map(|value| json!(value))
        }
        TrustedIntegrationArgValueType::Json => optional_json_from_names(args, &binding.arg_names),
    };

    if let Some(value) = resolved {
        return Ok(Some(value));
    }
    if let Some(default) = &binding.default_value {
        return Ok(Some(default.clone()));
    }
    if binding.required {
        return Err(ApiError::bad_request(format!(
            "missing required field `{}`",
            binding.arg_names.first().map_or("", String::as_str)
        )));
    }
    Ok(None)
}

fn insert_json_path(target: &mut Value, path: &str, value: Value) -> ApiResult<()> {
    let parts = path
        .split('.')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return Err(ApiError::internal(
            "trusted integration metadata declared an empty target path",
        ));
    }

    let mut current = target;
    for part in &parts[..parts.len() - 1] {
        if !current.is_object() {
            *current = json!({});
        }
        current = current
            .as_object_mut()
            .expect("object ensured above")
            .entry((*part).to_string())
            .or_insert_with(|| json!({}));
    }

    current
        .as_object_mut()
        .ok_or_else(|| {
            ApiError::internal(format!(
                "trusted integration target path `{path}` does not resolve to an object"
            ))
        })?
        .insert(parts[parts.len() - 1].to_string(), value);
    Ok(())
}

fn apply_success_guard(response: &Value, guard: &TrustedIntegrationSuccessGuard) -> ApiResult<()> {
    match guard {
        TrustedIntegrationSuccessGuard::None => Ok(()),
        TrustedIntegrationSuccessGuard::SlackOk => ensure_slack_ok(response),
        TrustedIntegrationSuccessGuard::GraphqlErrors => {
            if let Some(errors) = response.get("errors").and_then(Value::as_array) {
                if !errors.is_empty() {
                    let message = errors
                        .iter()
                        .filter_map(|error| error.get("message").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join("; ");
                    return Err(ApiError::bad_gateway(format!("graphql error: {message}")));
                }
            }
            Ok(())
        }
    }
}

fn apply_result_transform(
    response: &Value,
    transform: &TrustedIntegrationResultTransform,
    args: &Value,
) -> ApiResult<Value> {
    match transform {
        TrustedIntegrationResultTransform::WrapPointer { key, pointer } => Ok(object_with_entry(
            key,
            response
                .pointer(pointer)
                .cloned()
                .unwrap_or_else(|| json!({})),
        )),
        TrustedIntegrationResultTransform::ProjectArray {
            key,
            pointer,
            fields,
            extras,
        } => {
            let source = pointer
                .as_deref()
                .map_or(Some(response), |path| response.pointer(path));
            let items = source
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|item| project_fields(&item, fields))
                .collect::<Vec<_>>();
            let mut result = object_with_entry(key, Value::Array(items));
            for extra in extras {
                let value = response
                    .pointer(&extra.pointer)
                    .cloned()
                    .or_else(|| extra.default_value.clone())
                    .unwrap_or(Value::Null);
                result[&extra.output] = value;
            }
            Ok(result)
        }
        TrustedIntegrationResultTransform::ProjectObject {
            key,
            pointer,
            fields,
        } => {
            let source = pointer
                .as_deref()
                .map_or(Some(response), |path| response.pointer(path))
                .cloned()
                .unwrap_or_else(|| json!({}));
            Ok(object_with_entry(key, project_fields(&source, fields)))
        }
        TrustedIntegrationResultTransform::BraveSearch { vertical } => {
            let query = required_string(args, &["query", "q"])?;
            let items = response
                .pointer(&format!("/{vertical}/results"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|item| {
                    json!({
                        "title": item.get("title").and_then(Value::as_str).unwrap_or_default(),
                        "url": item
                            .get("url")
                            .or_else(|| item.get("profile"))
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        "description": item
                            .get("description")
                            .or_else(|| item.get("snippet"))
                            .and_then(Value::as_str),
                        "age": item.get("age").and_then(Value::as_str),
                        "source": item.get("source").and_then(Value::as_str),
                    })
                })
                .collect::<Vec<_>>();
            Ok(json!({
                "query": query,
                "results": items,
                "more_results_available": response.pointer("/query/more_results_available").and_then(Value::as_bool).unwrap_or(false),
            }))
        }
    }
}

fn object_with_entry(key: &str, value: Value) -> Value {
    let mut map = serde_json::Map::new();
    map.insert(key.to_string(), value);
    Value::Object(map)
}

fn project_fields(source: &Value, fields: &[TrustedIntegrationResultField]) -> Value {
    let mut result = json!({});
    for field in fields {
        result[&field.output] = source
            .pointer(&field.pointer)
            .cloned()
            .unwrap_or(Value::Null);
    }
    result
}

async fn provider_json_request(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    headers: HeaderMap,
    body: Option<Value>,
) -> ApiResult<Value> {
    let mut request = client.request(method, url).headers(headers);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| ApiError::bad_gateway(format!("provider request failed: {error}")))?;
    let status = response.status();
    let text = response.text().await.map_err(|error| {
        ApiError::bad_gateway(format!("reading provider response failed: {error}"))
    })?;
    if !status.is_success() {
        return Err(ApiError::bad_gateway(format!(
            "provider request failed with {}: {}",
            status, text
        )));
    }
    serde_json::from_str(&text)
        .map_err(|error| ApiError::bad_gateway(format!("provider returned invalid JSON: {error}")))
}

async fn provider_form_request(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    form: Vec<(String, String)>,
) -> ApiResult<Value> {
    let response = client
        .request(method, url)
        .header(ACCEPT, "application/json")
        .form(&form)
        .send()
        .await
        .map_err(|error| ApiError::bad_gateway(format!("provider request failed: {error}")))?;
    let status = response.status();
    let text = response.text().await.map_err(|error| {
        ApiError::bad_gateway(format!("reading provider response failed: {error}"))
    })?;
    if !status.is_success() {
        return Err(ApiError::bad_gateway(format!(
            "provider request failed with {}: {}",
            status, text
        )));
    }
    serde_json::from_str(&text)
        .map_err(|error| ApiError::bad_gateway(format!("provider returned invalid JSON: {error}")))
}

fn ensure_slack_ok(response: &Value) -> ApiResult<()> {
    if response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        Ok(())
    } else {
        Err(ApiError::bad_gateway(format!(
            "slack api error: {}",
            response
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown slack error")
        )))
    }
}

fn required_string(args: &Value, keys: &[&str]) -> ApiResult<String> {
    optional_string(args, keys)
        .ok_or_else(|| ApiError::bad_request(format!("missing required field `{}`", keys[0])))
}

fn optional_string(args: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        args.get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn required_string_list(args: &Value, keys: &[&str]) -> ApiResult<Vec<String>> {
    optional_string_list(args, keys)
        .ok_or_else(|| ApiError::bad_request(format!("missing required field `{}`", keys[0])))
}

fn optional_string_list(args: &Value, keys: &[&str]) -> Option<Vec<String>> {
    keys.iter().find_map(|key| {
        let value = args.get(*key)?;
        if let Some(single) = value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(vec![single.to_string()]);
        }
        value
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .filter(|items| !items.is_empty())
    })
}

fn optional_string_from_names(args: &Value, keys: &[String]) -> Option<String> {
    let keys = keys.iter().map(String::as_str).collect::<Vec<_>>();
    optional_string(args, &keys)
}

fn optional_string_list_from_names(args: &Value, keys: &[String]) -> Option<Vec<String>> {
    let keys = keys.iter().map(String::as_str).collect::<Vec<_>>();
    optional_string_list(args, &keys)
}

fn optional_positive_number(args: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| args.get(*key).and_then(Value::as_u64))
}

fn optional_positive_number_from_names(args: &Value, keys: &[String]) -> Option<u64> {
    keys.iter()
        .find_map(|key| args.get(key).and_then(Value::as_u64))
}

fn optional_json_from_names(args: &Value, keys: &[String]) -> Option<Value> {
    keys.iter().find_map(|key| args.get(key).cloned())
}
