# Android push notifications

Aura's Android client registers its Firebase Cloud Messaging token with the
authenticated control plane. The server keeps registrations account-scoped and
sends completion, failure, retry, loop-ending, push-stuck, and approval alerts.
Tapping an alert opens the exact project agent and session when those identifiers
are present.

## Required release configuration

1. Place the Android Firebase client file at
   `interface/android/app/google-services.json` before `npx cap sync android` and
   the Gradle release build. The file must define the `tech.zero.aura` package.
2. Enable the Firebase Cloud Messaging API for that Firebase/Google Cloud
   project.
3. Configure the control-plane server with one of:
   - `AURA_FIREBASE_SERVICE_ACCOUNT_JSON`: the complete service-account JSON.
   - `AURA_FIREBASE_SERVICE_ACCOUNT_PATH`: an absolute path to that JSON.

Do not commit either credential. If the Android client file is absent, the app
detects that state and skips Firebase registration instead of crashing. If the
server credential is absent, device registration remains available but delivery
is disabled and the server logs that state at startup.

## Verification

After building and installing the APK, confirm the notification permission and
channel, then test a warm and cold notification tap. An intent equivalent to the
FCM tap payload can be sent with:

```sh
adb shell am start -n tech.zero.aura/.MainActivity \
  --es google.message_id notification-test \
  --es route '/projects/PROJECT_ID/agents/INSTANCE_ID?session=SESSION_ID'
```

The WebView URL should become the supplied internal route. External and
protocol-relative routes are rejected by the client.
