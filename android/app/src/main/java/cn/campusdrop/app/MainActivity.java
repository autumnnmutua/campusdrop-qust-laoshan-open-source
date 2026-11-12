/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-7120DA8ABA */
/* ref V00tREZFRTk0REM5MTM4NzdDRjozYzNhMmFmOThjMDgyZGY0OWQ2YjRlMjZiZGEyODZlYQ */
package cn.campusdrop.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * CampusDrop Android shell: one full-screen WebView showing the deployed site (the same pages, accounts and data as
 * the browser and the installed web app). Pages of the site stay inside the app; phone numbers, map apps and other
 * websites open in the system apps. Photo uploads use the system picker or camera; location is asked for only when a
 * page needs it (the courier's live position).
 */
public class MainActivity extends Activity {
    private static final int FILE_REQUEST = 41;
    private static final int LOCATION_REQUEST = 42;
    private static final String OFFLINE_PAGE = "file:///android_asset/offline.html";
    private static final String LAST_URL_STATE = "campusdrop.lastUrl";

    private WebView web;
    private Uri home;
    private ValueCallback<Uri[]> pendingFiles;
    private String pendingGeoOrigin;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String lastUrl;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        home = Uri.parse(getString(R.string.site_url));
        web = new WebView(this);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(web);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " CampusDropApp/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        web.setWebViewClient(new ShellClient());
        web.setWebChromeClient(new ShellChrome());

        if (savedInstanceState != null) {
            lastUrl = savedInstanceState.getString(LAST_URL_STATE);
            if (!online()) web.loadUrl(OFFLINE_PAGE);
            else if (web.restoreState(savedInstanceState) == null) web.loadUrl(lastUrl != null ? lastUrl : startUrl(getIntent()));
        } else {
            lastUrl = startUrl(getIntent());
            web.loadUrl(online() ? lastUrl : OFFLINE_PAGE);
        }
    }

    /** A link to the site (for example from a notification or a shared tracking link) opens on that page. */
    private String startUrl(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && isSite(data)) return data.toString();
        return home.toString();
    }

    private boolean isSite(Uri uri) {
        return "https".equals(uri.getScheme()) && home.getHost() != null && home.getHost().equalsIgnoreCase(uri.getHost());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent.getData();
        if (data != null && isSite(data)) {
            lastUrl = data.toString();
            web.loadUrl(online() ? lastUrl : OFFLINE_PAGE);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
        outState.putString(LAST_URL_STATE, lastUrl);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        String current = web.getUrl();
        if (web.canGoBack() && (current == null || !current.startsWith(OFFLINE_PAGE))) web.goBack();
        else super.onBackPressed();
    }

    private boolean online() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return true;
        @SuppressWarnings("deprecation") NetworkInfo info = cm.getActiveNetworkInfo();
        return info != null && info.isConnected();
    }

    /** Called by the offline page's "重试" button through a plain navigation to this URL. */
    private static final String RETRY_URL = "campusdrop://retry";

    private class ShellClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (RETRY_URL.equals(uri.toString())) {
                if (online()) view.loadUrl(lastUrl != null ? lastUrl : home.toString());
                return true;
            }
            if (isSite(uri)) {
                if (!online()) {
                    lastUrl = uri.toString();
                    view.loadUrl(OFFLINE_PAGE);
                    return true;
                }
                return false;
            }
            // Phone numbers, mail, map apps, WeChat / Alipay and every other website open outside the app.
            try {
                Intent intent = "intent".equals(uri.getScheme())
                        ? Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                        : new Intent(Intent.ACTION_VIEW, uri);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
                startActivity(intent);
            } catch (ActivityNotFoundException | java.net.URISyntaxException e) {
                Toast.makeText(MainActivity.this, R.string.no_app, Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            if (url != null && isSite(Uri.parse(url))) lastUrl = url;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            // Main-page network failures include DNS errors and service-worker failures as well as a disconnected device.
            if (request.isForMainFrame() && isSite(request.getUrl())) view.loadUrl(online() ? OFFLINE_PAGE + "#unreachable" : OFFLINE_PAGE);
        }
    }

    private class ShellChrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_REQUEST);
            } catch (ActivityNotFoundException e) {
                pendingFiles = null;
                Toast.makeText(MainActivity.this, R.string.no_app, Toast.LENGTH_SHORT).show();
                return false;
            }
            return true;
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (!isSite(Uri.parse(origin))) { callback.invoke(origin, false, false); return; }
            // Android 12+ can grant approximate location without granting fine location.
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                callback.invoke(origin, true, false);
                return;
            }
            pendingGeoOrigin = origin;
            pendingGeoCallback = callback;
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_REQUEST);
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            // The site never asks for camera or microphone streams (photos go through the file picker).
            request.deny();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_REQUEST && pendingFiles != null) {
            pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            pendingFiles = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == LOCATION_REQUEST && pendingGeoCallback != null) {
            boolean granted = false;
            for (int r : results) granted |= r == PackageManager.PERMISSION_GRANTED;
            pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }
}
