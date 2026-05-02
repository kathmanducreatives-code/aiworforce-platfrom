#include "supabase.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Arduino.h>

SemaphoreHandle_t httpMutex = NULL;

void supabase_init() {
  httpMutex = xSemaphoreCreateMutex();
}

bool supabase_upload_image(const uint8_t *buf, size_t len,
                           const char *storagePath,
                           char *urlOut, size_t urlLen) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[SB-IMG] WiFi not connected — skipping upload");
    return false;
  }

  // Serialise: only one TLS session at a time (30 s wait max)
  if (xSemaphoreTake(httpMutex, pdMS_TO_TICKS(30000)) != pdTRUE) {
    Serial.println("[SB-IMG] httpMutex timeout — skipping upload");
    return false;
  }

  WiFiClientSecure cli;
  cli.setInsecure();   // skip root CA verification (fine for embedded)
  HTTPClient http;

  // PUT binary JPEG directly to Supabase Storage REST endpoint
  String url = String(SUPABASE_URL) + "/storage/v1/object/" +
               SUPABASE_BUCKET + "/" + storagePath;

  bool ok = false;
  if (http.begin(cli, url)) {
    http.setTimeout(25000);
    http.addHeader("Authorization", "Bearer " + String(SUPABASE_SERVICE_KEY));
    http.addHeader("Content-Type",  "image/jpeg");
    http.addHeader("x-upsert",      "true");   // overwrite if re-capturing same index

    int code = http.PUT((uint8_t *)buf, len);
    Serial.printf("[SB-IMG] PUT %s → HTTP %d  (%u bytes)\n", storagePath, code, len);

    if (code == 200 || code == 201) {
      // Construct the public URL for the Flutter app
      snprintf(urlOut, urlLen,
               "%s/storage/v1/object/public/%s/%s",
               SUPABASE_URL, SUPABASE_BUCKET, storagePath);
      ok = true;
    }
    http.end();
  }

  xSemaphoreGive(httpMutex);
  return ok;
}

bool supabase_log(const GpsSnapshot &gps,
                  const char *sessionId,
                  const char *imageUrl,
                  const char *logType) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[SB-LOG] WiFi not connected — skipping log");
    return false;
  }

  if (xSemaphoreTake(httpMutex, pdMS_TO_TICKS(15000)) != pdTRUE) {
    Serial.println("[SB-LOG] httpMutex timeout — skipping log");
    return false;
  }

  WiFiClientSecure cli;
  cli.setInsecure();
  HTTPClient http;

  String url = String(SUPABASE_URL) + "/rest/v1/" + SUPABASE_TABLE;
  bool ok = false;

  if (http.begin(cli, url)) {
    http.setTimeout(12000);
    http.addHeader("apikey",        SUPABASE_ANON_KEY);
    http.addHeader("Authorization", "Bearer " + String(SUPABASE_SERVICE_KEY));
    http.addHeader("Content-Type",  "application/json");
    http.addHeader("Prefer",        "return=minimal");

    // Build JSON payload matching drone_logs schema
    StaticJsonDocument<512> doc;
    doc["session_id"] = sessionId;
    doc["lat"]        = serialized(String(gps.lat, 7));
    doc["lng"]        = serialized(String(gps.lng, 7));
    doc["altitude_m"] = gps.alt_m;
    doc["hdop"]       = gps.hdop;
    doc["gps_valid"]  = gps.valid;
    doc["image_url"]  = imageUrl ? imageUrl : "";
    doc["device_id"]  = DEVICE_ID;
    doc["log_type"]   = logType;

    String body;
    serializeJson(doc, body);

    int code = http.POST(body);
    Serial.printf("[SB-LOG] POST drone_logs (%s) → HTTP %d\n", logType, code);
    ok = (code == 201 || code == 200);
    http.end();
  }

  xSemaphoreGive(httpMutex);
  return ok;
}
