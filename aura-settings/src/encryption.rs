use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;

use aura_core::EncryptedBlob;

use crate::error::SettingsError;

const HKDF_INFO: &[u8] = b"aura-settings-encryption-key";
const KEYFILE_NAME: &str = "keyfile";

pub struct KeyEncryption {
    key: [u8; 32],
}

impl KeyEncryption {
    /// Load or generate the machine-local encryption key.
    /// Reads from `{data_dir}/keyfile`. If missing, generates a random
    /// 32-byte seed, derives an AES-256 key via HKDF-SHA256, and
    /// writes the seed to disk.
    pub fn init(data_dir: &Path) -> Result<Self, SettingsError> {
        let keyfile_path = data_dir.join(KEYFILE_NAME);

        let seed = if keyfile_path.exists() {
            std::fs::read(&keyfile_path).map_err(SettingsError::Io)?
        } else {
            let mut seed = vec![0u8; 32];
            rand::thread_rng().fill_bytes(&mut seed);
            std::fs::create_dir_all(data_dir).map_err(SettingsError::Io)?;
            std::fs::write(&keyfile_path, &seed).map_err(SettingsError::Io)?;
            seed
        };

        let hk = Hkdf::<Sha256>::new(None, &seed);
        let mut key = [0u8; 32];
        hk.expand(HKDF_INFO, &mut key)
            .map_err(|e| SettingsError::Encryption(e.to_string()))?;

        Ok(Self { key })
    }

    /// Encrypt plaintext bytes. Returns a nonce + ciphertext pair.
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<EncryptedBlob, SettingsError> {
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| SettingsError::Encryption(e.to_string()))?;

        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| SettingsError::Encryption(e.to_string()))?;

        Ok(EncryptedBlob {
            nonce: nonce_bytes.to_vec(),
            ciphertext,
        })
    }

    /// Decrypt an encrypted blob back to plaintext bytes.
    pub fn decrypt(&self, blob: &EncryptedBlob) -> Result<Vec<u8>, SettingsError> {
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| SettingsError::Encryption(e.to_string()))?;

        let nonce = Nonce::from_slice(&blob.nonce);

        cipher
            .decrypt(nonce, blob.ciphertext.as_ref())
            .map_err(|e| SettingsError::Encryption(e.to_string()))
    }
}
