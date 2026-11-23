package com.famguard.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

public class FloatingOverlayService extends Service {
    static final String PREFS = "famguard_floating_launcher";
    static final String PREF_ENABLED = "enabled";
    static final String PREF_MODE = "mode";
    static final String PREF_PENDING_FEATURE = "pending_feature";
    static final String ACTION_UPDATE_MODE = "com.famguard.app.UPDATE_FLOATING_MODE";
    private static final String CHANNEL_ID = "famguard_floating_launcher";
    private static final int NOTIFICATION_ID = 6104;
    private static final int COLOR_DARK = Color.rgb(100, 29, 55);
    private static final int COLOR_ACCENT = Color.rgb(185, 75, 100);
    private static final String[][] FEATURES = {
        {"Home", "H", "home"},
        {"Locations", "L", "location"},
        {"Calendar", "C", "calendar"},
        {"Fam-Dash", "F", "famdash"},
        {"Community", "M", "community"},
        {"Settings", "S", "settings"},
        {"SOS", "!", "sos"},
        {"Add event", "+", "add-event"},
        {"Tasks", "T", "tasks"}
    };

    private WindowManager windowManager;
    private WindowManager.LayoutParams layoutParams;
    private LinearLayout launcher;
    private LinearLayout actionsPanel;
    private TextView bubble;
    private boolean expanded;
    private boolean snappedLeft;
    private String mode = "drawer";

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(PREF_ENABLED, false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        mode = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_MODE, "drawer");
        if (launcher == null) {
            showLauncher();
        } else if (ACTION_UPDATE_MODE.equals(intent == null ? null : intent.getAction())) {
            mode = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_MODE, "drawer");
            expanded = false;
            buildActionsPanel();
            updateLauncherSize();
        }
        return START_STICKY;
    }

    private void showLauncher() {
        launcher = new LinearLayout(this);
        launcher.setOrientation(LinearLayout.HORIZONTAL);
        launcher.setGravity(Gravity.CENTER_VERTICAL);
        launcher.setPadding(dp(3), dp(3), dp(3), dp(3));
        bubble = new TextView(this);
        bubble.setText("FG");
        bubble.setTextColor(Color.WHITE);
        bubble.setTextSize(13);
        bubble.setGravity(Gravity.CENTER);
        bubble.setBackground(circle(COLOR_DARK));
        LinearLayout.LayoutParams bubbleParams = new LinearLayout.LayoutParams(dp(54), dp(54));
        launcher.addView(bubble, bubbleParams);
        actionsPanel = new LinearLayout(this);
        actionsPanel.setOrientation(LinearLayout.VERTICAL);
        launcher.addView(actionsPanel, new LinearLayout.LayoutParams(dp(220), -2));
        buildActionsPanel();

        layoutParams = new WindowManager.LayoutParams(
            dp(62),
            dp(62),
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        layoutParams.gravity = Gravity.TOP | Gravity.LEFT;
        layoutParams.x = displayWidth() - dp(62);
        layoutParams.y = dp(180);
        snappedLeft = false;
        bubble.setOnTouchListener(createDragListener());
        windowManager.addView(launcher, layoutParams);
    }

    private void buildActionsPanel() {
        actionsPanel.removeAllViews();
        actionsPanel.setVisibility(expanded ? View.VISIBLE : View.GONE);
        actionsPanel.setPadding(dp(8), dp(8), dp(8), dp(8));
        actionsPanel.setBackground(rounded(Color.WHITE, dp(12)));
        if ("grid".equals(mode)) {
            GridLayout grid = new GridLayout(this);
            grid.setColumnCount(3);
            for (String[] feature : FEATURES) {
                Button button = actionButton(feature);
                GridLayout.LayoutParams params = new GridLayout.LayoutParams();
                params.width = dp(74);
                params.height = dp(66);
                params.setMargins(dp(1), dp(1), dp(1), dp(1));
                grid.addView(button, params);
            }
            actionsPanel.addView(grid);
        } else {
            ScrollView scroll = new ScrollView(this);
            LinearLayout list = new LinearLayout(this);
            list.setOrientation(LinearLayout.VERTICAL);
            for (String[] feature : FEATURES) list.addView(actionButton(feature));
            scroll.addView(list);
            actionsPanel.addView(scroll, new LinearLayout.LayoutParams(dp(204), dp(360)));
        }
    }

    private Button actionButton(String[] feature) {
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(feature[1] + "   " + feature[0]);
        button.setTextSize(11);
        button.setTextColor(COLOR_DARK);
        button.setBackground(rounded(Color.WHITE, dp(7)));
        button.setOnClickListener(view -> openFeature(feature[2]));
        return button;
    }

    private View.OnTouchListener createDragListener() {
        return new View.OnTouchListener() {
            private float downX;
            private float downY;
            private int startX;
            private int startY;
            private boolean moved;

            @Override
            public boolean onTouch(View view, MotionEvent event) {
                if (event.getAction() == MotionEvent.ACTION_DOWN) {
                    downX = event.getRawX();
                    downY = event.getRawY();
                    startX = layoutParams.x;
                    startY = layoutParams.y;
                    moved = false;
                    return true;
                }
                if (event.getAction() == MotionEvent.ACTION_MOVE) {
                    int dx = (int) (event.getRawX() - downX);
                    int dy = (int) (event.getRawY() - downY);
                    if (Math.abs(dx) + Math.abs(dy) > dp(8)) {
                        moved = true;
                        if (expanded) {
                            expanded = false;
                            buildActionsPanel();
                            updateLauncherSize();
                        }
                        layoutParams.x = Math.max(0, Math.min(displayWidth() - dp(62), startX + dx));
                        layoutParams.y = Math.max(dp(8), Math.min(displayHeight() - dp(62), startY + dy));
                        windowManager.updateViewLayout(launcher, layoutParams);
                    }
                    return true;
                }
                if (event.getAction() == MotionEvent.ACTION_UP) {
                    if (moved) {
                        snappedLeft = layoutParams.x < displayWidth() / 2;
                        layoutParams.x = snappedLeft ? 0 : displayWidth() - dp(62);
                        windowManager.updateViewLayout(launcher, layoutParams);
                    } else {
                        expanded = !expanded;
                        buildActionsPanel();
                        updateLauncherSize();
                    }
                    return true;
                }
                return true;
            }
        };
    }

    private void updateLauncherSize() {
        if (layoutParams == null || launcher == null) return;
        boolean bubbleOnRight = !snappedLeft;
        if (launcher.getChildCount() == 2) {
            if (bubbleOnRight) {
                launcher.removeView(bubble);
                launcher.addView(bubble);
            } else {
                launcher.removeView(actionsPanel);
                launcher.addView(actionsPanel);
            }
        }
        layoutParams.width = expanded ? dp(288) : dp(62);
        layoutParams.height = WindowManager.LayoutParams.WRAP_CONTENT;
        layoutParams.x = expanded && bubbleOnRight ? displayWidth() - dp(288) : bubbleOnRight ? displayWidth() - dp(62) : 0;
        windowManager.updateViewLayout(launcher, layoutParams);
    }

    private void openFeature(String feature) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_PENDING_FEATURE, feature).apply();
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        expanded = false;
        buildActionsPanel();
        updateLauncherSize();
    }

    private Notification buildNotification() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("FamGuard floating launcher")
            .setContentText("Tap the FamGuard bubble to open quick actions.")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Floating launcher", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Keeps the user-enabled FamGuard overlay launcher available.");
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(channel);
    }

    private GradientDrawable circle(int color) {
        return rounded(color, dp(30));
    }

    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    private int displayWidth() {
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getMetrics(metrics);
        return metrics.widthPixels;
    }

    private int displayHeight() {
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getMetrics(metrics);
        return metrics.heightPixels;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    @Override
    public void onDestroy() {
        if (launcher != null && windowManager != null) {
            try {
                windowManager.removeView(launcher);
            } catch (IllegalArgumentException ignored) {
            }
        }
        launcher = null;
        stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    public static void ensureRunning(Context context) {
        Intent intent = new Intent(context, FloatingOverlayService.class);
        ContextCompat.startForegroundService(context, intent);
    }
}
