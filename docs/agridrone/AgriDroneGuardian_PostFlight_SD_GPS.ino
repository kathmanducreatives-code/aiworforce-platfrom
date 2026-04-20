#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include "esp_http_server.h"
#include "esp32-hal-psram.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SD_MMC.h>
#include <TinyGPS++.h>
#include <HardwareSerial.h>
#include <Preferences.h>
#include <stdarg.h>

// ============================================================
//  AgriDrone Guardian | Post-flight batch capture
//  AI Thinker ESP32-CAM + OV5640 + SD_MMC + NEO-6M
//
//  Workflow
//  1. Capture patch images to SD during flight
//  2. Save GPS metadata beside each image
//  3. After landing, upload images one-by-one to /v1/flights
//  4. Queue backend processing with /v1/flights/{flight_id}/complete
//
//  Wiring note for stock AI Thinker:
//  - SD_MMC 1-bit mode uses GPIO 2, 14, 15
//  - A practical NEO-6M option is GPS TX -> GPIO3 (U0RXD)
//  - If you use GPIO3 for GPS, disconnect the USB-TTL TX wire while running
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
#define SERVER_PORT 81
#define AP_NAME "AgriDrone-Setup"
#define AP_PASSWORD "12345678"
#define RESET_PIN 0

#define DEVICE_ID "esp32-drone-01"
#define FIELD_ID "field-alpha"
#define CROP_TYPE "rice"

#define FLIGHT_CAPTURE_INTERVAL_MS 5000UL
#define BACKEND_BASE_URL "https://agridrone-api.onrender.com"
#define PREVIEW_INTERVAL_MS 180UL

#define DEBUG_SERIAL_ENABLED 1
#define GPS_ENABLED 1
#define GPS_BAUD_RATE 9600
#define GPS_RX_PIN 3
#define GPS_TX_PIN -1

// ------------------------------------------------------------
// Runtime tuning
// ------------------------------------------------------------
static const framesize_t PREVIEW_SIZE = FRAMESIZE_QQVGA;
static const framesize_t CAPTURE_SIZE = FRAMESIZE_XGA;
static const int PREVIEW_JPEG_QUALITY = 20;
static const int CAPTURE_JPEG_QUALITY = 12;

// ------------------------------------------------------------
// Globals
// ------------------------------------------------------------
httpd_handle_t camera_httpd = NULL;
TinyGPSPlus gps;
HardwareSerial GPSSerial(1);
Preferences prefs;

bool hasPsram = false;
volatile bool streamActive = false;
volatile bool uploadRequested = false;
volatile bool captureRequested = false;
volatile bool captureBusy = false;
volatile bool captureEnabled = false;
volatile bool uploadInProgress = false;
volatile bool uploadComplete = false;
String uploadMessage = "idle";
String localFlightId = "";
String remoteFlightId = "";
int nextPatchIndex = 1;
unsigned long lastCaptureMs = 0;

// ------------------------------------------------------------
// Serial helpers
// ------------------------------------------------------------
void logLine(const String &message) {
#if DEBUG_SERIAL_ENABLED
  Serial.println(message);
#else
  (void)message;
#endif
}

void logf(const char *fmt, ...) {
#if DEBUG_SERIAL_ENABLED
  char buffer[256];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);
  Serial.println(buffer);
#else
  (void)fmt;
#endif
}

// ------------------------------------------------------------
// Path helpers
// ------------------------------------------------------------
String flightRootPath() {
  if (localFlightId.isEmpty()) {
    return "";
  }
  return "/flights/" + localFlightId;
}

String manifestPath() {
  return flightRootPath() + "/manifest.json";
}

String patchImagePath(int patchIndex) {
  char buffer[64];
  snprintf(buffer, sizeof(buffer), "%s/patch-%05d.jpg", flightRootPath().c_str(), patchIndex);
  return String(buffer);
}

String patchMetaPath(int patchIndex) {
  char buffer[64];
  snprintf(buffer, sizeof(buffer), "%s/patch-%05d.json", flightRootPath().c_str(), patchIndex);
  return String(buffer);
}

// ------------------------------------------------------------
// Preferences and manifest
// ------------------------------------------------------------
void savePreferences() {
  prefs.putString("local_id", localFlightId);
  prefs.putString("remote_id", remoteFlightId);
  prefs.putInt("next_patch", nextPatchIndex);
  prefs.putBool("capture_on", captureEnabled);
  prefs.putBool("upload_done", uploadComplete);
}

bool saveManifest() {
  if (localFlightId.isEmpty()) {
    return false;
  }

  DynamicJsonDocument doc(768);
  doc["local_flight_id"] = localFlightId;
  doc["remote_flight_id"] = remoteFlightId;
  doc["device_id"] = DEVICE_ID;
  doc["field_id"] = FIELD_ID;
  doc["crop_type"] = CROP_TYPE;
  doc["next_patch_index"] = nextPatchIndex;
  doc["capture_enabled"] = captureEnabled;
  doc["upload_complete"] = uploadComplete;
  doc["updated_at_ms"] = millis();

  if (SD_MMC.exists(manifestPath())) {
    SD_MMC.remove(manifestPath());
  }
  File file = SD_MMC.open(manifestPath(), FILE_WRITE);
  if (!file) {
    logLine("[SD] Failed to open manifest for write");
    return false;
  }
  if (serializeJsonPretty(doc, file) == 0) {
    file.close();
    logLine("[SD] Failed to write manifest");
    return false;
  }
  file.close();
  return true;
}

void loadPreferences() {
  prefs.begin("agridrone", false);
  localFlightId = prefs.getString("local_id", "");
  remoteFlightId = prefs.getString("remote_id", "");
  nextPatchIndex = prefs.getInt("next_patch", 1);
  captureEnabled = prefs.getBool("capture_on", false);
  uploadComplete = prefs.getBool("upload_done", false);
}

// ------------------------------------------------------------
// GPS helpers
// ------------------------------------------------------------
void initGPS() {
#if GPS_ENABLED
  GPSSerial.begin(GPS_BAUD_RATE, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  logf("[GPS] Started on RX=%d at %d baud", GPS_RX_PIN, GPS_BAUD_RATE);
#else
  logLine("[GPS] Disabled");
#endif
}

void pumpGPS() {
#if GPS_ENABLED
  while (GPSSerial.available()) {
    gps.encode(GPSSerial.read());
  }
#endif
}

String gpsTimestampOrFallback() {
#if GPS_ENABLED
  if (gps.date.isValid() && gps.time.isValid()) {
    char buffer[32];
    snprintf(
      buffer,
      sizeof(buffer),
      "%04d-%02d-%02dT%02d:%02d:%02dZ",
      gps.date.year(),
      gps.date.month(),
      gps.date.day(),
      gps.time.hour(),
      gps.time.minute(),
      gps.time.second()
    );
    return String(buffer);
  }
#endif
  return "boot-ms-" + String(millis());
}

void fillGpsJson(JsonDocument &doc) {
#if GPS_ENABLED
  doc["gps_fix"] = gps.location.isValid();
  if (gps.location.isValid()) {
    doc["lat"] = gps.location.lat();
    doc["lon"] = gps.location.lng();
  }
  if (gps.altitude.isValid()) {
    doc["altitude_m"] = gps.altitude.meters();
  }
  if (gps.course.isValid()) {
    doc["heading_deg"] = gps.course.deg();
  }
#else
  doc["gps_fix"] = false;
#endif
}

// ------------------------------------------------------------
// Camera helpers
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

void applySensorTuning(sensor_t *s) {
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

void setPreviewMode() {
  sensor_t *s = esp_camera_sensor_get();
  if (!s) {
    return;
  }
  s->set_framesize(s, PREVIEW_SIZE);
  s->set_quality(s, PREVIEW_JPEG_QUALITY);
  s->set_dcw(s, 1);
  applySensorTuning(s);
  discardFrames(2, 50);
}

void setCaptureMode() {
  sensor_t *s = esp_camera_sensor_get();
  if (!s) {
    return;
  }
  s->set_framesize(s, CAPTURE_SIZE);
  s->set_quality(s, CAPTURE_JPEG_QUALITY);
  s->set_dcw(s, 0);
  applySensorTuning(s);
  discardFrames(2, 80);
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
  c.frame_size = CAPTURE_SIZE;
  c.jpeg_quality = CAPTURE_JPEG_QUALITY;
  c.fb_count = 1;
  c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  c.fb_location = CAMERA_FB_IN_PSRAM;

  hasPsram = psramFound();
  if (!hasPsram) {
    c.fb_location = CAMERA_FB_IN_DRAM;
  }

  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    logf("[CAM] Init failed: 0x%x", err);
    return false;
  }

  delay(500);
  sensor_t *s = esp_camera_sensor_get();
  if (!s) {
    logLine("[CAM] Sensor unavailable");
    return false;
  }

  logf("[CAM] Sensor PID: 0x%04X", s->id.PID);
  setPreviewMode();
  return true;
}

// ------------------------------------------------------------
// SD helpers
// ------------------------------------------------------------
bool ensureDir(const String &path) {
  if (SD_MMC.exists(path)) {
    return true;
  }
  return SD_MMC.mkdir(path);
}

bool initSDCard() {
  pinMode(4, OUTPUT);
  digitalWrite(4, HIGH);

  if (!SD_MMC.begin("/sdcard", true)) {
    logLine("[SD] Mount failed");
    return false;
  }

  uint8_t cardType = SD_MMC.cardType();
  if (cardType == CARD_NONE) {
    logLine("[SD] No card detected");
    return false;
  }

  ensureDir("/flights");
  logf("[SD] Ready, size=%llu MB", SD_MMC.cardSize() / (1024ULL * 1024ULL));
  return true;
}

// ------------------------------------------------------------
// Flight helpers
// ------------------------------------------------------------
String generateLocalFlightId() {
  uint64_t chipId = ESP.getEfuseMac();
  char buffer[48];
  snprintf(buffer, sizeof(buffer), "flight-%04X-%lu", (uint16_t)(chipId & 0xFFFF), millis());
  return String(buffer);
}

bool startNewFlight() {
  if (captureEnabled) {
    return false;
  }

  localFlightId = generateLocalFlightId();
  remoteFlightId = "";
  nextPatchIndex = 1;
  uploadComplete = false;
  uploadMessage = "capture-ready";

  if (!ensureDir(flightRootPath())) {
    logLine("[FLIGHT] Could not create flight directory");
    return false;
  }

  savePreferences();
  saveManifest();
  logf("[FLIGHT] Started %s", localFlightId.c_str());
  return true;
}

bool savePatchMetadata(
  int patchIndex,
  const String &capturedAt,
  bool uploaded
) {
  DynamicJsonDocument doc(512);
  doc["patch_index"] = patchIndex;
  doc["captured_at"] = capturedAt;
  doc["uploaded"] = uploaded;
  fillGpsJson(doc);

  if (SD_MMC.exists(patchMetaPath(patchIndex))) {
    SD_MMC.remove(patchMetaPath(patchIndex));
  }
  File file = SD_MMC.open(patchMetaPath(patchIndex), FILE_WRITE);
  if (!file) {
    logLine("[SD] Failed to open patch metadata file");
    return false;
  }
  if (serializeJsonPretty(doc, file) == 0) {
    file.close();
    return false;
  }
  file.close();
  return true;
}

bool loadPatchMetadata(int patchIndex, DynamicJsonDocument &doc) {
  File file = SD_MMC.open(patchMetaPath(patchIndex), FILE_READ);
  if (!file) {
    return false;
  }
  DeserializationError err = deserializeJson(doc, file);
  file.close();
  return !err;
}

bool markPatchUploaded(int patchIndex) {
  DynamicJsonDocument doc(512);
  if (!loadPatchMetadata(patchIndex, doc)) {
    return false;
  }
  doc["uploaded"] = true;

  if (SD_MMC.exists(patchMetaPath(patchIndex))) {
    SD_MMC.remove(patchMetaPath(patchIndex));
  }
  File file = SD_MMC.open(patchMetaPath(patchIndex), FILE_WRITE);
  if (!file) {
    return false;
  }
  if (serializeJsonPretty(doc, file) == 0) {
    file.close();
    return false;
  }
  file.close();
  return true;
}

bool capturePatchToSD() {
  if (localFlightId.isEmpty() && !startNewFlight()) {
    return false;
  }

  if (streamActive || uploadInProgress) {
    uploadMessage = "busy";
    return false;
  }

  captureBusy = true;
  setCaptureMode();
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    setPreviewMode();
    captureBusy = false;
    logLine("[CAPTURE] Frame capture failed");
    return false;
  }

  String imagePath = patchImagePath(nextPatchIndex);
  File file = SD_MMC.open(imagePath, FILE_WRITE);
  if (!file) {
    esp_camera_fb_return(fb);
    setPreviewMode();
    captureBusy = false;
    logLine("[SD] Failed to open image file");
    return false;
  }

  size_t written = file.write(fb->buf, fb->len);
  file.close();
  esp_camera_fb_return(fb);
  setPreviewMode();
  captureBusy = false;

  if (written == 0) {
    logLine("[SD] Failed to write image bytes");
    return false;
  }

  String capturedAt = gpsTimestampOrFallback();
  if (!savePatchMetadata(nextPatchIndex, capturedAt, false)) {
    logLine("[SD] Failed to write metadata");
    return false;
  }

  logf("[CAPTURE] Saved patch %d -> %s", nextPatchIndex, imagePath.c_str());
  nextPatchIndex++;
  savePreferences();
  saveManifest();
  return true;
}

// ------------------------------------------------------------
// Backend upload helpers
// ------------------------------------------------------------
bool wakeBackend() {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(20000);

  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(20000);
  if (!http.begin(client, String(BACKEND_BASE_URL))) {
    return false;
  }
  int code = http.GET();
  http.end();
  return code > 0;
}

bool createRemoteFlight() {
  if (!remoteFlightId.isEmpty()) {
    return true;
  }

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(30000);

  HTTPClient http;
  http.setConnectTimeout(15000);
  http.setTimeout(30000);
  if (!http.begin(client, String(BACKEND_BASE_URL) + "/v1/flights")) {
    uploadMessage = "flight-create-begin-failed";
    return false;
  }

  DynamicJsonDocument req(256);
  req["device_id"] = DEVICE_ID;
  req["field_id"] = FIELD_ID;
  req["crop_type"] = CROP_TYPE;
  req["operator_notes"] = "esp32 post-flight upload";

  String body;
  serializeJson(req, body);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  String response = http.getString();
  http.end();

  if (code != 200) {
    uploadMessage = "flight-create-http-" + String(code);
    logf("[UPLOAD] Flight create failed: %d %s", code, response.c_str());
    return false;
  }

  DynamicJsonDocument doc(512);
  if (deserializeJson(doc, response)) {
    uploadMessage = "flight-create-json-error";
    return false;
  }

  remoteFlightId = String((const char *)doc["flight_id"]);
  uploadMessage = "remote-flight-created";
  savePreferences();
  saveManifest();
  logf("[UPLOAD] Remote flight created: %s", remoteFlightId.c_str());
  return !remoteFlightId.isEmpty();
}

bool uploadPatchFile(int patchIndex) {
  DynamicJsonDocument meta(512);
  if (!loadPatchMetadata(patchIndex, meta)) {
    logf("[UPLOAD] Missing metadata for patch %d", patchIndex);
    return false;
  }
  if (meta["uploaded"] == true) {
    return true;
  }

  String imagePath = patchImagePath(patchIndex);
  File file = SD_MMC.open(imagePath, FILE_READ);
  if (!file) {
    logf("[UPLOAD] Missing image for patch %d", patchIndex);
    return false;
  }

  size_t fileSize = file.size();
  String boundary = "----AgriDroneBoundary";
  String bodyStart =
    "--" + boundary + "\r\n"
    "Content-Disposition: form-data; name=\"image\"; filename=\"patch.jpg\"\r\n"
    "Content-Type: image/jpeg\r\n\r\n";

  String fields =
    "\r\n--" + boundary + "\r\n"
    "Content-Disposition: form-data; name=\"patch_index\"\r\n\r\n" + String(patchIndex) +
    "\r\n--" + boundary + "\r\n"
    "Content-Disposition: form-data; name=\"captured_at\"\r\n\r\n" + String(meta["captured_at"] | "unknown") +
    "\r\n--" + boundary + "\r\n"
    "Content-Disposition: form-data; name=\"gps_fix\"\r\n\r\n" + String(meta["gps_fix"] == true ? "true" : "false");

  if (!meta["lat"].isNull()) {
    fields += "\r\n--" + boundary + "\r\n"
              "Content-Disposition: form-data; name=\"lat\"\r\n\r\n" + String(meta["lat"].as<double>(), 6);
  }
  if (!meta["lon"].isNull()) {
    fields += "\r\n--" + boundary + "\r\n"
              "Content-Disposition: form-data; name=\"lon\"\r\n\r\n" + String(meta["lon"].as<double>(), 6);
  }
  if (!meta["altitude_m"].isNull()) {
    fields += "\r\n--" + boundary + "\r\n"
              "Content-Disposition: form-data; name=\"altitude_m\"\r\n\r\n" + String(meta["altitude_m"].as<double>(), 2);
  }
  if (!meta["heading_deg"].isNull()) {
    fields += "\r\n--" + boundary + "\r\n"
              "Content-Disposition: form-data; name=\"heading_deg\"\r\n\r\n" + String(meta["heading_deg"].as<double>(), 2);
  }

  String bodyEnd = "\r\n--" + boundary + "--\r\n";
  size_t totalLen = bodyStart.length() + fileSize + fields.length() + bodyEnd.length();
  uint8_t *body = (uint8_t *)(hasPsram ? ps_malloc(totalLen) : malloc(totalLen));
  if (!body) {
    file.close();
    logLine("[UPLOAD] Multipart allocation failed");
    return false;
  }

  size_t offset = 0;
  memcpy(body + offset, bodyStart.c_str(), bodyStart.length());
  offset += bodyStart.length();
  size_t readBytes = file.read(body + offset, fileSize);
  if (readBytes != fileSize) {
    free(body);
    file.close();
    logLine("[UPLOAD] Image read failed");
    return false;
  }
  offset += readBytes;
  file.close();
  memcpy(body + offset, fields.c_str(), fields.length());
  offset += fields.length();
  memcpy(body + offset, bodyEnd.c_str(), bodyEnd.length());
  offset += bodyEnd.length();

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(45000);

  HTTPClient http;
  http.setConnectTimeout(15000);
  http.setTimeout(45000);
  String url = String(BACKEND_BASE_URL) + "/v1/flights/" + remoteFlightId + "/images";
  if (!http.begin(client, url)) {
    free(body);
    uploadMessage = "upload-begin-failed";
    return false;
  }

  http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
  int code = http.POST(body, offset);
  String response = http.getString();
  http.end();
  free(body);

  if (code != 200) {
    uploadMessage = "patch-upload-http-" + String(code);
    logf("[UPLOAD] Patch %d failed: %d %s", patchIndex, code, response.c_str());
    return false;
  }

  if (!markPatchUploaded(patchIndex)) {
    uploadMessage = "patch-mark-uploaded-failed";
    return false;
  }

  uploadMessage = "uploaded-patch-" + String(patchIndex);
  return true;
}

bool completeRemoteFlight() {
  if (remoteFlightId.isEmpty()) {
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(30000);

  HTTPClient http;
  http.setConnectTimeout(15000);
  http.setTimeout(30000);
  String url = String(BACKEND_BASE_URL) + "/v1/flights/" + remoteFlightId + "/complete";
  if (!http.begin(client, url)) {
    uploadMessage = "complete-begin-failed";
    return false;
  }

  int code = http.POST("");
  String response = http.getString();
  http.end();
  if (code != 200) {
    uploadMessage = "complete-http-" + String(code);
    logf("[UPLOAD] Complete failed: %d %s", code, response.c_str());
    return false;
  }

  uploadComplete = true;
  captureEnabled = false;
  uploadMessage = "queued-for-backend-processing";
  savePreferences();
  saveManifest();
  return true;
}

void uploadCurrentFlight() {
  if (uploadInProgress || localFlightId.isEmpty()) {
    return;
  }
  if (streamActive) {
    uploadMessage = "close-stream-before-upload";
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    uploadMessage = "wifi-disconnected";
    return;
  }

  uploadInProgress = true;
  captureEnabled = false;
  savePreferences();
  saveManifest();

  wakeBackend();
  if (!createRemoteFlight()) {
    uploadInProgress = false;
    return;
  }

  for (int i = 1; i < nextPatchIndex; i++) {
    pumpGPS();
    if (!SD_MMC.exists(patchImagePath(i))) {
      continue;
    }
    if (!uploadPatchFile(i)) {
      uploadInProgress = false;
      saveManifest();
      return;
    }
    delay(500);
  }

  completeRemoteFlight();
  uploadInProgress = false;
}

// ------------------------------------------------------------
// HTTP handlers
// ------------------------------------------------------------
#define PART_BOUNDARY "123456789000000000000987654321"
static const char *STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char *STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static esp_err_t stream_handler(httpd_req_t *req) {
  char partBuf[64];
  esp_err_t res = ESP_OK;

  streamActive = true;
  setPreviewMode();

  httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-cache, no-store");

  TickType_t lastFrame = xTaskGetTickCount();
  while (true) {
    if (captureBusy || uploadInProgress) {
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

    vTaskDelayUntil(&lastFrame, pdMS_TO_TICKS(PREVIEW_INTERVAL_MS));
  }

  streamActive = false;
  return res;
}

static esp_err_t capture_handler(httpd_req_t *req) {
  if (captureBusy) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  setPreviewMode();
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

String buildStatusJson() {
  DynamicJsonDocument doc(1024);
  doc["device_id"] = DEVICE_ID;
  doc["field_id"] = FIELD_ID;
  doc["crop_type"] = CROP_TYPE;
  doc["local_flight_id"] = localFlightId;
  doc["remote_flight_id"] = remoteFlightId;
  doc["next_patch_index"] = nextPatchIndex;
  doc["capture_enabled"] = captureEnabled;
  doc["upload_in_progress"] = uploadInProgress;
  doc["upload_complete"] = uploadComplete;
  doc["upload_message"] = uploadMessage;
  doc["wifi_connected"] = WiFi.status() == WL_CONNECTED;
  doc["ip"] = WiFi.localIP().toString();
  doc["gps_fix"] = gps.location.isValid();
  if (gps.location.isValid()) {
    doc["lat"] = gps.location.lat();
    doc["lon"] = gps.location.lng();
  }
  if (gps.altitude.isValid()) {
    doc["altitude_m"] = gps.altitude.meters();
  }

  String body;
  serializeJson(doc, body);
  return body;
}

static esp_err_t status_handler(httpd_req_t *req) {
  String body = buildStatusJson();
  httpd_resp_set_type(req, "application/json");
  return httpd_resp_send(req, body.c_str(), body.length());
}

static esp_err_t start_flight_handler(httpd_req_t *req) {
  bool ok = startNewFlight();
  if (ok) {
    captureEnabled = true;
    savePreferences();
    saveManifest();
  }
  String body = ok ? "{\"ok\":true}" : "{\"ok\":false}";
  httpd_resp_set_type(req, "application/json");
  return httpd_resp_send(req, body.c_str(), body.length());
}

static esp_err_t stop_flight_handler(httpd_req_t *req) {
  captureEnabled = false;
  savePreferences();
  saveManifest();
  const char *body = "{\"ok\":true}";
  httpd_resp_set_type(req, "application/json");
  return httpd_resp_send(req, body, strlen(body));
}

static esp_err_t capture_patch_handler(httpd_req_t *req) {
  captureRequested = true;
  const char *body = "{\"ok\":true}";
  httpd_resp_set_type(req, "application/json");
  return httpd_resp_send(req, body, strlen(body));
}

static esp_err_t upload_handler(httpd_req_t *req) {
  uploadRequested = true;
  const char *body = "{\"ok\":true}";
  httpd_resp_set_type(req, "application/json");
  return httpd_resp_send(req, body, strlen(body));
}

static esp_err_t index_handler(httpd_req_t *req) {
  String html;
  html.reserve(2600);
  html += "<!doctype html><html><head>";
  html += "<meta charset='utf-8'>";
  html += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>AgriDrone Guardian</title>";
  html += "<style>";
  html += "body{background:#0a0f0d;color:#4ade80;font-family:monospace;padding:20px;margin:0}";
  html += "h2{font-size:1.2rem;letter-spacing:0.2em;margin-bottom:12px}";
  html += "img{width:100%;max-width:760px;display:block;border:1px solid #1a4a2a}";
  html += ".bar{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}";
  html += "button,a{background:none;color:#4ade80;border:1px solid #4ade80;padding:7px 14px;text-decoration:none;font:inherit;cursor:pointer}";
  html += "pre{margin-top:14px;padding:12px;border:1px solid #15371f;background:#0d1512;white-space:pre-wrap}";
  html += "</style></head><body>";
  html += "<h2>AGRIDRONE GUARDIAN</h2>";
  html += "<img id='snap' alt='snapshot'>";
  html += "<div class='bar'>";
  html += "<button onclick='callApi(`/api/flight/start`)'>START FLIGHT</button>";
  html += "<button onclick='callApi(`/api/patch/capture`)'>CAPTURE PATCH</button>";
  html += "<button onclick='callApi(`/api/flight/stop`)'>STOP FLIGHT</button>";
  html += "<button onclick='callApi(`/api/upload`)'>UPLOAD BATCH</button>";
  html += "<button onclick='loadStill()'>REFRESH SNAPSHOT</button>";
  html += "<a href='/stream' target='_blank'>RAW STREAM</a>";
  html += "<a href='/capture' target='_blank'>SNAPSHOT</a>";
  html += "</div>";
  html += "<pre id='status'>loading...</pre>";
  html += "<script>";
  html += "const snap=document.getElementById('snap');";
  html += "const statusEl=document.getElementById('status');";
  html += "function loadStill(){snap.src='/capture?t='+Date.now();}";
  html += "async function refresh(){const res=await fetch('/api/status');statusEl.textContent=await res.text();}";
  html += "async function callApi(path){await fetch(path,{method:'POST'});await refresh();loadStill();}";
  html += "setInterval(refresh,5000);";
  html += "refresh();";
  html += "setTimeout(loadStill,250);";
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
  config.max_uri_handlers = 12;
  config.stack_size = 16384;

  httpd_uri_t r_index = {"/", HTTP_GET, index_handler, NULL};
  httpd_uri_t r_capture = {"/capture", HTTP_GET, capture_handler, NULL};
  httpd_uri_t r_stream = {"/stream", HTTP_GET, stream_handler, NULL};
  httpd_uri_t r_status = {"/api/status", HTTP_GET, status_handler, NULL};
  httpd_uri_t r_start = {"/api/flight/start", HTTP_POST, start_flight_handler, NULL};
  httpd_uri_t r_stop = {"/api/flight/stop", HTTP_POST, stop_flight_handler, NULL};
  httpd_uri_t r_patch = {"/api/patch/capture", HTTP_POST, capture_patch_handler, NULL};
  httpd_uri_t r_upload = {"/api/upload", HTTP_POST, upload_handler, NULL};

  if (httpd_start(&camera_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(camera_httpd, &r_index);
    httpd_register_uri_handler(camera_httpd, &r_capture);
    httpd_register_uri_handler(camera_httpd, &r_stream);
    httpd_register_uri_handler(camera_httpd, &r_status);
    httpd_register_uri_handler(camera_httpd, &r_start);
    httpd_register_uri_handler(camera_httpd, &r_stop);
    httpd_register_uri_handler(camera_httpd, &r_patch);
    httpd_register_uri_handler(camera_httpd, &r_upload);
    logf("[HTTP] Ready -> http://%s:%d/", WiFi.localIP().toString().c_str(), SERVER_PORT);
  } else {
    logLine("[HTTP] Server start failed");
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
    logLine("[WiFi] Settings cleared");
    delay(500);
  }

  WiFiManager wm;
  wm.setConfigPortalTimeout(180);
  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);

  if (!wm.autoConnect(AP_NAME, AP_PASSWORD)) {
    logLine("[WiFi] Failed - restarting");
    delay(3000);
    ESP.restart();
  }

  int ipWait = 0;
  while (WiFi.localIP().toString() == "0.0.0.0" && ipWait < 20) {
    delay(500);
    ipWait++;
  }
  logf("[WiFi] Connected -> %s", WiFi.localIP().toString().c_str());
}

// ------------------------------------------------------------
// Setup / loop
// ------------------------------------------------------------
void setup() {
#if DEBUG_SERIAL_ENABLED
  Serial.begin(115200);
  delay(800);
#endif

  logLine("=== AgriDrone Guardian | Post-flight batch mode ===");

  loadPreferences();
  initGPS();
  startWiFi();

  if (!initCamera()) {
    logLine("[BOOT] Camera init failed");
    while (true) {
      delay(1000);
    }
  }

  if (!initSDCard()) {
    logLine("[BOOT] SD init failed");
    while (true) {
      delay(1000);
    }
  }

  if (!localFlightId.isEmpty()) {
    ensureDir(flightRootPath());
    saveManifest();
    logf("[BOOT] Restored local flight %s", localFlightId.c_str());
  }

  startCameraServer();
}

void loop() {
  pumpGPS();

  if (captureEnabled && !uploadInProgress && millis() - lastCaptureMs >= FLIGHT_CAPTURE_INTERVAL_MS) {
    lastCaptureMs = millis();
    capturePatchToSD();
  }

  if (captureRequested) {
    captureRequested = false;
    capturePatchToSD();
  }

  if (uploadRequested) {
    uploadRequested = false;
    uploadCurrentFlight();
  }

  delay(20);
}
