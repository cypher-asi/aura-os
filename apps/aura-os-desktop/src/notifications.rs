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
    use std::sync::atomic::{AtomicPtr, Ordering};
    use std::sync::Once;

    use objc::declare::ClassDecl;
    use objc::runtime::{Object, Sel, BOOL, YES};
    use objc::{class, msg_send, sel, sel_impl};

    use crate::events::NativeNotificationPayload;

    const NS_UTF8_STRING_ENCODING: usize = 4;
    static NOTIFICATION_DELEGATE_INIT: Once = Once::new();
    static NOTIFICATION_DELEGATE: AtomicPtr<Object> = AtomicPtr::new(std::ptr::null_mut());

    unsafe extern "C" {
        static NSUserNotificationDefaultSoundName: *mut Object;
    }

    pub(super) fn show_native_notification(
        payload: &NativeNotificationPayload,
    ) -> Result<(), String> {
        if payload.title.trim().is_empty() {
            return Err("notification title cannot be empty".to_string());
        }

        unsafe {
            let pool = AutoReleasePool::new();
            let notification: *mut Object = msg_send![class!(NSUserNotification), new];
            if notification.is_null() {
                return Err("failed to allocate NSUserNotification".to_string());
            }

            let identifier = ns_string(&payload.id);
            let title = ns_string(payload.title.trim());
            let body = payload
                .body
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|body| ns_string(body));

            let _: () = msg_send![notification, setIdentifier: identifier.as_ptr()];
            let _: () = msg_send![notification, setTitle: title.as_ptr()];
            if let Some(body) = body.as_ref() {
                let _: () = msg_send![notification, setInformativeText: body.as_ptr()];
            }
            if payload.sound {
                let _: () = msg_send![
                    notification,
                    setSoundName: NSUserNotificationDefaultSoundName
                ];
            }

            let center: *mut Object = msg_send![
                class!(NSUserNotificationCenter),
                defaultUserNotificationCenter
            ];
            if center.is_null() {
                let _: () = msg_send![notification, release];
                return Err("failed to get NSUserNotificationCenter".to_string());
            }

            install_notification_delegate(center);

            let _: () = msg_send![center, deliverNotification: notification];
            let _: () = msg_send![notification, release];

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
                    sel!(userNotificationCenter:shouldPresentNotification:),
                    should_present_notification
                        as extern "C" fn(&Object, Sel, *mut Object, *mut Object) -> BOOL,
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

    extern "C" fn should_present_notification(
        _this: &Object,
        _cmd: Sel,
        _center: *mut Object,
        _notification: *mut Object,
    ) -> BOOL {
        YES
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
}
