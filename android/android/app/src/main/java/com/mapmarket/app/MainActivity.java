package com.mapmarket.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    static final String BASE = "https://pcalifax-byte.github.io/geohogar/";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView wv = getBridge().getWebView();
        WebSettings ws = wv.getSettings();
        ws.setDomStorageEnabled(true);          // localStorage / sesión de Supabase
        ws.setDatabaseEnabled(true);
        ws.setGeolocationEnabled(true);
        ws.setJavaScriptEnabled(true);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 7);
        }
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                super.onReceivedError(view, req, err);
                if (req != null && req.isForMainFrame()) view.loadUrl("file:///android_asset/offline.html");   // pantalla sin conexión
            }
        });
        openDeepLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openDeepLink(intent);
    }

    /** Abre dentro de la app los enlaces de correo (confirmar.html?code=…, #access_token=…) y mapmarket://ruta */
    private void openDeepLink(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        Uri u = intent.getData();
        String url = u.toString();
        if ("mapmarket".equals(u.getScheme())) {
            String path = (u.getHost() == null ? "" : u.getHost()) + (u.getEncodedPath() == null ? "" : u.getEncodedPath());
            url = BASE + path + (u.getEncodedQuery() != null ? "?" + u.getEncodedQuery() : "") + (u.getEncodedFragment() != null ? "#" + u.getEncodedFragment() : "");
        }
        if (!url.startsWith(BASE)) return;
        final String target = url;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(target));
    }
}
