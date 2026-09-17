package com.shiju.vocabulary;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Set;


public class MainActivity extends Activity {
    private static final int REQUEST_OPEN_BACKUP = 4101;
    private static final int REQUEST_SAVE_BACKUP = 4102;
    private WebView webView;
    private TextView statusView;
    private TextToSpeech textToSpeech;
    private volatile String ttsStatus = "initializing";
    private volatile String ttsDetail = "正在连接系统语音引擎";
    private ValueCallback<Uri[]> backupFileCallback;
    private String pendingBackupJson;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        textToSpeech = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) refreshTtsStatus();
            else {
                ttsStatus = "missing";
                ttsDetail = "系统语音引擎初始化失败（代码 " + status + "）";
            }
        });

        statusView = new TextView(this);
        statusView.setText("正在准备本地词书…");
        statusView.setTextSize(17);
        statusView.setPadding(42, 80, 42, 42);
        setContentView(statusView);

        new Thread(() -> {
            try {
                File appRoot = new File(getFilesDir(), "shiju-static");
                copyAssetTree(getAssets(), "shiju", appRoot);
                File dataRoot = new File(getFilesDir(), "userdata");

                if (!Python.isStarted()) {
                    Python.start(new AndroidPlatform(this));
                }
                PyObject launcher = Python.getInstance().getModule("android_launcher");
                int port = launcher.callAttr("start_server", appRoot.getAbsolutePath(), dataRoot.getAbsolutePath()).toInt();
                runOnUiThread(() -> openApplication(port));
            } catch (Exception error) {
                runOnUiThread(() -> statusView.setText("拾句启动失败：\n\n" + error));
            }
        }, "shiju-startup").start();
    }

    private void openApplication(int port) {
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        // Required for reading a JSON document explicitly chosen with the system picker.
        settings.setAllowContentAccess(true);
        webView.addJavascriptInterface(new TtsBridge(), "ShijuTTS");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (backupFileCallback != null) backupFileCallback.onReceiveValue(null);
                backupFileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                try {
                    startActivityForResult(intent, REQUEST_OPEN_BACKUP);
                } catch (Exception error) {
                    backupFileCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });
        webView.addJavascriptInterface(new UiBridge(), "ShijuUI");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("127.0.0.1".equals(uri.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if ("127.0.0.1".equals(uri.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
        });
        setContentView(webView);
        webView.loadUrl("http://127.0.0.1:" + port + "/index.html");
    }

    private synchronized void refreshTtsStatus() {
        if (textToSpeech == null) return;
        try {
            Locale[] candidates = {Locale.US, Locale.UK, Locale.ENGLISH};
            for (Locale locale : candidates) {
                int available = textToSpeech.isLanguageAvailable(locale);
                if (available < TextToSpeech.LANG_AVAILABLE) continue;
                int selected = textToSpeech.setLanguage(locale);
                if (selected < TextToSpeech.LANG_AVAILABLE) continue;

                Voice selectedVoice = chooseOfflineEnglishVoice(textToSpeech.getVoices(), locale);
                if (selectedVoice != null) textToSpeech.setVoice(selectedVoice);
                textToSpeech.setPitch(1.0f);
                textToSpeech.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
                Voice activeVoice = textToSpeech.getVoice();
                ttsStatus = "ready";
                ttsDetail = activeVoice == null
                    ? "系统英语语音（" + locale.toLanguageTag() + "）"
                    : "系统英语语音 · " + activeVoice.getName() + " · 质量 " + activeVoice.getQuality();
                return;
            }
            ttsStatus = "missing";
            ttsDetail = "当前语音引擎没有可用的英语语音数据";
        } catch (Exception error) {
            ttsStatus = "missing";
            ttsDetail = "读取系统语音引擎失败：" + error.getClass().getSimpleName();
        }
    }

    private Voice chooseOfflineEnglishVoice(Set<Voice> voices, Locale preferredLocale) {
        if (voices == null) return null;
        Voice best = null;
        for (Voice voice : voices) {
            Locale locale = voice.getLocale();
            if (locale == null || !"en".equalsIgnoreCase(locale.getLanguage()) || voice.isNetworkConnectionRequired()) continue;
            if (best == null || isBetterVoice(voice, best, preferredLocale)) best = voice;
        }
        return best;
    }

    private boolean isBetterVoice(Voice candidate, Voice current, Locale preferredLocale) {
        if (candidate.getQuality() != current.getQuality()) {
            return candidate.getQuality() > current.getQuality();
        }
        boolean candidateCountry = preferredLocale.getCountry().equalsIgnoreCase(candidate.getLocale().getCountry());
        boolean currentCountry = preferredLocale.getCountry().equalsIgnoreCase(current.getLocale().getCountry());
        if (candidateCountry != currentCountry) return candidateCountry;
        return candidate.getLatency() < current.getLatency();
    }

    private final class TtsBridge {
        @JavascriptInterface
        public String status() {
            return ttsStatus;
        }

        @JavascriptInterface
        public String detail() {
            return ttsDetail;
        }

        @JavascriptInterface
        public boolean speak(String text, double rate) {
            if (!"ready".equals(ttsStatus) || textToSpeech == null || text == null || text.trim().isEmpty()) {
                return false;
            }
            float safeRate = (float) Math.max(0.45, Math.min(1.0, rate));
            try {
                textToSpeech.setSpeechRate(safeRate);
                int result = textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "shiju-" + System.nanoTime());
                if (result == TextToSpeech.SUCCESS) return true;
                ttsDetail = "系统语音引擎拒绝了朗读请求";
            } catch (Exception error) {
                ttsDetail = "调用系统语音引擎失败：" + error.getClass().getSimpleName();
            }
            return false;
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(() -> {
                if (textToSpeech != null) textToSpeech.stop();
            });
        }

        @JavascriptInterface
        public void installVoiceData() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA));
                } catch (Exception ignored) {
                    startActivity(new Intent(Settings.ACTION_SETTINGS));
                }
            });
        }
    }

    private final class UiBridge {
        @JavascriptInterface
        public void exportBackup(String json, String filename) {
            if (json == null || json.isEmpty()) return;
            pendingBackupJson = json;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, filename == null || filename.isEmpty() ? "shiju-backup.json" : filename);
                try {
                    startActivityForResult(intent, REQUEST_SAVE_BACKUP);
                } catch (Exception error) {
                    pendingBackupJson = null;
                }
            });
        }

        @JavascriptInterface
        public void showKeyboard() {
            runOnUiThread(() -> {
                if (webView == null) return;
                webView.requestFocus(View.FOCUS_DOWN);
                webView.postDelayed(() -> {
                    InputMethodManager keyboard = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                    if (keyboard != null) keyboard.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
                }, 80);
            });
        }

        @JavascriptInterface
        public void hideKeyboard() {
            runOnUiThread(() -> {
                if (webView == null) return;
                InputMethodManager keyboard = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                if (keyboard != null) keyboard.hideSoftInputFromWindow(webView.getWindowToken(), 0);
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_OPEN_BACKUP) {
            ValueCallback<Uri[]> callback = backupFileCallback;
            backupFileCallback = null;
            if (callback == null) return;
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            callback.onReceiveValue(uri == null ? null : new Uri[]{uri});
            return;
        }
        if (requestCode == REQUEST_SAVE_BACKUP) {
            String json = pendingBackupJson;
            pendingBackupJson = null;
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (uri == null || json == null) return;
            try (OutputStream output = getContentResolver().openOutputStream(uri, "w")) {
                if (output != null) output.write(json.getBytes(StandardCharsets.UTF_8));
            } catch (IOException ignored) {
            }
        }
    }

    private static void copyAssetTree(AssetManager assets, String assetPath, File destination) throws IOException {
        String[] children = assets.list(assetPath);
        if (children != null && children.length > 0) {
            if (!destination.exists() && !destination.mkdirs()) {
                throw new IOException("Cannot create " + destination);
            }
            for (String child : children) {
                copyAssetTree(assets, assetPath + "/" + child, new File(destination, child));
            }
            return;
        }

        File parent = destination.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Cannot create " + parent);
        }
        try (InputStream input = assets.open(assetPath); OutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[65536];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript("Boolean(window.ShijuHandleBack && window.ShijuHandleBack())", result -> {
            if ("true".equals(result)) return;
            if (webView != null && webView.canGoBack()) webView.goBack();
            else MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onPause() {
        if (textToSpeech != null) textToSpeech.stop();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (textToSpeech != null && !"initializing".equals(ttsStatus)) refreshTtsStatus();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }
        if (isFinishing() && Python.isStarted()) {
            try {
                Python.getInstance().getModule("android_launcher").callAttr("stop_server");
            } catch (Exception ignored) {
            }
        }
        super.onDestroy();
    }
}
