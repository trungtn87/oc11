package com.oc11.purchase;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class ApiClient {
    private ApiClient() {}

    public static String normalizeBaseUrl(String value) {
        String v = value == null ? "" : value.trim();
        while (v.endsWith("/")) v = v.substring(0, v.length() - 1);
        return v;
    }

    public static JSONObject getObject(String baseUrl, String path) throws Exception {
        return new JSONObject(request("GET", baseUrl, path, null));
    }

    public static JSONArray getArray(String baseUrl, String path) throws Exception {
        return new JSONArray(request("GET", baseUrl, path, null));
    }

    public static JSONObject postObject(String baseUrl, String path, JSONObject body) throws Exception {
        return new JSONObject(request("POST", baseUrl, path, body == null ? null : body.toString()));
    }

    private static String request(String method, String baseUrl, String path, String body) throws Exception {
        URL url = new URL(normalizeBaseUrl(baseUrl) + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(6000);
        conn.setReadTimeout(12000);
        conn.setRequestProperty("Accept", "application/json");
        if (body != null) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }

        int code = conn.getResponseCode();
        InputStream stream = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
        String text = readAll(stream);
        conn.disconnect();

        if (code < 200 || code >= 300) {
            String detail = text;
            try {
                JSONObject error = new JSONObject(text);
                detail = error.optString("detail", text);
            } catch (Exception ignored) {}
            throw new Exception("HTTP " + code + ": " + detail);
        }
        return text;
    }

    private static String readAll(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder out = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) out.append(line);
        }
        return out.toString();
    }
}
