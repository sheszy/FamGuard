package com.famguard.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FloatingLauncher")
public class FloatingLauncherPlugin extends Plugin {
    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasOverlayPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (hasOverlayPermission()) {
            resolvePermission(call);
            return;
        }
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + getContext().getPackageName())
        );
        startActivityForResult(call, intent, "overlayPermissionResult");
    }

    @ActivityCallback
    private void overlayPermissionResult(PluginCall call, ActivityResult result) {
        if (call != null) resolvePermission(call);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (enabled && !hasOverlayPermission()) {
            call.reject("FamGuard needs Display over other apps permission before the floating launcher can run.");
            return;
        }

        getContext().getSharedPreferences(FloatingOverlayService.PREFS, 0)
            .edit()
            .putBoolean(FloatingOverlayService.PREF_ENABLED, enabled)
            .apply();
        Intent intent = new Intent(getContext(), FloatingOverlayService.class);
        if (enabled) {
            ContextCompat.startForegroundService(getContext(), intent);
        } else {
            getContext().stopService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void setMode(PluginCall call) {
        String mode = call.getString("mode", "drawer");
        if (!"grid".equals(mode)) mode = "drawer";
        getContext().getSharedPreferences(FloatingOverlayService.PREFS, 0)
            .edit()
            .putString(FloatingOverlayService.PREF_MODE, mode)
            .apply();
        Intent intent = new Intent(getContext(), FloatingOverlayService.class);
        intent.setAction(FloatingOverlayService.ACTION_UPDATE_MODE);
        if (getContext().getSharedPreferences(FloatingOverlayService.PREFS, 0)
            .getBoolean(FloatingOverlayService.PREF_ENABLED, false)) {
            ContextCompat.startForegroundService(getContext(), intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void getPendingFeature(PluginCall call) {
        String feature = getContext().getSharedPreferences(FloatingOverlayService.PREFS, 0)
            .getString(FloatingOverlayService.PREF_PENDING_FEATURE, "");
        getContext().getSharedPreferences(FloatingOverlayService.PREFS, 0)
            .edit()
            .remove(FloatingOverlayService.PREF_PENDING_FEATURE)
            .apply();
        JSObject result = new JSObject();
        result.put("feature", feature);
        call.resolve(result);
    }

    private boolean hasOverlayPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext());
    }

    private void resolvePermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasOverlayPermission());
        call.resolve(result);
    }
}
