use std::path::{Path, PathBuf};

use aura_os_store::SettingsStore;

fn resolve_store_path(input: &Path) -> PathBuf {
    if input.file_name().is_some_and(|name| name == "store") {
        return input.to_path_buf();
    }
    input.join("store")
}

fn print_usage() {
    eprintln!("Usage: print-auth-token <aura-data-dir-or-store-dir>");
}

fn main() {
    let mut args = std::env::args_os();
    let _bin = args.next();
    let Some(input) = args.next() else {
        print_usage();
        std::process::exit(2);
    };
    if args.next().is_some() {
        print_usage();
        std::process::exit(2);
    }

    let store_path = resolve_store_path(Path::new(&input));
    let store = match SettingsStore::open(&store_path) {
        Ok(store) => store,
        Err(error) => {
            eprintln!(
                "failed to open Aura settings store at {}: {error}",
                store_path.display()
            );
            std::process::exit(1);
        }
    };

    let Some(session) = store.get_cached_zero_auth_session() else {
        eprintln!(
            "no zero_auth_session found in Aura settings store at {}",
            store_path.display()
        );
        std::process::exit(1);
    };

    let token = session.access_token.trim();
    if token.is_empty() {
        eprintln!(
            "zero_auth_session in Aura settings store at {} has an empty access_token",
            store_path.display()
        );
        std::process::exit(1);
    }

    println!("{token}");
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::resolve_store_path;

    #[test]
    fn resolve_store_path_accepts_data_dir() {
        assert_eq!(
            resolve_store_path(Path::new("/tmp/aura")),
            PathBuf::from("/tmp/aura/store")
        );
    }

    #[test]
    fn resolve_store_path_accepts_store_dir() {
        assert_eq!(
            resolve_store_path(Path::new("/tmp/aura/store")),
            PathBuf::from("/tmp/aura/store")
        );
    }
}
