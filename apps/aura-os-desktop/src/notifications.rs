use crate::events::NativeNotificationPayload;

#[cfg(target_os = "macos")]
pub(crate) fn show_native_notification(payload: &NativeNotificationPayload) -> Result<(), String> {
    macos::show_native_notification(payload)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn show_native_notification(payload: &NativeNotificationPayload) -> Result<(), String> {
    tracing::warn!(
        id = %payload.id,
        "native desktop notifications are not implemented on this platform yet"
    );
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn set_application_badge(count: Option<u32>) {
    macos::set_application_badge(count);
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_application_badge(_count: Option<u32>) {}

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

    pub(super) fn show_native_notification(
        payload: &NativeNotificationPayload,
    ) -> Result<(), String> {
        if payload.title.trim().is_empty() {
            return Err("notification title cannot be empty".to_string());
        }

        unsafe {
            let pool = AutoReleasePool::new();

            let center: *mut Object =
                msg_send![class!(UNUserNotificationCenter), currentNotificationCenter];
            if center.is_null() {
                return Err("failed to get UNUserNotificationCenter".to_string());
            }
            install_notification_delegate(center);

            let content: *mut Object = msg_send![class!(UNMutableNotificationContent), new];
            if content.is_null() {
                return Err("failed to allocate UNMutableNotificationContent".to_string());
            }

            let identifier = ns_string(&payload.id);
            let title = ns_string(payload.title.trim());
            let body = payload
                .body
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|body| ns_string(body));

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
