use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

pub(super) fn trusted_http_method(method: TrustedIntegrationHttpMethod) -> reqwest::Method {
    match method {
        TrustedIntegrationHttpMethod::Get => reqwest::Method::GET,
        TrustedIntegrationHttpMethod::Post => reqwest::Method::POST,
    }
}

pub(super) fn build_runtime_url(
    kind: AppProviderKind,
    secret: &str,
    provider_config: Option<&Value>,
    path: &str,
    query_bindings: &[TrustedIntegrationArgBinding],
    args: &Value,
) -> ApiResult<String> {
    let expanded_path = expand_path_template(path, args)?;
    let mut url =
        app_provider_authenticated_url_with_config(kind, &expanded_path, secret, provider_config)
            .map_err(ApiError::bad_request)?;
    for binding in query_bindings {
        if let Some(value) = resolve_binding_value(args, provider_config, binding)? {
            append_query_value(&mut url, &binding.target, value);
        }
    }
    Ok(url.to_string())
}

pub(super) fn expand_path_template(path: &str, args: &Value) -> ApiResult<String> {
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

pub(super) fn append_query_value(url: &mut reqwest::Url, key: &str, value: Value) {
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

pub(super) fn build_object_from_bindings(
    bindings: &[TrustedIntegrationArgBinding],
    args: &Value,
    provider_config: Option<&Value>,
) -> ApiResult<Option<Value>> {
    if bindings.is_empty() {
        return Ok(None);
    }

    if bindings.len() == 1 && bindings[0].target == "$" {
        return resolve_binding_value(args, provider_config, &bindings[0]);
    }

    let mut body = json!({});
    let mut inserted = false;
    for binding in bindings {
        if binding.target == "$" {
            return Err(ApiError::internal(
                "trusted integration metadata cannot mix root body bindings with object bindings",
            ));
        }
        if let Some(value) = resolve_binding_value(args, provider_config, binding)? {
            insert_json_path(&mut body, &binding.target, value)?;
            inserted = true;
        }
    }
    Ok(inserted.then_some(body))
}

pub(super) fn build_form_fields_from_bindings(
    bindings: &[TrustedIntegrationArgBinding],
    args: &Value,
    provider_config: Option<&Value>,
) -> ApiResult<Vec<(String, String)>> {
    let mut fields = Vec::new();
    for binding in bindings {
        if let Some(value) = resolve_binding_value(args, provider_config, binding)? {
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

pub(super) fn form_field_value(value: Value) -> String {
    match value {
        Value::String(value) => value,
        other => other.to_string(),
    }
}

pub(super) fn resolve_binding_value(
    args: &Value,
    provider_config: Option<&Value>,
    binding: &TrustedIntegrationArgBinding,
) -> ApiResult<Option<Value>> {
    if binding.arg_names.is_empty() {
        return Ok(binding.default_value.clone());
    }

    let resolved = match binding.source {
        TrustedIntegrationArgSource::InputArgs => match binding.value_type {
            TrustedIntegrationArgValueType::String => {
                optional_string_from_names(args, &binding.arg_names).map(Value::String)
            }
            TrustedIntegrationArgValueType::StringList => {
                optional_string_list_from_names(args, &binding.arg_names).map(|items| json!(items))
            }
            TrustedIntegrationArgValueType::PositiveNumber => {
                optional_positive_number_from_names(args, &binding.arg_names)
                    .map(|value| json!(value))
            }
            TrustedIntegrationArgValueType::Boolean => {
                optional_bool_from_names(args, &binding.arg_names).map(Value::Bool)
            }
            TrustedIntegrationArgValueType::Json => {
                optional_json_from_names(args, &binding.arg_names)
            }
        },
        TrustedIntegrationArgSource::ProviderConfig => match binding.value_type {
            TrustedIntegrationArgValueType::String => provider_config
                .and_then(|config| optional_string_from_names(config, &binding.arg_names))
                .map(Value::String),
            TrustedIntegrationArgValueType::StringList => provider_config
                .and_then(|config| optional_string_list_from_names(config, &binding.arg_names))
                .map(|items| json!(items)),
            TrustedIntegrationArgValueType::PositiveNumber => provider_config
                .and_then(|config| optional_positive_number_from_names(config, &binding.arg_names))
                .map(|value| json!(value)),
            TrustedIntegrationArgValueType::Boolean => provider_config
                .and_then(|config| optional_bool_from_names(config, &binding.arg_names))
                .map(Value::Bool),
            TrustedIntegrationArgValueType::Json => provider_config
                .and_then(|config| optional_json_from_names(config, &binding.arg_names)),
        },
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

pub(super) fn insert_json_path(target: &mut Value, path: &str, value: Value) -> ApiResult<()> {
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

pub(super) fn apply_success_guard(
    response: &Value,
    guard: &TrustedIntegrationSuccessGuard,
) -> ApiResult<()> {
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

pub(super) fn apply_result_transform(
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

pub(super) fn object_with_entry(key: &str, value: Value) -> Value {
    let mut map = serde_json::Map::new();
    map.insert(key.to_string(), value);
    Value::Object(map)
}

pub(super) fn project_fields(source: &Value, fields: &[TrustedIntegrationResultField]) -> Value {
    let mut result = json!({});
    for field in fields {
        result[&field.output] = source
            .pointer(&field.pointer)
            .cloned()
            .unwrap_or(Value::Null);
    }
    result
}

pub(super) async fn provider_json_request(
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

pub(super) async fn provider_form_request(
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

pub(super) fn ensure_slack_ok(response: &Value) -> ApiResult<()> {
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

pub(super) fn build_gmail_raw_message(
    from: &str,
    to: &[String],
    cc: Option<&[String]>,
    bcc: Option<&[String]>,
    subject: &str,
    text: Option<&str>,
    html: Option<&str>,
) -> ApiResult<String> {
    let from = safe_header_value("from", from)?;
    let subject = safe_header_value("subject", subject)?;
    let to_header = safe_header_list("to", to)?;
    let cc_header = cc
        .filter(|items| !items.is_empty())
        .map(|items| safe_header_list("cc", items))
        .transpose()?;
    let bcc_header = bcc
        .filter(|items| !items.is_empty())
        .map(|items| safe_header_list("bcc", items))
        .transpose()?;
    let (content_type, body) = if let Some(html) = html.filter(|value| !value.trim().is_empty()) {
        ("text/html", html)
    } else if let Some(text) = text.filter(|value| !value.trim().is_empty()) {
        ("text/plain", text)
    } else {
        return Err(ApiError::bad_request(
            "gmail_send_email requires non-empty `text` or `html`",
        ));
    };

    let mut message = String::new();
    message.push_str("MIME-Version: 1.0\r\n");
    message.push_str(&format!("From: {from}\r\n"));
    message.push_str(&format!("To: {to_header}\r\n"));
    if let Some(cc_header) = cc_header {
        message.push_str(&format!("Cc: {cc_header}\r\n"));
    }
    if let Some(bcc_header) = bcc_header {
        message.push_str(&format!("Bcc: {bcc_header}\r\n"));
    }
    message.push_str(&format!("Subject: {subject}\r\n"));
    message.push_str(&format!(
        "Content-Type: {content_type}; charset=\"UTF-8\"\r\n"
    ));
    message.push_str("Content-Transfer-Encoding: 8bit\r\n");
    message.push_str("\r\n");
    message.push_str(body);

    Ok(URL_SAFE_NO_PAD.encode(message.as_bytes()))
}

fn safe_header_list(name: &str, values: &[String]) -> ApiResult<String> {
    if values.is_empty() {
        return Err(ApiError::bad_request(format!(
            "gmail_send_email requires at least one `{name}` recipient"
        )));
    }
    values
        .iter()
        .map(|value| safe_header_value(name, value))
        .collect::<ApiResult<Vec<_>>>()
        .map(|values| values.join(", "))
}

fn safe_header_value(name: &str, value: &str) -> ApiResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(ApiError::bad_request(format!(
            "gmail_send_email `{name}` cannot be empty"
        )));
    }
    if value.contains('\r') || value.contains('\n') {
        return Err(ApiError::bad_request(format!(
            "gmail_send_email `{name}` cannot contain newlines"
        )));
    }
    Ok(value.to_string())
}

pub(super) fn required_string(args: &Value, keys: &[&str]) -> ApiResult<String> {
    optional_string(args, keys)
        .ok_or_else(|| ApiError::bad_request(format!("missing required field `{}`", keys[0])))
}

pub(super) fn optional_string(args: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        args.get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

pub(super) fn required_string_list(args: &Value, keys: &[&str]) -> ApiResult<Vec<String>> {
    optional_string_list(args, keys)
        .ok_or_else(|| ApiError::bad_request(format!("missing required field `{}`", keys[0])))
}

pub(super) fn optional_string_list(args: &Value, keys: &[&str]) -> Option<Vec<String>> {
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

pub(super) fn optional_string_from_names(args: &Value, keys: &[String]) -> Option<String> {
    let keys = keys.iter().map(String::as_str).collect::<Vec<_>>();
    optional_string(args, &keys)
}

pub(super) fn optional_string_list_from_names(
    args: &Value,
    keys: &[String],
) -> Option<Vec<String>> {
    let keys = keys.iter().map(String::as_str).collect::<Vec<_>>();
    optional_string_list(args, &keys)
}

pub(super) fn optional_positive_number(args: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| args.get(*key).and_then(Value::as_u64))
}

pub(super) fn optional_positive_number_from_names(args: &Value, keys: &[String]) -> Option<u64> {
    keys.iter()
        .find_map(|key| args.get(key).and_then(Value::as_u64))
}

pub(super) fn optional_bool_from_names(args: &Value, keys: &[String]) -> Option<bool> {
    keys.iter().find_map(|key| {
        let value = args.get(key)?;
        if let Some(value) = value.as_bool() {
            return Some(value);
        }
        value.as_str().and_then(|raw| match raw.trim() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        })
    })
}

pub(super) fn optional_json_from_names(args: &Value, keys: &[String]) -> Option<Value> {
    keys.iter().find_map(|key| args.get(key).cloned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;

    #[test]
    fn gmail_raw_message_is_base64url_encoded_mime() {
        let encoded = build_gmail_raw_message(
            "Aura <sender@example.com>",
            &["to@example.com".to_string()],
            Some(&["cc@example.com".to_string()]),
            None,
            "Hello",
            Some("Plain body"),
            None,
        )
        .expect("gmail raw message");
        let decoded = String::from_utf8(URL_SAFE_NO_PAD.decode(encoded).expect("decode"))
            .expect("utf8 message");

        assert!(decoded.contains("From: Aura <sender@example.com>\r\n"));
        assert!(decoded.contains("To: to@example.com\r\n"));
        assert!(decoded.contains("Cc: cc@example.com\r\n"));
        assert!(decoded.contains("Subject: Hello\r\n"));
        assert!(decoded.contains("Content-Type: text/plain; charset=\"UTF-8\"\r\n"));
        assert!(decoded.ends_with("Plain body"));
    }

    #[test]
    fn gmail_raw_message_rejects_header_newlines() {
        let err = build_gmail_raw_message(
            "sender@example.com",
            &["to@example.com".to_string()],
            None,
            None,
            "Hello\r\nBcc: attacker@example.com",
            Some("Plain body"),
            None,
        )
        .expect_err("header injection should fail");

        let api_error = (err.1).0;
        assert!(api_error.error.contains("cannot contain newlines"));
    }
}
