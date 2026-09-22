package tech.zero.aura;

import android.content.res.Resources;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AuraPushConfig")
public class AuraPushConfigPlugin extends Plugin {
    @PluginMethod
    public void isConfigured(PluginCall call) {
        Resources resources = getContext().getResources();
        String packageName = getContext().getPackageName();
        int resourceId = resources.getIdentifier("google_app_id", "string", packageName);

        boolean configured = false;
        if (resourceId != 0) {
            try {
                String appId = resources.getString(resourceId);
                configured = appId != null && !appId.trim().isEmpty();
            } catch (Resources.NotFoundException ignored) {
                // A malformed or partially generated Firebase resource set is
                // treated as unavailable so PushNotifications.register() does
                // not crash the host process.
            }
        }

        JSObject result = new JSObject();
        result.put("configured", configured);
        call.resolve(result);
    }
}
