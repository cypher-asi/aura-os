use crate::test;

#[tokio::test]
async fn test_basic() {
    test(async |browser| {
        let page = browser.new_page("about:blank").await.unwrap();
        page.goto("https://www.google.com").await.unwrap();
        let title = page.get_title().await.unwrap().unwrap();
        assert!(title.contains("Google"));
    })
    .await;
}
