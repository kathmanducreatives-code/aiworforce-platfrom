#pragma once
// ============================================================
//  AgriDrone Guardian — Central Configuration
//  Change ONLY this file to adapt to different hardware/WiFi.
// ============================================================

// ── WiFi ─────────────────────────────────────────────────────
#define WIFI_SSID         "YOUR_WIFI_SSID"
#define WIFI_PASSWORD     "YOUR_WIFI_PASSWORD"

// ── Supabase ─────────────────────────────────────────────────
#define SUPABASE_URL      "https://luvostyizefajbltukkc.supabase.co"
#define SUPABASE_ANON_KEY \
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1dm9zdHlpemVmYWpibHR1a2tjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDA1NDgsImV4cCI6MjA5MjY3NjU0OH0.FcihW48l30A7sxv5IC5GdekKCNTmFo2xEnAebBen5UI"
#define SUPABASE_SERVICE_KEY \
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1dm9zdHlpemVmYWpibHR1a2tjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzEwMDU0OCwiZXhwIjoyMDkyNjc2NTQ4fQ.9qEzns6rvptnoojusg7hLeoE018r24XeexUAHGsjZ9E"
#define SUPABASE_BUCKET   "drone-images"
#define SUPABASE_TABLE    "drone_logs"
#define DEVICE_ID         "esp32-drone-01"

// ── FastAPI backend ───────────────────────────────────────────
#define FASTAPI_BASE_URL  "https://agridrone-api.onrender.com"

// ── GPS (NEO-6M / NEO-M8N on UART1) ─────────────────────────
// GPIO 17 = ESP32-S3 UART TX → GPS module RX pin
// GPIO 18 = ESP32-S3 UART RX ← GPS module TX pin
#define GPS_TX_PIN        17
#define GPS_RX_PIN        18
#define GPS_BAUD          9600
// Default fallback coordinates (Kathmandu, Nepal)
#define DEFAULT_LAT       27.690657
#define DEFAULT_LNG       85.295091

// ── Camera pins — ESP32-S3 Dev Module ────────────────────────
// *** These GPIOs intentionally avoid 17 (GPS TX) and 18 (GPS RX) ***
// *** Adjust to match your physical wiring if different           ***
#define PWDN_GPIO_NUM     -1
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM     10
#define SIOD_GPIO_NUM     40
#define SIOC_GPIO_NUM     39
#define Y9_GPIO_NUM       48
#define Y8_GPIO_NUM       11
#define Y7_GPIO_NUM       12
#define Y6_GPIO_NUM       14
#define Y5_GPIO_NUM       16
#define Y4_GPIO_NUM       21
#define Y3_GPIO_NUM        8
#define Y2_GPIO_NUM        7
#define VSYNC_GPIO_NUM    38
#define HREF_GPIO_NUM     47
#define PCLK_GPIO_NUM     13

// ── Timing ───────────────────────────────────────────────────
#define WDT_TIMEOUT_SEC      30       // Hard reboot if any task hangs
#define GPS_LOG_INTERVAL_MS  10000UL  // Periodic position-only Supabase log
#define STREAM_FRAME_MS      120      // ~8 fps MJPEG cap
#define WIFI_CHECK_MS        15000UL  // WiFi health check interval

// ── Capture quality ───────────────────────────────────────────
#define STREAM_FRAMESIZE  FRAMESIZE_SVGA   // 800×600 continuous stream
#define STREAM_QUALITY    12
#define SNAP_FRAMESIZE    FRAMESIZE_UXGA   // 1600×1200 single snapshot
#define SNAP_QUALITY      10
#define SNAP_SETTLE_MS    300              // sensor settle after resize
#define SNAP_DISCARD      2               // stale frames to skip after resize
