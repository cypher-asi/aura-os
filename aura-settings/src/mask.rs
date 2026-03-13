/// Mask an API key for display.
/// `"sk-ant-api03-abcdefghijklmnop"` -> `"sk-ant-...mnop"`
pub fn mask_api_key(key: &str) -> String {
    if key.len() <= 8 {
        return "****".to_string();
    }
    let prefix_len = key.find('-').map(|i| i + 1).unwrap_or(4).min(8);
    let suffix_len = 4;
    let prefix = &key[..prefix_len];
    let suffix = &key[key.len() - suffix_len..];
    format!("{prefix}...{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_normal_key() {
        let masked = mask_api_key("sk-ant-api03-abcdefghijklmnopqrst");
        assert_eq!(masked, "sk-...qrst");
    }

    #[test]
    fn masks_short_key() {
        assert_eq!(mask_api_key("abcd"), "****");
        assert_eq!(mask_api_key("12345678"), "****");
    }

    #[test]
    fn masks_key_without_dash() {
        let masked = mask_api_key("abcdefghijklmnop");
        assert_eq!(masked, "abcd...mnop");
    }

    #[test]
    fn masks_key_with_long_prefix() {
        let masked = mask_api_key("sk-ant-api03-longkeyvalue");
        assert_eq!(masked, "sk-...alue");
    }
}
