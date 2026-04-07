use std::env;
use std::path::{Path, PathBuf};

use aura_os_store::RocksStore;

fn resolve_db_path(input: Option<&str>) -> PathBuf {
    let path = input
        .map(PathBuf::from)
        .or_else(|| env::var("AURA_DATA_DIR").ok().map(PathBuf::from))
        .unwrap_or_else(|| {
            dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("aura")
        });

    if path.join("CURRENT").exists() {
        path
    } else {
        path.join("db")
    }
}

fn main() {
    let arg = env::args().nth(1);
    let db_path = resolve_db_path(arg.as_deref());

    if !Path::new(&db_path).exists() {
        eprintln!("Aura DB path does not exist: {}", db_path.display());
        std::process::exit(1);
    }

    let store = RocksStore::open(&db_path).unwrap_or_else(|error| {
        eprintln!("Failed to open Aura DB at {}: {error}", db_path.display());
        std::process::exit(1);
    });

    let Some(jwt) = store.get_jwt() else {
        eprintln!(
            "No persisted Aura auth token found in {}",
            db_path.display()
        );
        std::process::exit(1);
    };

    println!("{jwt}");
}
