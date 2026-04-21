use chromiumoxide_fetcher::{BrowserFetcherOptions, BrowserKind, Platform};
use tokio::process::Command;

#[ignore]
#[tokio::test]
async fn download_chrome() {
    let path = "./.cache";

    tokio::fs::create_dir_all(path).await.unwrap();

    for platform in Platform::all() {
        let revision = chromiumoxide_fetcher::BrowserFetcher::new(
            BrowserFetcherOptions::builder()
                .with_kind(BrowserKind::Chrome)
                .with_path(path)
                .with_platform(*platform)
                .build()
                .unwrap(),
        )
        .fetch()
        .await
        .unwrap();

        println!("Downloaded revision {revision} for {platform}");
    }
}

#[tokio::test]
async fn test_chrome() {
    let path = "./.cache";

    tokio::fs::create_dir_all(path).await.unwrap();

    // Download the browser
    let revision = chromiumoxide_fetcher::BrowserFetcher::new(
        BrowserFetcherOptions::builder()
            .with_kind(BrowserKind::Chrome)
            .with_path(path)
            .build()
            .unwrap(),
    )
    .fetch()
    .await
    .unwrap();

    println!(
        "Launching browser from {}",
        revision.executable_path.display()
    );

    // Launch the browser
    let mut child = Command::new(&revision.executable_path)
        .spawn()
        .expect("Failed to start Chrome executable");
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    child.kill().await.expect("Failed to kill Chrome process");
}
