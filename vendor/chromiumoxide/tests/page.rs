use crate::test;

#[tokio::test]
async fn test_evaluate_on_new_document() {
    test(async |browser| {
        let page = browser
            .new_page("about:blank")
            .await
            .expect("should create new page");

        page.evaluate_on_new_document("window.testValue = 42;")
            .await
            .expect("should evaluate script on new document");

        page.goto("https://www.google.com")
            .await
            .expect("should navigate to www.google.com");

        let result: i32 = page
            .evaluate("window.testValue")
            .await
            .expect("should evaluate window.testValue")
            .into_value()
            .expect("should convert to i32");

        assert_eq!(result, 42);
    })
    .await;
}

#[tokio::test]
async fn test_add_init_script() {
    test(async |browser| {
        let page = browser
            .new_page("about:blank")
            .await
            .expect("should create new page");

        page.add_init_script("window.testValue = 42;")
            .await
            .expect("should add init script");

        page.goto("https://www.google.com")
            .await
            .expect("should navigate to www.google.com");

        let result: i32 = page
            .evaluate("window.testValue")
            .await
            .expect("should evaluate window.testValue")
            .into_value()
            .expect("should convert to i32");

        assert_eq!(result, 42);
    })
    .await;
}
