package com.oc11.purchase;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public final class LocalStore extends SQLiteOpenHelper {
    private static final String DB_NAME = "oc11_mobile.db";
    private static final int DB_VERSION = 1;

    public static final class PendingReceipt {
        public final long id;
        public final String payload;
        public final String createdAt;
        public final int synced;
        public final String serverCode;
        public final String error;

        PendingReceipt(long id, String payload, String createdAt, int synced, String serverCode, String error) {
            this.id = id;
            this.payload = payload;
            this.createdAt = createdAt;
            this.synced = synced;
            this.serverCode = serverCode;
            this.error = error;
        }
    }

    public LocalStore(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE cache (cache_key TEXT PRIMARY KEY, json_value TEXT NOT NULL, updated_at TEXT)");
        db.execSQL("CREATE TABLE receipts (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "payload TEXT NOT NULL," +
                "created_at TEXT NOT NULL," +
                "synced INTEGER NOT NULL DEFAULT 0," +
                "server_code TEXT," +
                "error TEXT)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}

    public void putCache(String key, String json, String updatedAt) {
        ContentValues values = new ContentValues();
        values.put("cache_key", key);
        values.put("json_value", json);
        values.put("updated_at", updatedAt);
        getWritableDatabase().insertWithOnConflict("cache", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public String getCache(String key) {
        try (Cursor c = getReadableDatabase().query(
                "cache", new String[]{"json_value"}, "cache_key=?", new String[]{key},
                null, null, null)) {
            return c.moveToFirst() ? c.getString(0) : "[]";
        }
    }

    public String getCacheUpdatedAt(String key) {
        try (Cursor c = getReadableDatabase().query(
                "cache", new String[]{"updated_at"}, "cache_key=?", new String[]{key},
                null, null, null)) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }

    public long saveReceipt(JSONObject payload, String createdAt) {
        ContentValues values = new ContentValues();
        values.put("payload", payload.toString());
        values.put("created_at", createdAt);
        values.put("synced", 0);
        return getWritableDatabase().insertOrThrow("receipts", null, values);
    }

    public void updateReceipt(long id, JSONObject payload) {
        ContentValues values = new ContentValues();
        values.put("payload", payload.toString());
        values.put("error", (String) null);
        getWritableDatabase().update("receipts", values, "id=? AND synced=0", new String[]{String.valueOf(id)});
    }

    public void deleteUnsynced(long id) {
        getWritableDatabase().delete("receipts", "id=? AND synced=0", new String[]{String.valueOf(id)});
    }

    public List<PendingReceipt> listReceipts() {
        List<PendingReceipt> result = new ArrayList<>();
        try (Cursor c = getReadableDatabase().query(
                "receipts",
                new String[]{"id", "payload", "created_at", "synced", "server_code", "error"},
                null, null, null, null, "id DESC")) {
            while (c.moveToNext()) {
                result.add(new PendingReceipt(
                        c.getLong(0), c.getString(1), c.getString(2), c.getInt(3),
                        c.isNull(4) ? null : c.getString(4),
                        c.isNull(5) ? null : c.getString(5)
                ));
            }
        }
        return result;
    }

    public List<PendingReceipt> listUnsynced() {
        List<PendingReceipt> result = new ArrayList<>();
        try (Cursor c = getReadableDatabase().query(
                "receipts",
                new String[]{"id", "payload", "created_at", "synced", "server_code", "error"},
                "synced=0", null, null, null, "id ASC")) {
            while (c.moveToNext()) {
                result.add(new PendingReceipt(
                        c.getLong(0), c.getString(1), c.getString(2), c.getInt(3),
                        c.isNull(4) ? null : c.getString(4),
                        c.isNull(5) ? null : c.getString(5)
                ));
            }
        }
        return result;
    }

    public void markSynced(long id, String serverCode) {
        ContentValues values = new ContentValues();
        values.put("synced", 1);
        values.put("server_code", serverCode);
        values.putNull("error");
        getWritableDatabase().update("receipts", values, "id=?", new String[]{String.valueOf(id)});
    }

    public void markError(long id, String error) {
        ContentValues values = new ContentValues();
        values.put("error", error);
        getWritableDatabase().update("receipts", values, "id=?", new String[]{String.valueOf(id)});
    }

    public int pendingCount() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM receipts WHERE synced=0", null)) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }

    public static JSONArray asArray(String json) {
        try { return new JSONArray(json); } catch (Exception ignored) { return new JSONArray(); }
    }
}
