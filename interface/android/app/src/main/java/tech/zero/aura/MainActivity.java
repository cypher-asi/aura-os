package tech.zero.aura;

import android.os.Bundle;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuraPushConfigPlugin.class);
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() != null) {
                    // React Router uses the History API, which does not make
                    // WebView.canGoBack() true for same-document navigation.
                    // Read its history index and pop the SPA route before
                    // falling through to Android's normal activity back.
                    getBridge().getWebView().evaluateJavascript(
                        "Boolean(window.history.state && window.history.state.idx > 0)",
                        canGoBack -> {
                            if ("true".equals(canGoBack)) {
                                getBridge().getWebView().evaluateJavascript("window.history.back()", null);
                                return;
                            }

                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                        }
                    );
                    return;
                }

                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });
    }
}
