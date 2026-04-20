#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include "esp_http_server.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "esp32-hal-psram.h"

// ============================================================
//  AgriDrone Guardian | ESP32-CAM | OV5640 5MP
//  AI Thinker | WiFiManager | Firebase REST
//  Live preview at lower resolution, AI upload at higher resolution
// ============================================================

// ------------------------------------------------------------
// Camera pins (AI Thinker)
// ------------------------------------------------------------
#define PWDN_GPIO_NUM   32
#define RESET_GPIO_NUM  -1
#define XCLK_GPIO_NUM   0
#define SIOD_GPIO_NUM   26
#define SIOC_GPIO_NUM   27
#define Y9_GPIO_NUM     35
#define Y8_GPIO_NUM     34
#define Y7_GPIO_NUM     39
#define Y6_GPIO_NUM     36
#define Y5_GPIO_NUM     21
#define Y4_GPIO_NUM     19
#define Y3_GPIO_NUM     18
#define Y2_GPIO_NUM     5
#define VSYNC_GPIO_NUM  25
#define HREF_GPIO_NUM   23
#define PCLK_GPIO_NUM   22

// ------------------------------------------------------------
// Config
// ------------------------------------------------------------
#define SERVER_PORT          81
#define AP_NAME              "AgriDrone-Setup"
#define AP_PASSWORD          "12345678"
#define RESET_PIN            0
#define CAPTURE_INTERVAL_MS  10000UL
#define CROP_TYPE            "rice"
#define CONFIDENCE_THRESHOLD "0.3"

// Render API
#define FASTAPI_BASE_URL    "https://agridrone-api.onrender.com"
#define FASTAPI_PREDICT_URL FASTAPI_BASE_URL "/predict"

// Firebase (legacy REST auth shown here because your current backend uses it)
#define FIREBASE_HOST   "agridrone-guardian-default-rtdb.firebaseio.com"
#define FIREBASE_SECRET "zXwOVXbB53fUjF1LDMGxLtEME5TjlNDCEHbzSmn6"

// Preview vs AI capture settings
static const framesize_t PREVIEW_SIZE_PSRAM = FRAMESIZE_QVGA;  // 320x240
static const framesize_t PREVIEW_SIZE_DRAM  = FRAMESIZE_QVGA;  // 320x240
static const framesize_t AI_SIZE_PSRAM      = FRAMESIZE_XGA;   // 1024x768
static const framesize_t AI_SIZE_DRAM       = FRAMESIZE_SVGA;  // fallback

static const int PREVIEW_JPEG_QUALITY_PSRAM = 16;
static const int PREVIEW_JPEG_QUALITY_DRAM  = 16;
static const int AI_JPEG_QUALITY_PSRAM      = 12;
static const int AI_JPEG_QUALITY_DRAM       = 10;
static const uint32_t STREAM_FRAME_INTERVAL_MS = 180;
static const uint16_t RENDER_CONNECT_TIMEOUT_MS = 15000;
static const uint16_t RENDER_POST_TIMEOUT_MS    = 45000;
static const uint16_t RENDER_WAKE_TIMEOUT_MS    = 65000;
static const uint8_t  RENDER_POST_RETRIES       = 2;
static const uint32_t RENDER_RETRY_DELAY_MS     = 3000;

// ------------------------------------------------------------
// Stream constants
// ------------------------------------------------------------
#define PART_BOUNDARY "123456789000000000000987654321"
static const char *STREAM_CONTENT_TYPE =
  "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char *STREAM_PART =
  "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

// ------------------------------------------------------------
// Globals
// ------------------------------------------------------------
httpd_handle_t camera_httpd = NULL;
bool firebaseReady = false;
bool hasPsram = false;
volatile bool streamActive = false;
volatile bool captureBusy = false;
unsigned long lastCapture = 0;
bool streamSkipLogged = false;

framesize_t previewFrameSize = PREVIEW_SIZE_DRAM;
framesize_t aiFrameSize = AI_SIZE_DRAM;
int previewJpegQuality = PREVIEW_JPEG_QUALITY_DRAM;
int aiJpegQuality = AI_JPEG_QUALITY_DRAM;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
const char *frameSizeName(framesize_t size) {
  switch (size) {
    case FRAMESIZE_QVGA: return "QVGA 320x240";
    case FRAMESIZE_VGA: return "VGA 640x480";
    case FRAMESIZE_SVGA: return "SVGA 800x600";
    case FRAMESIZE_XGA: return "XGA 1024x768";
    case FRAMESIZE_SXGA: return "SXGA 1280x1024";
    case FRAMESIZE_UXGA: return "UXGA 1600x1200";
    case FRAMESIZE_5MP: return "5MP 2592x1944";
    default: return "custom";
  }
}

bool setFirebaseValue(const String &path, const String &jsonValue) {
  HTTPClient http;
  String url = "http://" + String(FIREBASE_HOST) + path + ".json?auth=" + FIREBASE_SECRET;

  http.begin(url);
  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/json");

  int code = http.PUT(jsonValue);
  String response = http.getString();
  http.end();

  if (code == 200) {
    return true;
  }

  Serial.printf("[FB] PUT failed - HTTP %d - %s\n", code, response.c_str());
  return false;
}

bool shouldRetryRender(int httpCode) {
  return httpCode <= 0 || httpCode == 408 || httpCode == 425 || httpCode == 429 || httpCode >= 500;
}

bool warmupRender() {
  WiFiClientSecure client;
  client.setInsecure();
  client.setHandshakeTimeout(30);
  client.setTimeout(RENDER_WAKE_TIMEOUT_MS);

  HTTPClient http;
  http.setConnectTimeout(RENDER_CONNECT_TIMEOUT_MS);
  http.setTimeout(RENDER_WAKE_TIMEOUT_MS);

  if (!http.begin(client, String(FASTAPI_BASE_URL))) {
    Serial.println("[API] Warm-up begin failed");
    return false;
  }

  int code = http.GET();
  String body = http.getString();
  http.end();

  if (code > 0) {
    Serial.printf("[API] Warm-up response: HTTP %d\n", code);
    return true;
  }

  Serial.printf("[API] Warm-up failed: %s\n", HTTPClient::errorToString(code).c_str());
  (void)body;
  return false;
}

int postImageToRender(const String &url, uint8_t *body, size_t bodyLen, String &responseOut) {
  int lastCode = -1;

  for (uint8_t attempt = 1; attempt <= RENDER_POST_RETRIES; attempt++) {
    WiFiClientSecure client;
    client.setInsecure();
    client.setHandshakeTimeout(30);
    client.setTimeout(RENDER_POST_TIMEOUT_MS);

    HTTPClient http;
    http.setConnectTimeout(RENDER_CONNECT_TIMEOUT_MS);
    http.setTimeout(RENDER_POST_TIMEOUT_MS);

    if (!http.begin(client, url)) {
      lastCode = -1;
      Serial.println("[API] POST begin failed");
    } else {
      http.addHeader("Content-Type", "multipart/form-data; boundary=----ESP32Boundary");
      lastCode = http.POST(body, bodyLen);

      if (lastCode > 0) {
        responseOut = http.getString();
        http.end();

        if (lastCode == 200 || !shouldRetryRender(lastCode) || attempt == RENDER_POST_RETRIES) {
          return lastCode;
        }

        Serial.printf("[API] POST attempt %u got HTTP %d, retrying...\n", attempt, lastCode);
      } else {
        Serial.printf("[API] POST attempt %u failed: %s\n",
                      attempt, HTTPClient::errorToString(lastCode).c_str());
        http.end();
      }
    }

    if (attempt < RENDER_POST_RETRIES) {
      Serial.println("[API] Waking Render service before retry...");
      warmupRender();
      delay(RENDER_RETRY_DELAY_MS);
    }
  }

  return lastCode;
}

void initFirebase() {
  Serial.print("[FB] Testing connection...");
  if (setFirebaseValue("/drone/status", "\"online\"")) {
    Serial.println(" connected");
    setFirebaseValue("/drone/ip", "\"" + WiFi.localIP().toString() + "\"");
    setFirebaseValue("/drone/rssi", String(WiFi.RSSI()));
    setFirebaseValue("/drone/camera", "\"OV5640\"");
    setFirebaseValue("/drone/previewResolution", "\"" + String(frameSizeName(previewFrameSize)) + "\"");
    setFirebaseValue("/drone/aiResolution", "\"" + String(frameSizeName(aiFrameSize)) + "\"");
    firebaseReady = true;
  } else {
    Serial.println(" failed - continuing without Firebase");
    firebaseReady = false;
  }
}

void discardFrames(uint8_t count, uint16_t pauseMs) {
  for (uint8_t i = 0; i < count; i++) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) {
      esp_camera_fb_return(fb);
    }
    delay(pauseMs);
  }
}

void applyImageTuning(sensor_t *s) {
  s->set_brightness(s, 1);
  s->set_contrast(s, 1);
  s->set_saturation(s, 0);
  s->set_sharpness(s, 2);
  s->set_denoise(s, 0);

  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_wb_mode(s, 0);

  s->set_exposure_ctrl(s, 1);
  s->set_aec2(s, 0);
  s->set_ae_level(s, 1);

  s->set_gain_ctrl(s, 1);
  s->set_gainceiling(s, GAINCEILING_32X);

  s->set_lenc(s, 1);
  s->set_bpc(s, 1);
  s->set_wpc(s, 1);
  s->set_raw_gma(s, 1);
  s->set_dcw(s, 1);
  s->set_special_effect(s, 0);
  s->set_hmirror(s, 0);
  s->set_vflip(s, 0);
}

void applyPreviewSettings() {
  sensor_t *s = esp_camera_sensor_get();
  if (!s) {
    return;
  }

  s->set_framesize(s, previewFrameSize);
  s->set_quality(s, previewJpegQuality);
  s->set_dcw(s, 1);
  applyImageTuning(s);
  discardFrames(2, 60);
}

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
  c.pin_sccb_sda = SIOD_GPIO_NUM;
  c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM;
  c.pin_reset = RESET_GPIO_NUM;

  c.xclk_freq_hz = 16000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  c.fb_location = CAMERA_FB_IN_DRAM;
  c.frame_size = AI_SIZE_DRAM;
  c.jpeg_quality = AI_JPEG_QUALITY_DRAM;
  c.fb_count = 1;

  hasPsram = psramFound();
  if (hasPsram) {
    previewFrameSize = PREVIEW_SIZE_PSRAM;
    aiFrameSize = AI_SIZE_PSRAM;
    previewJpegQuality = PREVIEW_JPEG_QUALITY_PSRAM;
    aiJpegQuality = AI_JPEG_QUALITY_PSRAM;

    c.frame_size = aiFrameSize;
    c.jpeg_quality = aiJpegQuality;
    c.fb_count = 1;
    c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
    c.fb_location = CAMERA_FB_IN_PSRAM;

    Serial.printf("[CAM] PSRAM found -> preview %s, AI capture %s, single buffer stability mode\n",
                  frameSizeName(previewFrameSize), frameSizeName(aiFrameSize));
  } else {
    previewFrameSize = PREVIEW_SIZE_DRAM;
    aiFrameSize = AI_SIZE_DRAM;
    previewJpegQuality = PREVIEW_JPEG_QUALITY_DRAM;
    aiJpegQuality = AI_JPEG_QUALITY_DRAM;

    Serial.printf("[CAM] No PSRAM -> preview %s, AI capture %s, single buffer stability mode\n",
                  frameSizeName(previewFrameSize), frameSizeName(aiFrameSize));
  }

  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Init failed: 0x%x\n", err);
    return false;
  }

  delay(500);

  sensor_t *s = esp_camera_sensor_get();
  if (!s) {
    Serial.println("[CAM] Cannot get sensor handle");
    return false;
  }

  Serial.printf("[CAM] Sensor PID: 0x%04X\n", s->id.PID);
  if (s->id.PID != OV5640_PID) {
    Serial.println("[CAM] WARNING: OV5640 not detected - check ribbon cable and module type");
  }

  applyPreviewSettings();
  Serial.println("[CAM] Camera initialized");
  return true;
}

bool buildMultipartBody(camera_fb_t *fb, uint8_t **bodyOut, size_t *lenOut) {
  String boundary = "----ESP32Boundary";
  String bodyStart =
    "--" + boundary + "\r\n"
    "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n"
    "Content-Type: image/jpeg\r\n\r\n";
  String bodyEnd = "\r\n--" + boundary + "--\r\n";

  size_t totalLen = bodyStart.length() + fb->len + bodyEnd.length();
  uint8_t *body = (uint8_t *)(hasPsram ? ps_malloc(totalLen) : malloc(totalLen));
  if (!body) {
    return false;
  }

  memcpy(body, bodyStart.c_str(), bodyStart.length());
  memcpy(body + bodyStart.length(), fb->buf, fb->len);
  memcpy(body + bodyStart.length() + fb->len, bodyEnd.c_str(), bodyEnd.length());

  *bodyOut = body;
  *lenOut = totalLen;
  return true;
}

void writeDetectionToFirebase(const char *disease, float confidence, const char *severity) {
  if (!firebaseReady) {
    return;
  }

  unsigned long ts = millis();

  String json =
    "{\"disease\":\"" + String(disease) + "\","
    "\"confidence\":" + String(confidence, 4) + ","
    "\"severity\":\"" + String(severity) + "\","
    "\"crop\":\"" + String(CROP_TYPE) + "\","
    "\"timestamp\":" + String(ts) + ","
    "\"previewResolution\":\"" + String(frameSizeName(previewFrameSize)) + "\","
    "\"captureResolution\":\"" + String(frameSizeName(aiFrameSize)) + "\"}";

  if (setFirebaseValue("/detection/latest", json)) {
    Serial.println("[FB] Latest detection written");
  }
  setFirebaseValue("/detection/history/" + String(ts), json);
  setFirebaseValue("/drone/status", "\"scanning\"");
  setFirebaseValue("/drone/lastSeen", String(ts));
}

void captureAndSend() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[TASK] WiFi not connected - skipping capture");
    return;
  }

  if (streamActive) {
    if (!streamSkipLogged) {
      Serial.println("[TASK] Stream active - AI capture paused until stream closes");
      streamSkipLogged = true;
    }
    return;
  }

  streamSkipLogged = false;

  sensor_t *s = esp_camera_sensor_get();
  if (!s) {
    Serial.println("[TASK] Sensor unavailable");
    return;
  }

  captureBusy = true;
  Serial.printf("[TASK] Switching to AI capture size %s\n", frameSizeName(aiFrameSize));
  s->set_framesize(s, aiFrameSize);
  s->set_quality(s, aiJpegQuality);
  s->set_dcw(s, 0);
  delay(200);
  discardFrames(2, 80);

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[TASK] Frame capture failed");
    applyPreviewSettings();
    captureBusy = false;
    return;
  }

  Serial.printf("[TASK] Captured %u bytes at %ux%u\n", fb->len, fb->width, fb->height);

  uint8_t *body = NULL;
  size_t bodyLen = 0;
  if (!buildMultipartBody(fb, &body, &bodyLen)) {
    Serial.println("[TASK] Could not allocate upload buffer");
    esp_camera_fb_return(fb);
    applyPreviewSettings();
    captureBusy = false;
    return;
  }

  esp_camera_fb_return(fb);
  applyPreviewSettings();
  captureBusy = false;

  String url = String(FASTAPI_PREDICT_URL)
             + "?crop=" + CROP_TYPE
             + "&confidence=" + CONFIDENCE_THRESHOLD;
  String response;
  int httpCode = postImageToRender(url, body, bodyLen, response);
  free(body);

  if (httpCode == 200) {
    Serial.printf("[API] Response: %s\n", response.c_str());

    StaticJsonDocument<1536> doc;
    DeserializationError err = deserializeJson(doc, response);
    if (err) {
      Serial.printf("[API] JSON parse error: %s\n", err.c_str());
    } else {
      const char *disease = doc["disease"] | "unknown";
      float confidence = doc["confidence"] | 0.0f;
      const char *severity = doc["severity"] | "unknown";
      Serial.printf("[API] %s | %.2f | %s\n", disease, confidence, severity);
      writeDetectionToFirebase(disease, confidence, severity);
    }
  } else if (httpCode == -1) {
    Serial.println("[API] Connection failed - Render may still be asleep or unreachable");
    if (firebaseReady) {
      setFirebaseValue("/drone/status", "\"api_unreachable\"");
    }
  } else {
    Serial.printf("[API] HTTP error: %d\n", httpCode);
    if (firebaseReady) {
      setFirebaseValue("/drone/status", "\"api_error\"");
    }
  }

}

// ------------------------------------------------------------
// HTTP server handlers
// ------------------------------------------------------------
static esp_err_t stream_handler(httpd_req_t *req) {
  char part_buf[64];
  esp_err_t res = ESP_OK;

  streamActive = true;
  applyPreviewSettings();

  httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-cache, no-store");

  Serial.println("[STREAM] Client connected");
  TickType_t lastFrame = xTaskGetTickCount();

  while (true) {
    if (captureBusy) {
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }

    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      vTaskDelay(pdMS_TO_TICKS(30));
      continue;
    }

    res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (res == ESP_OK) {
      size_t hlen = snprintf(part_buf, sizeof(part_buf), STREAM_PART, fb->len);
      res = httpd_resp_send_chunk(req, part_buf, hlen);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    }

    esp_camera_fb_return(fb);
    if (res != ESP_OK) {
      break;
    }

    vTaskDelayUntil(&lastFrame, pdMS_TO_TICKS(STREAM_FRAME_INTERVAL_MS));
  }

  streamActive = false;
  streamSkipLogged = false;
  Serial.println("[STREAM] Client disconnected");
  return res;
}

static esp_err_t capture_handler(httpd_req_t *req) {
  if (captureBusy) {
    for (uint8_t i = 0; i < 20 && captureBusy; i++) {
      delay(20);
    }
  }

  applyPreviewSettings();
  discardFrames(1, 50);

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=snapshot.jpg");
  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

static esp_err_t index_handler(httpd_req_t *req) {
  String html;
  html.reserve(1600);
  html += "<!doctype html><html><head>";
  html += "<meta charset='utf-8'>";
  html += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>AgriDrone Guardian</title>";
  html += "<style>";
  html += "body{background:#0a0f0d;color:#4ade80;font-family:monospace;padding:20px;margin:0}";
  html += "h2{font-size:1.2rem;letter-spacing:0.2em;margin-bottom:16px}";
  html += "img{width:100%;max-width:800px;display:block;border:1px solid #1a4a2a}";
  html += ".bar{display:flex;gap:12px;margin-top:12px;flex-wrap:wrap}";
  html += "a{color:#4ade80;text-decoration:none;border:1px solid #4ade80;padding:6px 14px;font-size:0.75rem;letter-spacing:0.1em}";
  html += "a:hover{background:rgba(74,222,128,0.1)}";
  html += ".status{font-size:0.8rem;color:#2d6a3f;margin-top:8px}";
  html += "</style></head><body>";
  html += "<h2>AGRIDRONE GUARDIAN</h2>";
  html += "<img id='s' alt='stream'>";
  html += "<div class='bar'>";
  html += "<a href='/stream' target='_blank'>RAW STREAM</a>";
  html += "<a href='/capture' target='_blank'>SNAPSHOT</a>";
  html += "</div>";
  html += "<div class='status' id='st'>CONNECTING...</div>";
  html += "<script>";
  html += "var img=document.getElementById('s');";
  html += "var st=document.getElementById('st');";
  html += "function loadStill(){img.dataset.mode='still';img.src='';img.src='/capture?t='+Date.now();}";
  html += "img.onload=function(){if(img.dataset.mode==='still'){st.textContent='SNAPSHOT READY - AI capture remains active';return;}st.textContent='LIVE - OV5640 preview ";
  html += frameSizeName(previewFrameSize);
  html += "';};";
  html += "img.onerror=function(){st.textContent='RETRYING SNAPSHOT...';setTimeout(loadStill,700);};";
  html += "loadStill();";
  html += "</script></body></html>";

  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, html.c_str(), html.length());
}

void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = SERVER_PORT;
  config.ctrl_port = 32768;
  config.recv_wait_timeout = 30;
  config.send_wait_timeout = 30;
  config.max_uri_handlers = 8;
  config.stack_size = 16384;
  config.task_priority = tskIDLE_PRIORITY + 5;
  config.core_id = 0;

  httpd_uri_t r_index = {"/", HTTP_GET, index_handler, NULL};
  httpd_uri_t r_capture = {"/capture", HTTP_GET, capture_handler, NULL};
  httpd_uri_t r_stream = {"/stream", HTTP_GET, stream_handler, NULL};

  if (httpd_start(&camera_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(camera_httpd, &r_index);
    httpd_register_uri_handler(camera_httpd, &r_capture);
    httpd_register_uri_handler(camera_httpd, &r_stream);
    Serial.printf("[HTTP] Ready -> http://%s:%d/\n", WiFi.localIP().toString().c_str(), SERVER_PORT);
  } else {
    Serial.println("[HTTP] Server start failed");
  }
}

// ------------------------------------------------------------
// WiFi
// ------------------------------------------------------------
void startWiFi() {
  pinMode(RESET_PIN, INPUT_PULLUP);
  delay(100);

  if (digitalRead(RESET_PIN) == LOW) {
    WiFiManager wm;
    wm.resetSettings();
    Serial.println("[WiFi] Settings cleared");
    delay(500);
  }

  WiFiManager wm;
  wm.setConfigPortalTimeout(180);
  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);

  if (!wm.autoConnect(AP_NAME, AP_PASSWORD)) {
    Serial.println("[WiFi] Failed - restarting");
    delay(3000);
    ESP.restart();
  }

  int ipWait = 0;
  while (WiFi.localIP().toString() == "0.0.0.0" && ipWait < 20) {
    delay(500);
    Serial.print(".");
    ipWait++;
  }

  Serial.printf("\n[WiFi] Connected -> %s (%d dBm)\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
}

// ------------------------------------------------------------
// Setup / loop
// ------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("\n=== AgriDrone Guardian | OV5640 | Dual-resolution mode ===");

  startWiFi();

  if (!initCamera()) {
    Serial.println("[BOOT] Camera failed - halting");
    while (true) {
      delay(1000);
    }
  }

  initFirebase();
  startCameraServer();

  Serial.println("[BOOT] All systems ready");
  Serial.printf("[BOOT] Preview: %s | AI capture: %s\n",
                frameSizeName(previewFrameSize), frameSizeName(aiFrameSize));
  Serial.printf("[BOOT] Open -> http://%s:%d/\n",
                WiFi.localIP().toString().c_str(), SERVER_PORT);
}

void loop() {
  static unsigned long lastWifiCheck = 0;

  if (millis() - lastWifiCheck > 10000UL) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Lost - reconnecting...");
      WiFi.disconnect();
      delay(1000);
      WiFi.begin();

      int t = 0;
      while (WiFi.status() != WL_CONNECTED && t++ < 20) {
        delay(500);
        Serial.print(".");
      }

      Serial.println(WiFi.status() == WL_CONNECTED ? "\n[WiFi] Reconnected" : "\n[WiFi] Still down");

      if (WiFi.status() == WL_CONNECTED && !firebaseReady) {
        initFirebase();
      }
    }
  }

  if (millis() - lastCapture > CAPTURE_INTERVAL_MS) {
    lastCapture = millis();
    captureAndSend();
  }

  delay(100);
}
