#include <Arduino.h>
#line 1 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
// ============================================================
//  AgriDrone Guardian | ESP32-CAM | OV5640 5MP
//  AI Thinker | WiFiManager | Firebase REST (no SSL)
//  OV5640 tuned | KK2 PWM | GPS | Battery | Quality checks
// ============================================================

#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiManager.h>
#include <esp_http_server.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ── Camera Pins (AI Thinker — never change these)
#define PWDN_GPIO_NUM   32
#define RESET_GPIO_NUM  -1
#define XCLK_GPIO_NUM    0
#define SIOD_GPIO_NUM   26
#define SIOC_GPIO_NUM   27
#define Y9_GPIO_NUM     35
#define Y8_GPIO_NUM     34
#define Y7_GPIO_NUM     39
#define Y6_GPIO_NUM     36
#define Y5_GPIO_NUM     21
#define Y4_GPIO_NUM     19
#define Y3_GPIO_NUM     18
#define Y2_GPIO_NUM      5
#define VSYNC_GPIO_NUM  25
#define HREF_GPIO_NUM   23
#define PCLK_GPIO_NUM   22

// ── KK2 PWM Input Pins
#define KK2_M1_PIN  12
#define KK2_M2_PIN  13
#define KK2_M3_PIN  14
#define KK2_M4_PIN  15

// ── Battery ADC
#define BATT_PIN    33
#define BATT_R1     100000.0f
#define BATT_R2     33000.0f
#define BATT_FULL   12.6f
#define BATT_EMPTY  10.5f

// ── Config
#define SERVER_PORT          81
#define AP_NAME              "AgriDrone-Setup"
#define AP_PASSWORD          "12345678"
#define CAPTURE_INTERVAL_MS  10000
#define CROP_TYPE            "rice"
#define CONFIDENCE_THRESHOLD "0.3"
#define FASTAPI_URL          "https://YOUR-APP.onrender.com/predict"

// ── Firebase REST (plain HTTP — no SSL needed)
#define FIREBASE_HOST   "agridrone-guardian-default-rtdb.firebaseio.com"
#define FIREBASE_SECRET "zXwOVXbB53fUjF1LDMGxLtEME5TjlNDCEHbzSmn6"

// ── Stream boundary
#define PART_BOUNDARY "123456789000000000000987654321"
static const char *STREAM_CONTENT_TYPE =
  "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *STREAM_BOUNDARY =
  "\r\n--" PART_BOUNDARY "\r\n";
static const char *STREAM_PART =
  "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

// ── Globals
httpd_handle_t camera_httpd = NULL;
bool firebaseReady = false;
unsigned long lastCapture = 0;
unsigned long lastKK2Send = 0;
unsigned long lastBattSend = 0;

// ── KK2 data
struct KK2Data {
  int m1 = 1000, m2 = 1000, m3 = 1000, m4 = 1000;
  int thrust = 0;
  float balance = 1.0;
  bool flying = false;
  bool wasFlying = false;
  String state = "GROUNDED";
};
KK2Data kk2;

// ── Battery data
struct BattData {
  float voltage = 0;
  int percent = 0;
  bool low = false;
};
BattData batt;

// ── Camera config (controlled from app)
struct CamConfig {
  int quality = 12;
  int brightness = 0;
  int contrast = 2;
  int saturation = -1;
  int sharpness = 2;
  bool vflip = false;
  bool hmirror = false;
  int framesize = 8;
};
CamConfig camCfg;

// ════════════════════════════════════════════
//  FIREBASE REST
// ════════════════════════════════════════════
#line 109 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool firebaseSet(String path, String jsonValue);
#line 122 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
String firebaseGet(String path);
#line 138 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void initFirebase();
#line 156 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool initCamera();
#line 248 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void applyCameraConfig();
#line 267 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool isImageGoodQuality(camera_fb_t *fb);
#line 300 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void readKK2();
#line 348 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool isDroneStable();
#line 358 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void sendKK2ToFirebase();
#line 373 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void readAndSendBattery();
#line 394 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void captureAndSend();
#line 505 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t stream_handler(httpd_req_t *req);
#line 536 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t capture_handler(httpd_req_t *req);
#line 551 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t status_handler(httpd_req_t *req);
#line 567 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t control_handler(httpd_req_t *req);
#line 599 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t index_handler(httpd_req_t *req);
#line 630 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void startCameraServer();
#line 658 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void startWiFi();
#line 676 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void setup();
#line 707 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void loop();
#line 109 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool firebaseSet(String path, String jsonValue) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  String url = "http://" + String(FIREBASE_HOST)
             + path + ".json?auth=" + FIREBASE_SECRET;
  http.begin(url);
  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/json");
  int code = http.PUT(jsonValue);
  http.end();
  return (code == 200);
}

String firebaseGet(String path) {
  if (WiFi.status() != WL_CONNECTED) return "";
  HTTPClient http;
  String url = "http://" + String(FIREBASE_HOST)
             + path + ".json?auth=" + FIREBASE_SECRET;
  http.begin(url);
  http.setTimeout(5000);
  int code = http.GET();
  String val = "";
  if (code == 200) val = http.getString();
  http.end();
  val.replace("\"", "");
  val.trim();
  return val;
}

void initFirebase() {
  Serial.print("[FB] Connecting...");
  if (firebaseSet("/drone/status", "\"online\"")) {
    firebaseSet("/drone/ip",
      "\"" + WiFi.localIP().toString() + "\"");
    firebaseSet("/drone/rssi", String(WiFi.RSSI()));
    firebaseSet("/drone/camera", "\"OV5640-XGA\"");
    Serial.println(" connected ✓");
    firebaseReady = true;
  } else {
    Serial.println(" failed — no Firebase");
    firebaseReady = false;
  }
}

// ════════════════════════════════════════════
//  CAMERA INIT — OV5640 tuned
// ════════════════════════════════════════════
bool initCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM;
  c.pin_d1 = Y3_GPIO_NUM;
  c.pin_d2 = Y4_GPIO_NUM;
  c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM;
  c.pin_d5 = Y7_GPIO_NUM;
  c.pin_d6 = Y8_GPIO_NUM;
  c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM;
  c.pin_pclk = PCLK_GPIO_NUM;
  c.pin_vsync = VSYNC_GPIO_NUM;
  c.pin_href = HREF_GPIO_NUM;
  c.pin_sscb_sda = SIOD_GPIO_NUM;
  c.pin_sscb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM;
  c.pin_reset = RESET_GPIO_NUM;

  // OV5640 must use 16MHz — 20MHz causes corruption
  c.xclk_freq_hz = 16000000;
  c.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    c.frame_size = FRAMESIZE_XGA;
    c.jpeg_quality = 12;
    c.fb_count = 1;
    c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
    Serial.println("[CAM] PSRAM → XGA 1024x768 Q=12");
  } else {
    c.frame_size = FRAMESIZE_SVGA;
    c.jpeg_quality = 15;
    c.fb_count = 1;
    c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
    Serial.println("[CAM] No PSRAM → SVGA 800x600 Q=15");
  }

  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Init failed: 0x%x\n", err);
    return false;
  }

  // OV5640 needs settle time before register access
  delay(500);

  sensor_t *s = esp_camera_sensor_get();
  if (!s) {
    Serial.println("[CAM] Cannot get sensor handle");
    return false;
  }

  Serial.printf("[CAM] Sensor PID: 0x%04X\n", s->id.PID);
  if (s->id.PID != OV5640_PID) {
    Serial.println("[CAM] WARNING: Not OV5640 — check cable");
  }

  // Apply outdoor flight settings
  s->set_framesize(s, FRAMESIZE_XGA);
  s->set_quality(s, 12);
  s->set_brightness(s, 0);
  s->set_contrast(s, 2);   // high contrast for lesions
  s->set_saturation(s, -1);   // reduce colour bleeding
  s->set_sharpness(s, 2);   // max sharpness
  s->set_denoise(s, 1);
  s->set_exposure_ctrl(s, 1);
  s->set_aec2(s, 1);
  s->set_ae_level(s, -1);   // slight underexpose for sun
  s->set_aec_value(s, 200);
  s->set_gain_ctrl(s, 1);
  s->set_agc_gain(s, 0);
  s->set_gainceiling(s, (gainceiling_t)2);
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_wb_mode(s, 1);   // sunny mode
  s->set_lenc(s, 1);
  s->set_bpc(s, 1);
  s->set_wpc(s, 1);
  s->set_dcw(s, 1);
  s->set_special_effect(s, 0);

  // Discard first garbage frame
  camera_fb_t *dummy = esp_camera_fb_get();
  if (dummy) esp_camera_fb_return(dummy);
  delay(100);

  Serial.println("[CAM] OV5640 ready");
  return true;
}

void applyCameraConfig() {
  sensor_t *s = esp_camera_sensor_get();
  if (!s) return;
  s->set_quality(s, camCfg.quality);
  s->set_brightness(s, camCfg.brightness);
  s->set_contrast(s, camCfg.contrast);
  s->set_saturation(s, camCfg.saturation);
  s->set_sharpness(s, camCfg.sharpness);
  s->set_vflip(s, camCfg.vflip ? 1 : 0);
  s->set_hmirror(s, camCfg.hmirror ? 1 : 0);
  s->set_framesize(s, (framesize_t)camCfg.framesize);
  Serial.printf("[CAM] Config: Q=%d B=%d C=%d S=%d Sh=%d\n",
    camCfg.quality, camCfg.brightness,
    camCfg.contrast, camCfg.saturation, camCfg.sharpness);
}

// ════════════════════════════════════════════
//  IMAGE QUALITY CHECKER
// ════════════════════════════════════════════
bool isImageGoodQuality(camera_fb_t *fb) {
  if (fb->len < 20000) {
    Serial.printf("[QC] FAIL: too small (%u bytes)\n", fb->len);
    return false;
  }
  if (fb->len > 250000) {
    Serial.printf("[QC] FAIL: too large (%u bytes)\n", fb->len);
    return false;
  }
  if (fb->buf[0] != 0xFF || fb->buf[1] != 0xD8) {
    Serial.println("[QC] FAIL: invalid JPEG header");
    return false;
  }
  // Brightness estimate from middle bytes
  int sum = 0;
  int mid = fb->len / 2;
  for (int i = 0; i < 20; i++) sum += fb->buf[mid + i];
  int avg = sum / 20;
  if (avg < 20) {
    Serial.printf("[QC] FAIL: too dark (avg=%d)\n", avg);
    return false;
  }
  if (avg > 245) {
    Serial.printf("[QC] FAIL: overexposed (avg=%d)\n", avg);
    return false;
  }
  Serial.printf("[QC] PASS: %u bytes brightness=%d\n", fb->len, avg);
  return true;
}

// ════════════════════════════════════════════
//  KK2 PWM READER
// ════════════════════════════════════════════
void readKK2() {
  kk2.m1 = pulseIn(KK2_M1_PIN, HIGH, 25000);
  kk2.m2 = pulseIn(KK2_M2_PIN, HIGH, 25000);
  kk2.m3 = pulseIn(KK2_M3_PIN, HIGH, 25000);
  kk2.m4 = pulseIn(KK2_M4_PIN, HIGH, 25000);
  if (!kk2.m1) kk2.m1 = 1000;
  if (!kk2.m2) kk2.m2 = 1000;
  if (!kk2.m3) kk2.m3 = 1000;
  if (!kk2.m4) kk2.m4 = 1000;

  int avg = (kk2.m1 + kk2.m2 + kk2.m3 + kk2.m4) / 4;
  kk2.thrust = map(avg, 1000, 2000, 0, 100);
  kk2.flying = (avg > 1250);

  int hi = max(max(kk2.m1, kk2.m2), max(kk2.m3, kk2.m4));
  int lo = min(min(kk2.m1, kk2.m2), min(kk2.m3, kk2.m4));
  kk2.balance = 1.0f -
    constrain((float)(hi - lo) / 200.0f, 0.0f, 1.0f);

  if      (!kk2.flying) kk2.state = "GROUNDED";
  else if (avg < 1450) kk2.state = "DESCENDING";
  else if (avg > 1600) kk2.state = "CLIMBING";
  else                 kk2.state = "HOVER";

  // Auto switch camera mode on takeoff/landing
  if (kk2.flying && !kk2.wasFlying) {
    sensor_t *s = esp_camera_sensor_get();
    if (s) {
      s->set_exposure_ctrl(s, 0);
      s->set_aec_value(s, 100);
      s->set_agc_gain(s, 8);
    }
    firebaseSet("/drone/status", "\"flying\"");
    Serial.println("[KK2] TAKEOFF — flight cam mode");
  }
  if (!kk2.flying && kk2.wasFlying) {
    sensor_t *s = esp_camera_sensor_get();
    if (s) {
      s->set_exposure_ctrl(s, 1);
      s->set_aec_value(s, 200);
      s->set_gain_ctrl(s, 1);
    }
    firebaseSet("/drone/status", "\"landed\"");
    Serial.println("[KK2] LANDING — ground cam mode");
  }
  kk2.wasFlying = kk2.flying;
}

bool isDroneStable() {
  int avg = (kk2.m1 + kk2.m2 + kk2.m3 + kk2.m4) / 4;
  int dev1 = abs(kk2.m1 - avg);
  int dev2 = abs(kk2.m2 - avg);
  int dev3 = abs(kk2.m3 - avg);
  int dev4 = abs(kk2.m4 - avg);
  int maxDev = max(max(dev1, dev2), max(dev3, dev4));
  return (maxDev < 80);
}

void sendKK2ToFirebase() {
  String json = "{\"m1\":"      + String(kk2.m1)
              + ",\"m2\":"      + String(kk2.m2)
              + ",\"m3\":"      + String(kk2.m3)
              + ",\"m4\":"      + String(kk2.m4)
              + ",\"thrust\":"  + String(kk2.thrust)
              + ",\"flying\":"  + (kk2.flying ? "true" : "false")
              + ",\"balance\":" + String(kk2.balance, 2)
              + ",\"state\":\"" + kk2.state + "\"}";
  firebaseSet("/kk2", json);
}

// ════════════════════════════════════════════
//  BATTERY
// ════════════════════════════════════════════
void readAndSendBattery() {
  int raw = analogRead(BATT_PIN);
  float vPin = (raw / 4095.0f) * 3.3f;
  batt.voltage = vPin * ((BATT_R1 + BATT_R2) / BATT_R2);
  batt.percent = (int)constrain(
    ((batt.voltage - BATT_EMPTY) / (BATT_FULL - BATT_EMPTY)) * 100,
    0,
    100
  );
  batt.low = (batt.percent < 20);
  String json = "{\"voltage\":" + String(batt.voltage, 2)
              + ",\"percent\":" + String(batt.percent)
              + ",\"low\":" + (batt.low ? "true" : "false")
              + "}";
  firebaseSet("/drone/battery", json);
  Serial.printf("[BATT] %.2fV %d%%\n", batt.voltage, batt.percent);
}

// ════════════════════════════════════════════
//  CAPTURE → FASTAPI → FIREBASE
// ════════════════════════════════════════════
void captureAndSend() {
  // Signal strength check
  int rssi = WiFi.RSSI();
  if (rssi < -85) {
    Serial.printf("[SCAN] Weak signal (%ddBm) skip\n", rssi);
    return;
  }

  // Stability check — wait up to 3s
  int wait = 0;
  while (!isDroneStable() && wait++ < 30) {
    delay(100);
    readKK2();
  }
  if (!isDroneStable()) {
    Serial.println("[SCAN] Unstable — skip");
    return;
  }

  // Discard stale buffer frame
  camera_fb_t *d = esp_camera_fb_get();
  if (d) esp_camera_fb_return(d);
  delay(50);

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[SCAN] Capture failed");
    return;
  }

  // Quality gate
  if (!isImageGoodQuality(fb)) {
    esp_camera_fb_return(fb);
    return;
  }

  firebaseSet("/drone/status", "\"scanning\"");

  // Build multipart POST body
  String bodyStart =
    "------ESP32Boundary\r\n"
    "Content-Disposition: form-data; "
    "name=\"image\"; filename=\"frame.jpg\"\r\n"
    "Content-Type: image/jpeg\r\n\r\n";
  String bodyEnd = "\r\n------ESP32Boundary--\r\n";
  int totalLen = bodyStart.length() + fb->len + bodyEnd.length();

  uint8_t *body = (uint8_t *)malloc(totalLen);
  if (!body) {
    Serial.println("[SCAN] malloc failed");
    esp_camera_fb_return(fb);
    return;
  }
  memcpy(body, bodyStart.c_str(), bodyStart.length());
  memcpy(body + bodyStart.length(), fb->buf, fb->len);
  memcpy(body + bodyStart.length() + fb->len,
         bodyEnd.c_str(), bodyEnd.length());

  esp_camera_fb_return(fb);  // free buffer before network

  String url = String(FASTAPI_URL)
             + "?crop=" + CROP_TYPE
             + "&confidence=" + CONFIDENCE_THRESHOLD;

  HTTPClient http;
  http.begin(url);
  http.setTimeout(25000);
  http.addHeader("Content-Type",
    "multipart/form-data; boundary=----ESP32Boundary");
  int httpCode = http.POST(body, totalLen);
  free(body);

  if (httpCode == 200) {
    String response = http.getString();
    Serial.printf("[API] %s\n", response.c_str());

    StaticJsonDocument<1024> doc;
    if (!deserializeJson(doc, response)) {
      const char *disease = doc["disease"] | "unknown";
      float confidence = doc["confidence"] | 0.0f;
      const char *severity = doc["severity"] | "unknown";

      Serial.printf("[AI] %s | %.2f | %s\n",
        disease, confidence, severity);

      if (firebaseReady) {
        unsigned long ts = millis();
        String json =
          "{\"disease\":\"" + String(disease) + "\""
        + ",\"confidence\":" + String(confidence, 2)
        + ",\"severity\":\"" + String(severity) + "\""
        + ",\"crop\":\"" + CROP_TYPE + "\""
        + ",\"timestamp\":" + String(ts) + "}";
        firebaseSet("/detection/latest", json);
        firebaseSet("/detection/history/" + String(ts), json);
        firebaseSet("/drone/status", "\"online\"");
        Serial.println("[FB] Written ✓");
      }
    }
  } else {
    Serial.printf("[API] Failed HTTP %d\n", httpCode);
    if (firebaseReady) {
      firebaseSet("/drone/status", "\"api_error\"");
    }
  }
  http.end();
}

// ════════════════════════════════════════════
//  HTTP SERVER HANDLERS
// ════════════════════════════════════════════
static esp_err_t stream_handler(httpd_req_t *req) {
  char part_buf[64];
  esp_err_t res = ESP_OK;
  httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  TickType_t last = xTaskGetTickCount();
  while (true) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      vTaskDelay(pdMS_TO_TICKS(30));
      continue;
    }
    res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (res != ESP_OK) {
      esp_camera_fb_return(fb);
      break;
    }
    size_t hl = snprintf(part_buf, sizeof(part_buf), STREAM_PART, fb->len);
    res = httpd_resp_send_chunk(req, part_buf, hl);
    if (res != ESP_OK) {
      esp_camera_fb_return(fb);
      break;
    }
    res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    if (res != ESP_OK) break;
    vTaskDelayUntil(&last, pdMS_TO_TICKS(100));
  }
  return res;
}

static esp_err_t capture_handler(httpd_req_t *req) {
  camera_fb_t *d = esp_camera_fb_get();
  if (d) esp_camera_fb_return(d);
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }
  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

static esp_err_t status_handler(httpd_req_t *req) {
  String json = "{\"status\":\"online\"";
  json += ",\"ip\":\"" + WiFi.localIP().toString() + "\"";
  json += ",\"rssi\":" + String(WiFi.RSSI());
  json += ",\"flying\":";
  json += kk2.flying ? "true" : "false";
  json += ",\"thrust\":" + String(kk2.thrust);
  json += ",\"battery\":" + String(batt.percent);
  json += ",\"camera\":\"OV5640-XGA\"";
  json += ",\"pid\":\"0x5640\"";
  json += "}";
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  return httpd_resp_send(req, json.c_str(), json.length());
}

static esp_err_t control_handler(httpd_req_t *req) {
  char buf[256];
  size_t len = httpd_req_get_url_query_len(req) + 1;
  if (len > 1 && len < sizeof(buf)) {
    httpd_req_get_url_query_str(req, buf, len);
    char val[16];
    if (httpd_query_key_value(buf, "quality", val, sizeof(val)) == ESP_OK) camCfg.quality = atoi(val);
    if (httpd_query_key_value(buf, "brightness", val, sizeof(val)) == ESP_OK) camCfg.brightness = atoi(val);
    if (httpd_query_key_value(buf, "contrast", val, sizeof(val)) == ESP_OK) camCfg.contrast = atoi(val);
    if (httpd_query_key_value(buf, "saturation", val, sizeof(val)) == ESP_OK) camCfg.saturation = atoi(val);
    if (httpd_query_key_value(buf, "sharpness", val, sizeof(val)) == ESP_OK) camCfg.sharpness = atoi(val);
    if (httpd_query_key_value(buf, "vflip", val, sizeof(val)) == ESP_OK) camCfg.vflip = atoi(val) == 1;
    if (httpd_query_key_value(buf, "hmirror", val, sizeof(val)) == ESP_OK) camCfg.hmirror = atoi(val) == 1;
    if (httpd_query_key_value(buf, "framesize", val, sizeof(val)) == ESP_OK) camCfg.framesize = atoi(val);
    applyCameraConfig();
  }
  String json = "{\"quality\":" + String(camCfg.quality);
  json += ",\"brightness\":" + String(camCfg.brightness);
  json += ",\"contrast\":" + String(camCfg.contrast);
  json += ",\"saturation\":" + String(camCfg.saturation);
  json += ",\"sharpness\":" + String(camCfg.sharpness);
  json += ",\"vflip\":";
  json += camCfg.vflip ? "true" : "false";
  json += ",\"hmirror\":";
  json += camCfg.hmirror ? "true" : "false";
  json += ",\"framesize\":" + String(camCfg.framesize);
  json += "}";
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  return httpd_resp_send(req, json.c_str(), json.length());
}

static esp_err_t index_handler(httpd_req_t *req) {
  const char *html =
    "<!doctype html><html><head>"
    "<meta name='viewport' content='width=device-width'>"
    "<title>AgriDrone</title>"
    "<style>body{background:#0a0f0d;color:#4ade80;"
    "font-family:monospace;padding:16px}"
    "img{width:100%;max-width:800px;border:1px solid #1a4a2a}"
    "a{color:#4ade80;border:1px solid #4ade80;"
    "padding:6px 12px;margin-right:8px;text-decoration:none}"
    ".s{font-size:11px;color:#4a6b51;margin-top:8px}"
    "</style></head><body>"
    "<h3>⬡ AgriDrone Guardian</h3>"
    "<img id='s' alt='stream'><br><br>"
    "<a href='/stream'>STREAM</a>"
    "<a href='/capture'>SNAPSHOT</a>"
    "<a href='/status'>STATUS</a>"
    "<div class='s' id='st'>CONNECTING...</div>"
    "<script>"
    "var i=document.getElementById('s');"
    "var s=document.getElementById('st');"
    "function go(){i.src='';i.src='/stream?t='+Date.now();}"
    "i.onload=function(){s.textContent='LIVE OV5640 XGA';};"
    "i.onerror=function(){s.textContent='RECONNECTING...';"
    "setTimeout(go,2000);};"
    "go();"
    "</script></body></html>";
  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
}

void startCameraServer() {
  httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
  cfg.server_port = SERVER_PORT;
  cfg.stack_size = 16384;
  cfg.max_uri_handlers = 10;
  cfg.recv_wait_timeout = 30;
  cfg.send_wait_timeout = 30;

  httpd_uri_t r[] = {
    {"/", HTTP_GET, index_handler, NULL},
    {"/stream", HTTP_GET, stream_handler, NULL},
    {"/capture", HTTP_GET, capture_handler, NULL},
    {"/status", HTTP_GET, status_handler, NULL},
    {"/control", HTTP_GET, control_handler, NULL},
  };

  if (httpd_start(&camera_httpd, &cfg) == ESP_OK) {
    for (size_t i = 0; i < sizeof(r) / sizeof(r[0]); ++i) {
      httpd_register_uri_handler(camera_httpd, &r[i]);
    }
    Serial.printf("[HTTP] http://%s:%d/\n",
      WiFi.localIP().toString().c_str(), SERVER_PORT);
  }
}

// ════════════════════════════════════════════
//  WIFI
// ════════════════════════════════════════════
void startWiFi() {
  WiFiManager wm;
  wm.setConfigPortalTimeout(180);
  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  if (!wm.autoConnect(AP_NAME, AP_PASSWORD)) {
    Serial.println("[WiFi] Failed — restarting");
    ESP.restart();
  }
  int t = 0;
  while (WiFi.localIP().toString() == "0.0.0.0" && t++ < 20) delay(500);
  Serial.printf("[WiFi] %s (%ddBm)\n",
    WiFi.localIP().toString().c_str(), WiFi.RSSI());
}

// ════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("\n=== AgriDrone Guardian ===");

  pinMode(KK2_M1_PIN, INPUT);
  pinMode(KK2_M2_PIN, INPUT);
  pinMode(KK2_M3_PIN, INPUT);
  pinMode(KK2_M4_PIN, INPUT);
  pinMode(BATT_PIN, INPUT);

  startWiFi();

  if (!initCamera()) {
    Serial.println("[BOOT] Camera FAILED — halt");
    while (true) delay(1000);
  }

  initFirebase();
  startCameraServer();

  Serial.println("[BOOT] All systems ready ✓");
  Serial.printf("[BOOT] Stream → http://%s:%d/\n",
    WiFi.localIP().toString().c_str(), SERVER_PORT);
  Serial.printf("[BOOT] Status → http://%s:%d/status\n",
    WiFi.localIP().toString().c_str(), SERVER_PORT);
}

// ════════════════════════════════════════════
//  LOOP
// ════════════════════════════════════════════
void loop() {
  unsigned long now = millis();

  // WiFi watchdog
  static unsigned long lastWifi = 0;
  if (now - lastWifi > 10000) {
    lastWifi = now;
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Lost — reconnecting");
      WiFi.reconnect();
      delay(5000);
      if (!firebaseReady) initFirebase();
    }
  }

  // KK2 every 2s
  static unsigned long lastKK2 = 0;
  if (now - lastKK2 > 2000) {
    lastKK2 = now;
    readKK2();
    if (firebaseReady) sendKK2ToFirebase();
  }

  // Battery every 30s
  if (now - lastBattSend > 30000) {
    lastBattSend = now;
    readAndSendBattery();
  }

  // Render.com keep-alive every 10 mins
  static unsigned long lastPing = 0;
  if (now - lastPing > 600000) {
    lastPing = now;
    HTTPClient h;
    h.begin("https://YOUR-APP.onrender.com/health");
    h.setTimeout(5000);
    h.GET();
    h.end();
    Serial.println("[PING] Render warmed");
  }

  // AI scan — timed or app command
  String cmd = firebaseReady ? firebaseGet("/drone/command") : "";
  bool triggered = (cmd == "scan");
  if (triggered) {
    firebaseSet("/drone/command", "\"idle\"");
  }
  if (triggered || (now - lastCapture > CAPTURE_INTERVAL_MS)) {
    lastCapture = now;
    captureAndSend();
  }

  // Config sync every 60s
  static unsigned long lastCfg = 0;
  if (firebaseReady && now - lastCfg > 60000) {
    lastCfg = now;
    String crop = firebaseGet("/config/crop");
    if (crop.length() > 0) {
      Serial.printf("[CFG] crop=%s\n", crop.c_str());
    }
  }

  delay(100);
}

