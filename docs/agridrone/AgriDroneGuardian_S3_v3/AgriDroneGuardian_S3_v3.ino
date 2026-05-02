// ============================================================
//  AgriDrone Guardian | ESP32-S3 Dev Module | v3.0
// ============================================================
//  Core 0: WiFi + httpd web server (MJPEG, /status, /capture)
//  Core 1: GPS parsing via TinyGPS++ on Serial1
//
//  HARDWARE:
//    Camera  : OV5640 5MP — see config.h for pin assignments
//    GPS     : NEO-6M/M8N — GPIO17(TX→GPS RX), GPIO18(RX←GPS TX)
//    Power   : 5A USB-C
//
//  BEFORE FLASHING:
//    1. Set WIFI_SSID / WIFI_PASSWORD in config.h
//    2. Adjust camera pins if your wiring differs from config.h defaults
//    3. Run docs/agridrone/supabase_schema_v2.sql in Supabase SQL Editor
//
//  REQUIRED LIBRARIES (Arduino Library Manager):
//    - TinyGPSPlus by Mikal Hart   (v1.0.3)
//    - ArduinoJson by Benoit Blanchon (v7.x)
// ============================================================

#include "config.h"
#include "camera.h"
#include "session.h"
#include "gps_task.h"
#include "supabase.h"
#include "webserver.h"

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "esp_task_wdt.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static TaskHandle_t _gpsTaskHandle = NULL;

// ── WiFi connection ───────────────────────────────────────────
static void connectWiFi() {
  Serial.printf("[WiFi] Connecting to \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  for (int t = 0; t < 40 && WiFi.status() != WL_CONNECTED; t++) {
    delay(500);
    Serial.print(".");
    esp_task_wdt_reset();
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n[WiFi] FAILED — rebooting in 5 s");
    delay(5000);
    ESP.restart();
  }

  Serial.printf("\n[WiFi] %s  RSSI: %d dBm\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
}

// ── FastAPI device self-registration ─────────────────────────
static void registerDevice() {
  WiFiClientSecure cli;
  cli.setInsecure();
  HTTPClient http;
  String url = String(FASTAPI_BASE_URL) + "/v1/devices/register";
  if (!http.begin(cli, url)) return;
  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"device_id\":\"" + String(DEVICE_ID) +
                "\",\"ip\":\"" + WiFi.localIP().toString() + "\"}";
  int code = http.POST(body);
  http.end();
  Serial.printf("[API] Device registered → HTTP %d\n", code);
}

// ── setup() — runs on Core 0 ──────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("\n╔══════════════════════════════════════════╗");
  Serial.println("║  AgriDrone Guardian | ESP32-S3 v3.0      ║");
  Serial.println("╚══════════════════════════════════════════╝");

  // ── Watchdog: reboot if any task hangs for WDT_TIMEOUT_SEC ─
  // Arduino core 3.x / ESP-IDF 5.x API (struct-based):
  esp_task_wdt_config_t wdtCfg = {
    .timeout_ms     = WDT_TIMEOUT_SEC * 1000U,
    .idle_core_mask = (1 << 0) | (1 << 1),   // watch idle tasks on both cores
    .trigger_panic  = true                    // hard reset on timeout
  };
  esp_task_wdt_reconfigure(&wdtCfg);
  esp_task_wdt_add(NULL);   // add this task (setup/loop) to the watchdog

  // ── Initialise all mutexes BEFORE any task accesses them ───
  session_init();    // creates sessionMutex
  gps_init();        // creates gpsMutex + starts Serial1
  supabase_init();   // creates httpMutex

  // ── WiFi must come up before camera and server ─────────────
  connectWiFi();
  esp_task_wdt_reset();

  // ── Camera ─────────────────────────────────────────────────
  if (!camera_init()) {
    Serial.println("[BOOT] ✗ Camera init FAILED");
    Serial.println("[BOOT]   Check wiring — see camera pins in config.h");
    Serial.println("[BOOT]   Halting. WDT will reboot in 30 s.");
    while (true) {
      esp_task_wdt_reset();
      delay(1000);
    }
  }
  esp_task_wdt_reset();

  // ── HTTP server (all 6 routes registered inside) ───────────
  webserver_start();

  // ── FastAPI self-registration (best-effort, non-blocking) ──
  registerDevice();
  esp_task_wdt_reset();

  // ── GPS task on Core 1 (after gps_init() creates mutex) ────
  xTaskCreatePinnedToCore(
    gps_task,          // function defined in gps_task.cpp
    "GPS",             // task name (visible in FreeRTOS debug)
    8192,              // stack bytes — GPS parser + no TLS = 8 KB is plenty
    NULL,              // task parameter (unused)
    2,                 // priority: above idle(0), below httpd(5)
    &_gpsTaskHandle,
    1                  // Core 1
  );

  Serial.println("[BOOT] ✓ All systems go");
  Serial.printf("[BOOT] Open → http://%s/\n", WiFi.localIP().toString().c_str());
}

// ── loop() — Core 0 ───────────────────────────────────────────
// The httpd server runs in its OWN FreeRTOS task (also on Core 0).
// loop() handles WiFi keepalive and periodic GPS position logging.
void loop() {
  esp_task_wdt_reset();

  // ── WiFi reconnect guard ────────────────────────────────────
  static unsigned long lastWifiCheck = 0;
  if (millis() - lastWifiCheck > WIFI_CHECK_MS) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Lost — reconnecting...");
      WiFi.disconnect();
      delay(500);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      for (int t = 0; t < 30 && WiFi.status() != WL_CONNECTED; t++) {
        delay(500);
        esp_task_wdt_reset();
      }
      if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("[WiFi] Reconnected → %s\n",
                      WiFi.localIP().toString().c_str());
        registerDevice();
      }
    }
  }

  // ── Periodic GPS position log to Supabase ──────────────────
  // Runs every GPS_LOG_INTERVAL_MS during an active session.
  // Gives the Flutter map a continuous coordinate track between snapshots.
  // Only logs when GPS has a valid fix to avoid polluting the table.
  static unsigned long lastGpsLog = 0;
  if (millis() - lastGpsLog > GPS_LOG_INTERVAL_MS &&
      WiFi.status() == WL_CONNECTED) {
    lastGpsLog = millis();

    SessionState sess = session_get();
    if (sess.active) {
      GpsSnapshot snap = gps_get_snapshot();
      if (snap.valid) {
        supabase_log(snap, sess.id, "", "gps");
      }
    }
  }

  delay(200);
}
