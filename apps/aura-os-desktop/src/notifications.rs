use crate::events::NativeNotificationPayload;

#[cfg(target_os = "macos")]
pub(crate) fn request_notification_authorization() -> Result<(), String> {
    macos::request_notification_authorization()
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn request_notification_authorization() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn show_native_notification(payload: &NativeNotificationPayload) -> Result<(), String> {
    macos::show_native_notification(payload)
}

#[cfg(target_os = "windows")]
pub(crate) fn show_native_notification(payload: &NativeNotificationPayload) -> Result<(), String> {
    windows_notifications::show_native_notification(payload)
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) fn show_native_notification(payload: &NativeNotificationPayload) -> Result<(), String> {
    freedesktop::show_native_notification(payload)
}

#[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
pub(crate) fn show_native_notification(payload: &NativeNotificationPayload) -> Result<(), String> {
    tracing::warn!(
        id = %payload.id,
        "native desktop notifications are not supported on this platform"
    );
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn set_application_badge(count: Option<u32>) {
    macos::set_application_badge(count);
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_application_badge(_count: Option<u32>) {}

fn notification_title(payload: &NativeNotificationPayload) -> Result<&str, String> {
    let title = payload.title.trim();
    if title.is_empty() {
        Err("notification title cannot be empty".to_string())
    } else {
        Ok(title)
    }
}

fn notification_body(payload: &NativeNotificationPayload) -> Option<&str> {
    payload
        .body
        .as_deref()
        .map(str::trim)
        .filter(|body| !body.is_empty())
}

#[cfg(any(target_os = "windows", all(unix, not(target_os = "macos")), test))]
fn stable_notification_id(value: &str) -> u32 {
    let mut hash = 0x811c_9dc5u32;
    for byte in value.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash.max(1)
}

#[cfg(any(target_os = "windows", test))]
fn build_windows_toast_xml(title: &str, body: Option<&str>, sound: bool) -> String {
    let body = body
        .map(xml_escape)
        .filter(|body| !body.is_empty())
        .map(|body| format!("<text>{body}</text>"))
        .unwrap_or_default();
    let audio = if sound {
        String::new()
    } else {
        "<audio silent=\"true\" />".to_string()
    };

    format!(
        "<toast duration=\"short\"><visual><binding template=\"ToastGeneric\"><text>{}</text>{}</binding></visual>{}</toast>",
        xml_escape(title),
        body,
        audio
    )
}

#[cfg(any(target_os = "windows", test))]
fn xml_escape(value: &str) -> String {
    value.chars().fold(String::new(), |mut escaped, ch| {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(ch),
        }
        escaped
    })
}

#[cfg(target_os = "windows")]
mod windows_notifications {
    use aura_os_core::Channel;
    use windows::core::HSTRING;
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

    use crate::events::NativeNotificationPayload;

    const AURA_TOAST_GROUP: &str = "aura";
    const STABLE_APP_USER_MODEL_ID: &str = "com.aura.desktop";
    const DEV_APP_USER_MODEL_ID: &str = "com.aura.desktop-dev";

    pub(super) fn show_native_notification(
        payload: &NativeNotificationPayload,
    ) -> Result<(), String> {
        let title = super::notification_title(payload)?;
        let body = super::notification_body(payload);
        let xml = super::build_windows_toast_xml(title, body, payload.sound);
        let xml_document =
            XmlDocument::new().map_err(|error| format!("failed to create toast XML: {error}"))?;
        xml_document
            .LoadXml(&HSTRING::from(xml))
            .map_err(|error| format!("failed to load toast XML: {error}"))?;

        let toast = ToastNotification::CreateToastNotification(&xml_document)
            .map_err(|error| format!("failed to create Windows toast notification: {error}"))?;
        let tag = format!("{:08x}", super::stable_notification_id(&payload.id));
        toast
            .SetTag(&HSTRING::from(tag))
            .map_err(|error| format!("failed to set Windows toast tag: {error}"))?;
        toast
            .SetGroup(&HSTRING::from(AURA_TOAST_GROUP))
            .map_err(|error| format!("failed to set Windows toast group: {error}"))?;

        let app_user_model_id = app_user_model_id();
        let notifier =
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(
                app_user_model_id.as_str(),
            ))
            .map_err(|error| {
                format!(
                    "failed to create Windows toast notifier for AppUserModelID {app_user_model_id}: {error}"
                )
            })?;
        notifier
            .Show(&toast)
            .map_err(|error| format!("failed to show Windows toast notification: {error}"))?;

        tracing::info!(
            id = %payload.id,
            app_user_model_id = %app_user_model_id,
            sound = payload.sound,
            "delivered native notification"
        );
        Ok(())
    }

    fn app_user_model_id() -> String {
        if let Ok(value) = std::env::var("AURA_WINDOWS_AUMID") {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }

        match Channel::current() {
            Channel::Stable => STABLE_APP_USER_MODEL_ID,
            Channel::Dev => DEV_APP_USER_MODEL_ID,
        }
        .to_string()
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod freedesktop {
    use notify_rust::{Notification, Timeout, Urgency};

    use crate::events::NativeNotificationPayload;

    pub(super) fn show_native_notification(
        payload: &NativeNotificationPayload,
    ) -> Result<(), String> {
        let title = super::notification_title(payload)?;
        let body = super::notification_body(payload).unwrap_or("");
        let id = super::stable_notification_id(&payload.id);

        let mut notification = Notification::new();
        notification
            .appname("AURA")
            .summary(title)
            .body(body)
            .icon("aura")
            .id(id)
            .timeout(Timeout::Milliseconds(6000))
            .urgency(Urgency::Normal);

        if payload.sound {
            notification.sound_name("message-new-instant");
        }

        notification
            .show()
            .map_err(|error| format!("failed to show Freedesktop notification: {error}"))?;

        tracing::info!(
            id = %payload.id,
            xdg_id = id,
            sound = payload.sound,
            "delivered native notification"
        );
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::CStr;
    use std::os::raw::{c_char, c_void};
    use std::sync::atomic::{AtomicPtr, Ordering};
    use std::sync::Once;

    use block2::{Block, RcBlock};
    use objc::declare::ClassDecl;
    use objc::runtime::{Object, Sel};
    use objc::{class, msg_send, sel, sel_impl};

    use crate::events::NativeNotificationPayload;

    const NOTIFICATION_AUTHORIZATION_OPTIONS: usize = 1 | 2 | 4; // badge, sound, alert
    const NOTIFICATION_PRESENTATION_OPTIONS: usize = 1 | 2 | 4 | 8 | 16; // badge, sound, alert, list, banner
    const NS_UTF8_STRING_ENCODING: usize = 4;
    static NOTIFICATION_DELEGATE_INIT: Once = Once::new();
    static NOTIFICATION_DELEGATE: AtomicPtr<Object> = AtomicPtr::new(std::ptr::null_mut());

    #[link(name = "UserNotifications", kind = "framework")]
    unsafe extern "C" {}

    pub(super) fn request_notification_authorization() -> Result<(), String> {
        unsafe {
            let pool = AutoReleasePool::new();
            let center = current_notification_center()?;
            install_notification_delegate(center);

            let authorization_completion = RcBlock::new(move |granted: i8, error: *mut c_void| {
                let pool = AutoReleasePool::new();
                let error = error.cast::<Object>();
                if !error.is_null() {
                    let description =
                        localized_error_description(error).unwrap_or_else(|| "unknown".into());
                    tracing::warn!(
                        error = %description,
                        "failed to request notification authorization"
                    );
                }

                if granted == 0 {
                    tracing::warn!("notification authorization was not granted");
                } else {
                    tracing::info!("notification authorization granted");
                }
                drop(pool);
            });

            let _: () = msg_send![
                center,
                requestAuthorizationWithOptions: NOTIFICATION_AUTHORIZATION_OPTIONS
                completionHandler: &*authorization_completion
            ];

            drop(pool);
            Ok(())
        }
    }

    pub(super) fn show_native_notification(
        payload: &NativeNotificationPayload,
    ) -> Result<(), String> {
        let title = super::notification_title(payload)?;

        unsafe {
            let pool = AutoReleasePool::new();

            let center = current_notification_center()?;
            install_notification_delegate(center);

            let content: *mut Object = msg_send![class!(UNMutableNotificationContent), new];
            if content.is_null() {
                return Err("failed to allocate UNMutableNotificationContent".to_string());
            }

            let identifier = ns_string(&payload.id);
            let title = ns_string(title);
            let body = super::notification_body(payload).map(|body| ns_string(body));

            let _: () = msg_send![content, setTitle: title.as_ptr()];
            if let Some(body) = body.as_ref() {
                let _: () = msg_send![content, setBody: body.as_ptr()];
            }
            if payload.sound {
                let sound: *mut Object = msg_send![class!(UNNotificationSound), defaultSound];
                if !sound.is_null() {
                    let _: () = msg_send![content, setSound: sound];
                }
            }
            if let Some(count) = payload.badge_count {
                let badge: *mut Object =
                    msg_send![class!(NSNumber), numberWithUnsignedInteger: count as usize];
                if !badge.is_null() {
                    let _: () = msg_send![content, setBadge: badge];
                }
            }

            let request: *mut Object = msg_send![
                class!(UNNotificationRequest),
                requestWithIdentifier: identifier.as_ptr()
                content: content
                trigger: std::ptr::null_mut::<Object>()
            ];
            let _: () = msg_send![content, release];
            if request.is_null() {
                return Err("failed to allocate UNNotificationRequest".to_string());
            }
            let retained_request: *mut Object = msg_send![request, retain];

            let notification_id = payload.id.clone();
            let badge_count = payload.badge_count;
            let sound = payload.sound;
            let authorization_completion = RcBlock::new(move |granted: i8, error: *mut c_void| {
                let pool = AutoReleasePool::new();
                let error = error.cast::<Object>();
                if !error.is_null() {
                    let description =
                        localized_error_description(error).unwrap_or_else(|| "unknown".into());
                    tracing::warn!(
                        id = %notification_id,
                        error = %description,
                        "failed to request notification authorization"
                    );
                }
                if granted == 0 {
                    let _: () = msg_send![retained_request, release];
                    tracing::warn!(
                        id = %notification_id,
                        "notification authorization was not granted"
                    );
                    drop(pool);
                    return;
                }

                let center: *mut Object =
                    msg_send![class!(UNUserNotificationCenter), currentNotificationCenter];
                if center.is_null() {
                    let _: () = msg_send![retained_request, release];
                    tracing::warn!(
                        id = %notification_id,
                        "failed to get UNUserNotificationCenter after authorization"
                    );
                    drop(pool);
                    return;
                }

                let completion_id = notification_id.clone();
                let add_completion = RcBlock::new(move |add_error: *mut c_void| {
                    let pool = AutoReleasePool::new();
                    let add_error = add_error.cast::<Object>();
                    if !add_error.is_null() {
                        let description = localized_error_description(add_error)
                            .unwrap_or_else(|| "unknown".into());
                        tracing::warn!(
                            id = %completion_id,
                            error = %description,
                            "failed to add native notification request"
                        );
                    } else {
                        tracing::info!(
                            id = %completion_id,
                            badge_count,
                            sound,
                            "delivered native notification"
                        );
                    }
                    drop(pool);
                });

                let _: () = msg_send![
                    center,
                    addNotificationRequest: retained_request
                    withCompletionHandler: &*add_completion
                ];
                let _: () = msg_send![retained_request, release];
                drop(pool);
            });

            let _: () = msg_send![
                center,
                requestAuthorizationWithOptions: NOTIFICATION_AUTHORIZATION_OPTIONS
                completionHandler: &*authorization_completion
            ];

            set_application_badge(payload.badge_count);
            drop(pool);
            Ok(())
        }
    }

    pub(super) fn set_application_badge(count: Option<u32>) {
        unsafe {
            let pool = AutoReleasePool::new();
            let app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
            if app.is_null() {
                return;
            }
            let dock_tile: *mut Object = msg_send![app, dockTile];
            if dock_tile.is_null() {
                return;
            }
            if let Some(count) = count.filter(|count| *count > 0) {
                let label = ns_string(&count.to_string());
                let _: () = msg_send![dock_tile, setBadgeLabel: label.as_ptr()];
            } else {
                let _: () = msg_send![dock_tile, setBadgeLabel: std::ptr::null_mut::<Object>()];
            }
            drop(pool);
        }
    }

    unsafe fn current_notification_center() -> Result<*mut Object, String> {
        let center: *mut Object =
            msg_send![class!(UNUserNotificationCenter), currentNotificationCenter];
        if center.is_null() {
            Err("failed to get UNUserNotificationCenter".to_string())
        } else {
            Ok(center)
        }
    }

    unsafe fn install_notification_delegate(center: *mut Object) {
        NOTIFICATION_DELEGATE_INIT.call_once(|| {
            let superclass = class!(NSObject);
            let mut decl = ClassDecl::new("AuraNotificationCenterDelegate", superclass)
                .expect("AuraNotificationCenterDelegate class should register exactly once");
            unsafe {
                decl.add_method(
                    sel!(userNotificationCenter:willPresentNotification:withCompletionHandler:),
                    will_present_notification
                        as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut c_void),
                );
            }
            let delegate_class = decl.register();
            let delegate: *mut Object = unsafe { msg_send![delegate_class, new] };
            NOTIFICATION_DELEGATE.store(delegate, Ordering::SeqCst);
        });

        let delegate = NOTIFICATION_DELEGATE.load(Ordering::SeqCst);
        if !delegate.is_null() {
            let _: () = msg_send![center, setDelegate: delegate];
        }
    }

    extern "C" fn will_present_notification(
        _this: &Object,
        _cmd: Sel,
        _center: *mut Object,
        _notification: *mut Object,
        completion_handler: *mut c_void,
    ) {
        unsafe {
            let completion_handler = completion_handler.cast::<Block<dyn Fn(usize)>>();
            if let Some(completion_handler) = completion_handler.as_ref() {
                completion_handler.call((NOTIFICATION_PRESENTATION_OPTIONS,));
            }
        }
    }

    struct AutoReleasePool {
        inner: *mut Object,
    }

    impl AutoReleasePool {
        unsafe fn new() -> Self {
            let inner: *mut Object = msg_send![class!(NSAutoreleasePool), new];
            Self { inner }
        }
    }

    impl Drop for AutoReleasePool {
        fn drop(&mut self) {
            unsafe {
                if !self.inner.is_null() {
                    let _: () = msg_send![self.inner, drain];
                }
            }
        }
    }

    struct NsString {
        inner: *mut Object,
    }

    impl NsString {
        fn as_ptr(&self) -> *mut Object {
            self.inner
        }
    }

    impl Drop for NsString {
        fn drop(&mut self) {
            unsafe {
                if !self.inner.is_null() {
                    let _: () = msg_send![self.inner, release];
                }
            }
        }
    }

    unsafe fn ns_string(value: &str) -> NsString {
        let string: *mut Object = msg_send![class!(NSString), alloc];
        let string: *mut Object = msg_send![
            string,
            initWithBytes: value.as_ptr()
            length: value.len()
            encoding: NS_UTF8_STRING_ENCODING
        ];
        NsString { inner: string }
    }

    unsafe fn localized_error_description(error: *mut Object) -> Option<String> {
        if error.is_null() {
            return None;
        }
        let description: *mut Object = msg_send![error, localizedDescription];
        ns_string_to_string(description)
    }

    unsafe fn ns_string_to_string(value: *mut Object) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let utf8: *const c_char = msg_send![value, UTF8String];
        if utf8.is_null() {
            return None;
        }
        Some(CStr::from_ptr(utf8).to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(title: &str, body: Option<&str>) -> NativeNotificationPayload {
        NativeNotificationPayload {
            id: "task:123".to_string(),
            title: title.to_string(),
            body: body.map(str::to_string),
            sound: true,
            badge_count: Some(1),
        }
    }

    #[test]
    fn notification_title_trims_and_rejects_empty_values() {
        let valid = payload("  Task complete  ", None);
        assert_eq!(notification_title(&valid).unwrap(), "Task complete");

        let blank = payload(" \n\t ", None);
        assert_eq!(
            notification_title(&blank).unwrap_err(),
            "notification title cannot be empty"
        );
    }

    #[test]
    fn notification_body_trims_and_ignores_empty_values() {
        let with_body = payload("Task complete", Some("  Review output  "));
        assert_eq!(notification_body(&with_body), Some("Review output"));

        let blank_body = payload("Task complete", Some("  "));
        assert_eq!(notification_body(&blank_body), None);

        let no_body = payload("Task complete", None);
        assert_eq!(notification_body(&no_body), None);
    }

    #[test]
    fn stable_notification_id_is_deterministic_and_nonzero() {
        let first = stable_notification_id("task:123");
        let second = stable_notification_id("task:123");
        let different = stable_notification_id("task:456");

        assert_eq!(first, second);
        assert_ne!(first, 0);
        assert_ne!(first, different);
    }

    #[test]
    fn windows_toast_xml_escapes_text_and_can_silence_audio() {
        let xml = build_windows_toast_xml(
            "Task & <done> \"now\" 'ok'",
            Some("Body & <details>"),
            false,
        );

        assert!(xml.contains("Task &amp; &lt;done&gt; &quot;now&quot; &apos;ok&apos;"));
        assert!(xml.contains("Body &amp; &lt;details&gt;"));
        assert!(xml.contains("<audio silent=\"true\" />"));
    }

    #[test]
    fn windows_toast_xml_omits_empty_optional_nodes() {
        let xml = build_windows_toast_xml("Task complete", None, true);

        assert!(xml.contains("<text>Task complete</text>"));
        assert!(!xml.contains("<audio"));
        assert_eq!(xml.matches("<text>").count(), 1);
    }
}
