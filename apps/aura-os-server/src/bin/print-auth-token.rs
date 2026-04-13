fn main() {
    eprintln!(
        "Aura auth tokens are now browser-managed and are no longer stored on disk. \
Use the browser session in IndexedDB/local runtime state instead."
    );
    std::process::exit(1);
}
