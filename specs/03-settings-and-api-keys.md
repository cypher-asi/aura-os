# Spec 03 — Settings & API Key Management

## Purpose

Provide a secure settings subsystem that stores, encrypts, retrieves, and validates the Claude API key (and any future configuration values). The API key is the single external credential the MVP depends on. It must be encrypted at rest and never exposed as plaintext in the UI after initial entry.

---

## Core Concepts

### Settings as Key-Value Pairs

Settings are stored in the `settings` column family as simple string key -> bytes value pairs. Most settings are plain JSON values, but secrets (like API keys) are encrypted before storage.

### At-Rest Encryption

API keys are encrypted with AES-256-GCM before being written to RocksDB. The encryption key is derived from a machine-local seed using HKDF-SHA256. The seed is a random 32-byte value generated once and stored in a `keyfile` next to the database. This protects the API key if the database files are copied to another machine, but does not defend against a local attacker with filesystem access to both the DB and the keyfile — acceptable for a single-user local desktop app.

### Masked Display

After an API key is stored, the system only returns a masked version (e.g., `sk-ant-...****XYZ`) for display. Internal subsystems that need the plaintext (e.g., the Claude client) call a dedicated `decrypt_api_key` function that is never exposed over the API.

### Key Validation

When an API key is stored or updated, the system probes the Claude API with a minimal request (e.g., list models or a trivial completion) to verify the key is valid. Validation is best-effort: a network failure does not block storage, but the validation status is recorded.

---

## Interfaces

### Settings Types

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsEntry {
    pub key: String,
    pub value: SettingsValue,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
#[serde(rename_all = "snake_case")]
pub enum SettingsValue {
    PlainText(String),
    Encrypted(EncryptedBlob),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedBlob {
    pub nonce: Vec<u8>,    // 12 bytes for AES-256-GCM
    pub ciphertext: Vec<u8>,
}
```

### API Key Status

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiKeyStatus {
    NotSet,
    Valid,
    Invalid,
    ValidationPending,
    ValidationFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyInfo {
    pub status: ApiKeyStatus,
    pub masked_key: Option<String>,
    pub last_validated_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}
```

### Encryption Module

```rust
pub struct KeyEncryption {
    key: [u8; 32],
}

impl KeyEncryption {
    /// Load or generate the machine-local encryption key.
    /// Reads from `{data_dir}/keyfile`. If missing, generates a random
    /// 32-byte seed, derives an AES-256 key via HKDF-SHA256, and
    /// writes the seed to disk.
    pub fn init(data_dir: &Path) -> Result<Self, SettingsError> { /* ... */ }

    /// Encrypt plaintext bytes. Returns a nonce + ciphertext pair.
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<EncryptedBlob, SettingsError> { /* ... */ }

    /// Decrypt an encrypted blob back to plaintext bytes.
    pub fn decrypt(&self, blob: &EncryptedBlob) -> Result<Vec<u8>, SettingsError> { /* ... */ }
}
```

### Settings Service

```rust
pub struct SettingsService {
    store: Arc<RocksStore>,
    encryption: KeyEncryption,
}

impl SettingsService {
    pub fn new(store: Arc<RocksStore>, data_dir: &Path) -> Result<Self, SettingsError> { /* ... */ }

    /// Store or update the Claude API key (encrypts before writing).
    pub async fn set_api_key(&self, plaintext_key: &str) -> Result<ApiKeyInfo, SettingsError> {
        // 1. Encrypt the key
        // 2. Store as SettingsEntry with key = "claude_api_key"
        // 3. Spawn async validation probe
        // 4. Return masked info with status = validation_pending
    }

    /// Retrieve the API key info for display (never returns plaintext).
    pub fn get_api_key_info(&self) -> Result<ApiKeyInfo, SettingsError> { /* ... */ }

    /// Internal: decrypt the API key for use by Claude client.
    /// Not exposed over HTTP.
    pub(crate) fn decrypt_api_key(&self) -> Result<String, SettingsError> { /* ... */ }

    /// Delete the stored API key.
    pub fn delete_api_key(&self) -> Result<(), SettingsError> { /* ... */ }

    /// Set a plain-text setting (non-secret).
    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), SettingsError> { /* ... */ }

    /// Get a plain-text setting.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, SettingsError> { /* ... */ }
}
```

### Masking Helper

```rust
/// Mask an API key for display.
/// "sk-ant-api03-abcdefghijklmnop" -> "sk-ant-...nop"
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
```

### Error Type

```rust
#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("encryption error: {0}")]
    Encryption(String),
    #[error("API key not set")]
    ApiKeyNotSet,
    #[error("API key validation failed: {0}")]
    ValidationFailed(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
```

---

## State Machines

### API Key Lifecycle

```mermaid
stateDiagram-v2
    [*] --> NotSet
    NotSet --> ValidationPending : user enters key
    ValidationPending --> Valid : probe succeeds
    ValidationPending --> Invalid : probe returns auth error
    ValidationPending --> ValidationFailed : network error
    Valid --> ValidationPending : user updates key
    Invalid --> ValidationPending : user updates key
    ValidationFailed --> ValidationPending : user updates key
    Valid --> NotSet : user deletes key
    Invalid --> NotSet : user deletes key
    ValidationFailed --> NotSet : user deletes key
```

---

## Key Behaviors

1. **Keyfile generation** — on first launch, `KeyEncryption::init` generates a 32-byte random seed, writes it to `{data_dir}/keyfile`, and derives the AES-256 key. On subsequent launches, it reads the existing seed.
2. **Nonce uniqueness** — each `encrypt()` call generates a fresh random 12-byte nonce. AES-256-GCM is nonce-misuse-resistant for different nonces.
3. **Validation is async** — `set_api_key` returns immediately with `validation_pending` status. A background task probes the Claude API and updates the status to `valid`, `invalid`, or `validation_failed`.
4. **Plaintext never leaves the service** — `decrypt_api_key` is `pub(crate)`, invisible to the HTTP API layer. The API layer can only call `get_api_key_info` which returns the masked version.
5. **Idempotent updates** — calling `set_api_key` with the same key re-encrypts (new nonce) and re-validates. This is intentional: re-validation catches revoked keys.
6. **Settings column family** — plain settings use `SettingsValue::PlainText`, secrets use `SettingsValue::Encrypted`. The column family stores both.

---

## Dependencies

| Spec | What is used |
|------|-------------|
| Spec 01 | `SettingsEntry` uses `DateTime<Utc>` conventions from entity patterns |
| Spec 02 | `RocksStore` for `settings` column family read/write |

**External crates:**

| Crate | Version | Purpose |
|-------|---------|---------|
| `aes-gcm` | 0.10.x | AES-256-GCM encryption/decryption |
| `hkdf` | 0.12.x | Key derivation from seed |
| `sha2` | 0.10.x | SHA-256 for HKDF |
| `rand` | 0.8.x | Random seed and nonce generation |
| `reqwest` | 0.11.x | HTTP probe for API key validation |

---

## Tasks

| ID | Task | Description |
|----|------|-------------|
| T03.1 | Define settings types | `SettingsEntry`, `SettingsValue`, `EncryptedBlob`, `ApiKeyStatus`, `ApiKeyInfo` in `aura-os-core` |
| T03.2 | Implement `KeyEncryption` | `init`, `encrypt`, `decrypt` with AES-256-GCM; keyfile read/write |
| T03.3 | Implement `mask_api_key` | Masking helper with tests for various key formats |
| T03.4 | Implement settings store ops | `put_setting` / `get_setting` / `delete_setting` in `aura-os-store` settings CF |
| T03.5 | Implement `SettingsService` | Wire encryption + store: `set_api_key`, `get_api_key_info`, `decrypt_api_key`, `delete_api_key` |
| T03.6 | Implement API key validation probe | Async function that calls Claude API with the decrypted key, updates status |
| T03.7 | Unit tests — encryption round-trip | Encrypt then decrypt, verify plaintext matches. Different nonces each time. |
| T03.8 | Unit tests — masking | Various key lengths and formats produce expected masked output |
| T03.9 | Integration tests — settings service | Store key, retrieve masked info, decrypt internally, delete, verify not-set |
| T03.10 | Integration tests — keyfile persistence | Init encryption, close, reopen, verify same key decrypts old data |
| T03.11 | Clippy + fmt clean | All crates pass clippy and fmt |

---

## Test Criteria

All of the following must pass before proceeding to Spec 04:

- [ ] Encryption round-trip: encrypt then decrypt yields original plaintext
- [ ] Different encryptions of the same plaintext produce different ciphertexts (unique nonces)
- [ ] `mask_api_key` produces expected output for keys of various lengths
- [ ] `set_api_key` stores encrypted blob in settings CF, `get_api_key_info` returns masked version
- [ ] `decrypt_api_key` returns original plaintext (internal use only)
- [ ] `delete_api_key` removes the key, `get_api_key_info` returns `NotSet`
- [ ] Keyfile survives process restart: data encrypted before restart decrypts after restart
- [ ] Plain-text settings (`set_setting` / `get_setting`) round-trip correctly
- [ ] Clippy and fmt are clean across all crates
