#include "esp_camera.h"
#include "esp_http_server.h"
#include "esp32-hal-psram.h"
#include <WiFi.h>

// ============================================================
//  AgriDrone Guardian | Camera-only stability test
//  AI Thinker ESP32-CAM + OV5640
//
//  Purpose:
//  - Test only the camera and live stream
//  - No GPS
//  - No Firebase
//  - No Render
//  - No flash / SD storage
//  - No background upload tasks
//
//  If this sketch streams well, the camera path is good and
//  the lag/crashes are coming from the extra project features.
// ============================================================

// ------------------------------------------------------------
// Fill these before upload
// ------------------------------------------------------------
const char *WIFI_SSID = "YOUR_WIFI_NAME";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

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
// Stream tuning
// ------------------------------------------------------------
// Ultra-stable live preview for OV5640 on classic ESP32-CAM:
// start very small and very light, then scale up only after stability is proven.
static const framesize_t STREAM_SIZE = FRAMESIZE_QQVGA;  // 160x120
static const int STREAM_JPEG_QUALITY = 22;               // higher = smaller/faster
static const uint32_t STREAM_INTERVAL_MS = 250;          // about 4 fps target

// ------------------------------------------------------------
// Globals
// ------------------------------------------------------------
httpd_handle_t camera_httpd = NULL;

// ------------------------------------------------------------
// MJPEG stream constants
// ------------------------------------------------------------
#define PART_BOUNDARY "123456789000000000000987654321"
static const char *STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char *STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

// ------------------------------------------------------------
// Camera setup
// ------------------------------------------------------------
void discardFrames(uint8_t count, uint16_t pauseMs) {
  for (uint8_t i = 0; i < count; i++) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) {
      esp_camera_fb_return(fb);
    }
    delay(pauseMs);
  }
}

void tuneSensor(sensor_t *s) {
  s->set_framesize(s, STREAM_SIZE);
  s->set_quality(s, STREAM_JPEG_QUALITY);
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
  c.xclk_freq_hz = 16000000;  // safer for OV5640 than 20 MHz
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = STREAM_SIZE;
  c.jpeg_quality = STREAM_JPEG_QUALITY;

  c.fb_count = 1;
  c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  if (psramFound()) {
    c.fb_location = CAMERA_FB_IN_PSRAM;
    Serial.println("[CAM] PSRAM found -> single-buffer stability mode");
  } else {
    c.fb_location = CAMERA_FB_IN_DRAM;
    Serial.println("[CAM] No PSRAM -> single-buffer mode");
  }

  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Init failed: 0x%x\n", err);
    return false;
  }

  delay(500);
  sensor_t *s = esp_camera_sensor_get();
  if (!s) {
    Serial.println("[CAM] Sensor handle unavailable");
    return false;
  }

  Serial.printf("[CAM] Sensor PID: 0x%04X\n", s->id.PID);
  tuneSensor(s);
  discardFrames(2, 80);
  Serial.println("[CAM] Camera ready");
  return true;
}

// ------------------------------------------------------------
// WiFi
// ------------------------------------------------------------
bool connectWiFi() {
  if (String(WIFI_SSID).length() == 0 || String(WIFI_PASSWORD).length() == 0) {
    Serial.println("[WiFi] Please set WIFI_SSID and WIFI_PASSWORD in the sketch first");
    return false;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("[WiFi] Connecting");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 60) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Connection failed");
    return false;
  }

  Serial.printf("[WiFi] Connected -> http://%s:81/\n", WiFi.localIP().toString().c_str());
  return true;
}

// ------------------------------------------------------------
// HTTP handlers
// ------------------------------------------------------------
static esp_err_t stream_handler(httpd_req_t *req) {
  char partBuf[64];
  esp_err_t res = ESP_OK;

  httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-cache, no-store");

  Serial.println("[STREAM] Client connected");
  TickType_t lastFrame = xTaskGetTickCount();

  while (true) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }

    res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (res == ESP_OK) {
      size_t hlen = snprintf(partBuf, sizeof(partBuf), STREAM_PART, fb->len);
      res = httpd_resp_send_chunk(req, partBuf, hlen);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    }

    esp_camera_fb_return(fb);
    if (res != ESP_OK) {
      break;
    }

    vTaskDelayUntil(&lastFrame, pdMS_TO_TICKS(STREAM_INTERVAL_MS));
  }

  Serial.println("[STREAM] Client disconnected");
  return res;
}

static esp_err_t capture_handler(httpd_req_t *req) {
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

static esp_err_t health_handler(httpd_req_t *req) {
  String body = "{\"ok\":true,\"camera\":\"ready\",\"stream_size\":\"160x120\"}";
  httpd_resp_set_type(req, "application/json");
  return httpd_resp_send(req, body.c_str(), body.length());
}

static esp_err_t index_handler(httpd_req_t *req) {
  String html;
  html.reserve(1400);
  html += "<!doctype html><html><head>";
  html += "<meta charset='utf-8'>";
  html += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>AgriDrone Camera Test</title>";
  html += "<style>";
  html += "body{background:#0a0f0d;color:#4ade80;font-family:monospace;padding:20px;margin:0}";
  html += "h2{font-size:1.15rem;letter-spacing:0.2em;margin-bottom:12px}";
  html += "img{width:100%;max-width:720px;display:block;border:1px solid #1a4a2a}";
  html += ".bar{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}";
  html += "a{color:#4ade80;text-decoration:none;border:1px solid #4ade80;padding:7px 14px}";
  html += ".note{margin-top:10px;color:#8fd0a8}";
  html += "</style></head><body>";
  html += "<h2>AGRIDRONE CAMERA TEST</h2>";
  html += "<img src='/stream' alt='live stream'>";
  html += "<div class='bar'>";
  html += "<a href='/stream' target='_blank'>RAW STREAM</a>";
  html += "<a href='/capture' target='_blank'>SNAPSHOT</a>";
  html += "<a href='/health' target='_blank'>HEALTH</a>";
  html += "</div>";
  html += "<div class='note'>This sketch is camera-only. No GPS, no backend, no uploads. Stream is intentionally reduced for OV5640 stability.</div>";
  html += "</body></html>";

  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, html.c_str(), html.length());
}

void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 81;
  config.ctrl_port = 32768;
  config.recv_wait_timeout = 30;
  config.send_wait_timeout = 30;
  config.max_uri_handlers = 6;
  config.stack_size = 16384;

  httpd_uri_t r_index = {"/", HTTP_GET, index_handler, NULL};
  httpd_uri_t r_stream = {"/stream", HTTP_GET, stream_handler, NULL};
  httpd_uri_t r_capture = {"/capture", HTTP_GET, capture_handler, NULL};
  httpd_uri_t r_health = {"/health", HTTP_GET, health_handler, NULL};

  if (httpd_start(&camera_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(camera_httpd, &r_index);
    httpd_register_uri_handler(camera_httpd, &r_stream);
    httpd_register_uri_handler(camera_httpd, &r_capture);
    httpd_register_uri_handler(camera_httpd, &r_health);
    Serial.println("[HTTP] Server ready");
  } else {
    Serial.println("[HTTP] Server start failed");
  }
}

// ------------------------------------------------------------
// Setup / loop
// ------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println();
  Serial.println("=== AgriDrone Camera-only test ===");
  Serial.println("Note: boot ROM garbage before this line can be ignored.");

  if (!initCamera()) {
    Serial.println("[BOOT] Camera init failed");
    while (true) {
      delay(1000);
    }
  }

  if (!connectWiFi()) {
    Serial.println("[BOOT] WiFi failed");
    while (true) {
      delay(1000);
    }
  }

  startCameraServer();
  Serial.printf("[BOOT] Open -> http://%s:81/\n", WiFi.localIP().toString().c_str());
}

void loop() {
  delay(100);
}
