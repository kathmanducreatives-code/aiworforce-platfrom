#include <Arduino.h>
#line 1 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
#include "esp_camera.h"
#include "esp_http_server.h"
#include "esp32-hal-psram.h"
#include <ArduinoOTA.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <HardwareSerial.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <stdarg.h>

// ============================================================
//  AgriDrone Guardian | Production v1 batch firmware
//  AI Thinker ESP32-CAM + OV5640 + LittleFS + GPS + Battery
//
//  Production direction:
//  - One canonical firmware target
//  - Post-flight batch upload to /v1/flights
//  - Lab-only manual inference stays in the app, not on-device
//  - GPIO0 reserved for camera XCLK and boot strapping only
//  - DIO flash mode only for this board
// ============================================================

// ------------------------------------------------------------
// Camera pins (AI Thinker)
// ------------------------------------------------------------
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

// ------------------------------------------------------------
// Device config
// ------------------------------------------------------------
#define SERVER_PORT 81
#define AP_NAME "AgriDrone-Setup"
#define AP_PASSWORD "12345678"
#define DEVICE_ID "esp32-drone-01"
#define FIELD_ID "field-alpha"
#define CROP_TYPE "rice"
#define BACKEND_BASE_URL "https://agridrone-api.onrender.com"
#define OTA_HOSTNAME "agridrone"
#define OTA_PASSWORD "agridrone123"
#define OTA_PORT 3232
#define OTA_TIMEOUT_MS 15000

#define WIFI_CONNECT_TIMEOUT_MS 20000UL
#define FLIGHT_CAPTURE_INTERVAL_MS 6000UL
#define BATTERY_SAMPLE_INTERVAL_MS 15000UL
#define MAX_PATCHES_FLASH 6

// ------------------------------------------------------------
// Battery ADC
// ------------------------------------------------------------
#define BATT_PIN 33
#define BATT_R1 100000.0f
#define BATT_R2 33000.0f
#define BATT_FULL 12.6f
#define BATT_EMPTY 10.5f

// ------------------------------------------------------------
// GPS
// ------------------------------------------------------------
#define GPS_ENABLED 0

#if GPS_ENABLED
  #include <TinyGPS++.h>
#endif

#define GPS_BAUD_RATE 9600
#define GPS_RX_PIN 13
#define GPS_TX_PIN -1

// ------------------------------------------------------------
// Camera tuning
// ------------------------------------------------------------
static const framesize_t PREVIEW_SIZE = FRAMESIZE_VGA;
static const framesize_t CAPTURE_SIZE = FRAMESIZE_SVGA;
static const int PREVIEW_JPEG_QUALITY = 18;
static const int CAPTURE_JPEG_QUALITY = 10;
static const uint32_t STREAM_FRAME_INTERVAL_MS = 350;
static const uint32_t XCLK_OV2640_HZ = 20000000;
static const uint32_t XCLK_OV5640_HZ = 16000000;

// ------------------------------------------------------------
// Stream constants
// ------------------------------------------------------------
#define PART_BOUNDARY "123456789000000000000987654321"
static const char *STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char *STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

enum DeviceMode {
  MODE_BOOT,
  MODE_PROVISIONING_AP,
  MODE_IDLE_READY,
  MODE_FLIGHT_ACTIVE,
  MODE_PATCH_CAPTURE,
  MODE_POST_FLIGHT_UPLOAD,
  MODE_BACKEND_QUEUED,
  MODE_ERROR_RECOVERY,
};

struct CamConfig {
  int quality = CAPTURE_JPEG_QUALITY;
  int brightness = 1;
  int contrast = 1;
  int saturation = 0;
  int sharpness = 2;
  bool vflip = false;
  bool hmirror = false;
  int framesize = CAPTURE_SIZE;
};

struct BattData {
  float voltage = 0.0f;
  int percent = 0;
  bool low = false;
};

// ------------------------------------------------------------
// Globals
// ------------------------------------------------------------
httpd_handle_t camera_httpd = NULL;
HardwareSerial GPSSerial(1);
Preferences prefs;

#if GPS_ENABLED
TinyGPSPlus gps;
#endif

bool hasPsram = false;
bool provisioningMode = false;
bool wifiConnected = false;
bool streamActive = false;
bool captureBusy = false;
bool captureRequested = false;
bool uploadRequested = false;
bool captureEnabled = false;
bool uploadInProgress = false;
bool uploadComplete = false;
bool otaReady = false;

DeviceMode currentMode = MODE_BOOT;
CamConfig camCfg;
BattData batt;

String localFlightId = "";
String remoteFlightId = "";
String uploadMessage = "idle";
String lastErrorMessage = "";
String sensorPidHex = "unknown";
String sensorName = "unknown";
String httpServerIp = "";

int nextPatchIndex = 1;
unsigned long lastCaptureMs = 0;
unsigned long lastBatterySampleMs = 0;

// ------------------------------------------------------------
// Logging
// ------------------------------------------------------------
#line 178 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void logLine(const String &message);
#line 182 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void logf(const char *fmt, ...);
#line 194 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
const char * modeName(DeviceMode mode);
#line 223 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void enterErrorState(const String &message);
#line 230 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void refreshModeFromState();
#line 253 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void setupOTA();
#line 283 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
String manifestPath();
#line 287 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
String patchImagePath(int patchIndex);
#line 293 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
String patchMetaPath(int patchIndex);
#line 299 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void removeIfExists(const String &path);
#line 305 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void clearStoredPatchFiles();
#line 312 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void clearStoredFlight();
#line 317 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
int recalculatePatchIndexFromStorage();
#line 339 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void savePreferences();
#line 348 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void loadPreferences();
#line 358 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool saveManifest();
#line 390 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void loadManifest();
#line 453 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
int percentFromVoltage(float voltage);
#line 457 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void readBattery();
#line 468 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void initGPS();
#line 477 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void pumpGPS();
#line 485 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
String gpsTimestampOrFallback();
#line 505 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void fillGpsJson(JsonDocument &doc);
#line 527 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void discardFrames(uint8_t count, uint16_t pauseMs);
#line 537 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void applyCameraConfig(sensor_t *sensor);
#line 567 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
framesize_t effectivePreviewSize();
#line 577 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
framesize_t effectiveCaptureSize();
#line 587 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
int effectivePreviewQuality();
#line 594 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
int effectiveCaptureQuality();
#line 601 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void setPreviewMode();
#line 628 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool identifySensor(sensor_t *sensor);
#line 654 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool tryInitCameraWithXclk(uint32_t xclkHz, const char *label);
#line 710 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool initCamera();
#line 752 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool initLittleFS();
#line 761 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool savePatchMetadata(int patchIndex, const String &capturedAt, bool uploaded);
#line 781 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool loadPatchMetadata(int patchIndex, DynamicJsonDocument &doc);
#line 791 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool markPatchUploaded(int patchIndex);
#line 814 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
String generateLocalFlightId();
#line 821 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool startNewFlight();
#line 842 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool capturePatchToFlash();
#line 917 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool wakeBackend();
#line 934 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool createRemoteFlight();
#line 984 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool uploadPatchFile(int patchIndex);
#line 1094 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool completeRemoteFlight();
#line 1136 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void uploadCurrentFlight();
#line 1187 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void setCorsHeaders(httpd_req_t *req);
#line 1193 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void appendCameraConfig(JsonDocument &doc);
#line 1204 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
String currentSsid();
#line 1211 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
String buildStatusJson();
#line 1302 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t stream_handler(httpd_req_t *req);
#line 1348 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t capture_handler(httpd_req_t *req);
#line 1389 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t status_handler(httpd_req_t *req);
#line 1396 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t control_handler(httpd_req_t *req);
#line 1442 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t start_flight_handler(httpd_req_t *req);
#line 1450 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t stop_flight_handler(httpd_req_t *req);
#line 1461 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t capture_patch_handler(httpd_req_t *req);
#line 1469 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t upload_handler(httpd_req_t *req);
#line 1477 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
static esp_err_t index_handler(httpd_req_t *req);
#line 1522 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void stopCameraServer();
#line 1531 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void startCameraServer();
#line 1573 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void ensureCameraServer();
#line 1592 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
bool connectWithSavedCredentials();
#line 1606 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void startProvisioningPortal();
#line 1627 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void startWiFi();
#line 1646 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void setup();
#line 1685 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void loop();
#line 178 "/Users/prasidha/screeningpilot/screeningpilot/docs/agridrone/AgriDrone/AgriDrone.ino"
void logLine(const String &message) {
  Serial.println(message);
}

void logf(const char *fmt, ...) {
  char buffer[256];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);
  Serial.println(buffer);
}

// ------------------------------------------------------------
// Mode helpers
// ------------------------------------------------------------
const char *modeName(DeviceMode mode) {
  switch (mode) {
    case MODE_BOOT:
      return "BOOT";
    case MODE_PROVISIONING_AP:
      return "PROVISIONING_AP";
    case MODE_IDLE_READY:
      return "IDLE_READY";
    case MODE_FLIGHT_ACTIVE:
      return "FLIGHT_ACTIVE";
    case MODE_PATCH_CAPTURE:
      return "PATCH_CAPTURE";
    case MODE_POST_FLIGHT_UPLOAD:
      return "POST_FLIGHT_UPLOAD";
    case MODE_BACKEND_QUEUED:
      return "BACKEND_QUEUED";
    case MODE_ERROR_RECOVERY:
      return "ERROR_RECOVERY";
  }
  return "UNKNOWN";
}

void setMode(DeviceMode mode, const String &reason = "") {
  currentMode = mode;
  if (mode != MODE_ERROR_RECOVERY && !reason.isEmpty()) {
    lastErrorMessage = "";
  }
}

void enterErrorState(const String &message) {
  lastErrorMessage = message;
  currentMode = MODE_ERROR_RECOVERY;
  uploadMessage = message;
  logf("[ERROR] %s", message.c_str());
}

void refreshModeFromState() {
  if (currentMode == MODE_ERROR_RECOVERY && !lastErrorMessage.isEmpty()) {
    return;
  }

  if (provisioningMode) {
    currentMode = MODE_PROVISIONING_AP;
  } else if (captureBusy) {
    currentMode = MODE_PATCH_CAPTURE;
  } else if (uploadInProgress) {
    currentMode = MODE_POST_FLIGHT_UPLOAD;
  } else if (uploadComplete && !remoteFlightId.isEmpty()) {
    currentMode = MODE_BACKEND_QUEUED;
  } else if (captureEnabled || (!localFlightId.isEmpty() && nextPatchIndex > 1 && !uploadComplete)) {
    currentMode = MODE_FLIGHT_ACTIVE;
  } else {
    currentMode = MODE_IDLE_READY;
  }
}

// ------------------------------------------------------------
// OTA
// ------------------------------------------------------------
void setupOTA() {
  ArduinoOTA.setPort(OTA_PORT);
  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASSWORD);
  ArduinoOTA.setTimeout(OTA_TIMEOUT_MS);
  ArduinoOTA.setMdnsEnabled(false);

  ArduinoOTA.onStart([]() {
    logLine("[OTA] Starting update...");
  });
  ArduinoOTA.onEnd([]() {
    logLine("[OTA] Done - rebooting");
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    const unsigned int percent =
      total == 0 ? 0 : (unsigned int)((progress * 100U) / total);
    Serial.printf("[OTA] %u%%\n", percent);
  });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("[OTA] Error: %u\n", error);
  });

  ArduinoOTA.begin();
  otaReady = true;
  logf("[OTA] Ready -> %s.local:%d", OTA_HOSTNAME, OTA_PORT);
}

// ------------------------------------------------------------
// Path helpers
// ------------------------------------------------------------
String manifestPath() {
  return "/manifest.json";
}

String patchImagePath(int patchIndex) {
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "/patch-%05d.jpg", patchIndex);
  return String(buffer);
}

String patchMetaPath(int patchIndex) {
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "/patch-%05d.json", patchIndex);
  return String(buffer);
}

void removeIfExists(const String &path) {
  if (LittleFS.exists(path)) {
    LittleFS.remove(path);
  }
}

void clearStoredPatchFiles() {
  for (int i = 1; i <= MAX_PATCHES_FLASH; i++) {
    removeIfExists(patchImagePath(i));
    removeIfExists(patchMetaPath(i));
  }
}

void clearStoredFlight() {
  removeIfExists(manifestPath());
  clearStoredPatchFiles();
}

int recalculatePatchIndexFromStorage() {
  int nextIndex = 1;
  for (int i = 1; i <= MAX_PATCHES_FLASH; i++) {
    if (LittleFS.exists(patchImagePath(i))) {
      nextIndex = i + 1;
    }
  }
  return constrain(nextIndex, 1, MAX_PATCHES_FLASH + 1);
}

void pauseCaptureForFullBuffer(const String &reason = "flash-buffer-full-upload-now") {
  captureEnabled = false;
  uploadComplete = false;
  uploadMessage = reason;
  refreshModeFromState();
  savePreferences();
  saveManifest();
}

// ------------------------------------------------------------
// Preferences + manifest
// ------------------------------------------------------------
void savePreferences() {
  prefs.putString("local_id", localFlightId);
  prefs.putString("remote_id", remoteFlightId);
  prefs.putInt("next_patch", nextPatchIndex);
  prefs.putBool("capture_on", captureEnabled);
  prefs.putBool("upload_done", uploadComplete);
  prefs.putString("upload_msg", uploadMessage);
}

void loadPreferences() {
  prefs.begin("agridrone", false);
  localFlightId = prefs.getString("local_id", "");
  remoteFlightId = prefs.getString("remote_id", "");
  nextPatchIndex = prefs.getInt("next_patch", 1);
  captureEnabled = prefs.getBool("capture_on", false);
  uploadComplete = prefs.getBool("upload_done", false);
  uploadMessage = prefs.getString("upload_msg", "idle");
}

bool saveManifest() {
  DynamicJsonDocument doc(1536);
  doc["mode"] = modeName(currentMode);
  doc["local_flight_id"] = localFlightId;
  doc["remote_flight_id"] = remoteFlightId;
  doc["device_id"] = DEVICE_ID;
  doc["field_id"] = FIELD_ID;
  doc["crop_type"] = CROP_TYPE;
  doc["next_patch_index"] = nextPatchIndex;
  doc["capture_enabled"] = captureEnabled;
  doc["upload_complete"] = uploadComplete;
  doc["upload_message"] = uploadMessage;
  doc["max_patches_flash"] = MAX_PATCHES_FLASH;
  doc["flash_total_bytes"] = LittleFS.totalBytes();
  doc["flash_used_bytes"] = LittleFS.usedBytes();
  doc["updated_at_ms"] = millis();

  removeIfExists(manifestPath());
  File file = LittleFS.open(manifestPath(), "w");
  if (!file) {
    logLine("[FS] Failed to open manifest");
    return false;
  }
  if (serializeJsonPretty(doc, file) == 0) {
    file.close();
    logLine("[FS] Failed to write manifest");
    return false;
  }
  file.close();
  return true;
}

void loadManifest() {
  if (!LittleFS.exists(manifestPath())) {
    nextPatchIndex = recalculatePatchIndexFromStorage();
    if (captureEnabled && nextPatchIndex > MAX_PATCHES_FLASH) {
      pauseCaptureForFullBuffer();
      logLine("[FS] Restored full patch buffer - upload required");
    }
    return;
  }

  File file = LittleFS.open(manifestPath(), "r");
  if (!file) {
    nextPatchIndex = recalculatePatchIndexFromStorage();
    if (captureEnabled && nextPatchIndex > MAX_PATCHES_FLASH) {
      pauseCaptureForFullBuffer();
      logLine("[FS] Restored full patch buffer - upload required");
    }
    return;
  }

  DynamicJsonDocument doc(1536);
  DeserializationError err = deserializeJson(doc, file);
  file.close();
  if (err) {
    logLine("[FS] Manifest parse failed");
    nextPatchIndex = recalculatePatchIndexFromStorage();
    return;
  }

  String manifestLocalId = String(doc["local_flight_id"] | "");
  if (manifestLocalId.isEmpty()) {
    manifestLocalId = localFlightId;
  }
  localFlightId = manifestLocalId;

  String manifestRemoteId = String(doc["remote_flight_id"] | "");
  if (manifestRemoteId.isEmpty()) {
    manifestRemoteId = remoteFlightId;
  }
  remoteFlightId = manifestRemoteId;
  nextPatchIndex = doc["next_patch_index"] | nextPatchIndex;
  captureEnabled = doc["capture_enabled"] | captureEnabled;
  uploadComplete = doc["upload_complete"] | uploadComplete;
  String manifestUploadMessage = String(doc["upload_message"] | "");
  if (manifestUploadMessage.isEmpty()) {
    manifestUploadMessage = uploadMessage;
  }
  uploadMessage = manifestUploadMessage;

  int storageNextPatch = recalculatePatchIndexFromStorage();
  if (storageNextPatch > nextPatchIndex) {
    nextPatchIndex = storageNextPatch;
  }
  nextPatchIndex = constrain(nextPatchIndex, 1, MAX_PATCHES_FLASH + 1);
  if (captureEnabled && nextPatchIndex > MAX_PATCHES_FLASH) {
    pauseCaptureForFullBuffer();
    logLine("[FS] Restored full patch buffer - upload required");
  }
}

// ------------------------------------------------------------
// Battery
// ------------------------------------------------------------
int percentFromVoltage(float voltage) {
  return (int)constrain(((voltage - BATT_EMPTY) / (BATT_FULL - BATT_EMPTY)) * 100.0f, 0.0f, 100.0f);
}

void readBattery() {
  int raw = analogRead(BATT_PIN);
  float vPin = (raw / 4095.0f) * 3.3f;
  batt.voltage = vPin * ((BATT_R1 + BATT_R2) / BATT_R2);
  batt.percent = percentFromVoltage(batt.voltage);
  batt.low = batt.percent < 20;
}

// ------------------------------------------------------------
// GPS
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
      gps.time.second());
    return String(buffer);
  }
#endif
  return "boot-ms-" + String(millis());
}

void fillGpsJson(JsonDocument &doc) {
  doc["enabled"] = GPS_ENABLED == 1;
#if GPS_ENABLED
  doc["fix"] = gps.location.isValid();
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
  doc["fix"] = false;
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

void applyCameraConfig(sensor_t *sensor) {
  if (!sensor) {
    return;
  }

  sensor->set_framesize(sensor, (framesize_t)camCfg.framesize);
  sensor->set_quality(sensor, camCfg.quality);
  sensor->set_brightness(sensor, camCfg.brightness);
  sensor->set_contrast(sensor, camCfg.contrast);
  sensor->set_saturation(sensor, camCfg.saturation);
  sensor->set_sharpness(sensor, camCfg.sharpness);
  sensor->set_vflip(sensor, camCfg.vflip ? 1 : 0);
  sensor->set_hmirror(sensor, camCfg.hmirror ? 1 : 0);
  sensor->set_denoise(sensor, 0);
  sensor->set_whitebal(sensor, 1);
  sensor->set_awb_gain(sensor, 1);
  sensor->set_wb_mode(sensor, 0);
  sensor->set_exposure_ctrl(sensor, 1);
  sensor->set_aec2(sensor, 0);
  sensor->set_ae_level(sensor, 1);
  sensor->set_gain_ctrl(sensor, 1);
  sensor->set_gainceiling(sensor, GAINCEILING_32X);
  sensor->set_lenc(sensor, 1);
  sensor->set_bpc(sensor, 1);
  sensor->set_wpc(sensor, 1);
  sensor->set_raw_gma(sensor, 1);
  sensor->set_dcw(sensor, 1);
  sensor->set_special_effect(sensor, 0);
}

framesize_t effectivePreviewSize() {
  if (sensorName == "OV2640") {
    return hasPsram ? FRAMESIZE_VGA : FRAMESIZE_QVGA;
  }
  if (sensorName == "OV5640") {
    return hasPsram ? PREVIEW_SIZE : FRAMESIZE_QVGA;
  }
  return hasPsram ? PREVIEW_SIZE : FRAMESIZE_QVGA;
}

framesize_t effectiveCaptureSize() {
  if (sensorName == "OV2640") {
    return hasPsram ? FRAMESIZE_SVGA : FRAMESIZE_VGA;
  }
  if (sensorName == "OV5640") {
    return hasPsram ? CAPTURE_SIZE : FRAMESIZE_VGA;
  }
  return hasPsram ? CAPTURE_SIZE : FRAMESIZE_VGA;
}

int effectivePreviewQuality() {
  if (sensorName == "OV2640") {
    return 14;
  }
  return PREVIEW_JPEG_QUALITY;
}

int effectiveCaptureQuality() {
  if (sensorName == "OV2640") {
    return 12;
  }
  return CAPTURE_JPEG_QUALITY;
}

void setPreviewMode() {
  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor) {
    sensor->set_framesize(sensor, effectivePreviewSize());
    sensor->set_quality(sensor, effectivePreviewQuality());
    sensor->set_brightness(sensor, camCfg.brightness);
    sensor->set_contrast(sensor, camCfg.contrast);
    sensor->set_saturation(sensor, camCfg.saturation);
    sensor->set_sharpness(sensor, camCfg.sharpness);
    sensor->set_vflip(sensor, camCfg.vflip ? 1 : 0);
    sensor->set_hmirror(sensor, camCfg.hmirror ? 1 : 0);
  }
  discardFrames(2, 50);
}

void setCaptureMode(bool updateConfig = true) {
  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor) {
    if (updateConfig) {
      camCfg.framesize = effectiveCaptureSize();
      camCfg.quality = effectiveCaptureQuality();
    }
    applyCameraConfig(sensor);
  }
  discardFrames(2, 80);
}

bool identifySensor(sensor_t *sensor) {
  if (!sensor) {
    return false;
  }

  char pidBuffer[12];
  snprintf(pidBuffer, sizeof(pidBuffer), "0x%04X", sensor->id.PID);
  sensorPidHex = String(pidBuffer);
  logf("[CAM] Sensor PID: %s", sensorPidHex.c_str());

  if (sensor->id.PID == OV2640_PID) {
    sensorName = "OV2640";
    logLine("[CAM] Detected OV2640 2MP camera");
    return true;
  }
  if (sensor->id.PID == OV5640_PID) {
    sensorName = "OV5640";
    logLine("[CAM] Detected OV5640 5MP camera");
    return true;
  }

  sensorName = "unknown";
  logLine("[CAM] WARNING: Unsupported/unknown sensor PID");
  return false;
}

bool tryInitCameraWithXclk(uint32_t xclkHz, const char *label) {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = xclkHz;
  config.pixel_format = PIXFORMAT_JPEG;
  hasPsram = psramFound();
  config.frame_size = FRAMESIZE_SVGA;
  config.jpeg_quality = 10;
  config.fb_count = 1;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  if (!hasPsram) {
    config.fb_location = CAMERA_FB_IN_DRAM;
  }
  camCfg.framesize = CAPTURE_SIZE;
  camCfg.quality = CAPTURE_JPEG_QUALITY;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    logf("[CAM] Init failed on %s profile: 0x%x", label, err);
    return false;
  }

  delay(500);
  sensor_t *sensor = esp_camera_sensor_get();
  if (!sensor) {
    logLine("[CAM] Sensor unavailable");
    esp_camera_deinit();
    return false;
  }

  if (!identifySensor(sensor)) {
    esp_camera_deinit();
    return false;
  }

  return true;
}

bool initCamera() {
  sensorName = "unknown";
  sensorPidHex = "unknown";

  if (!tryInitCameraWithXclk(XCLK_OV2640_HZ, "OV2640/20MHz")) {
    if (!tryInitCameraWithXclk(XCLK_OV5640_HZ, "OV5640/16MHz")) {
      logLine("[CAM] Failed to initialise any supported camera profile");
      return false;
    }
  }

  if (sensorName == "OV5640") {
    esp_camera_deinit();
    if (!tryInitCameraWithXclk(XCLK_OV5640_HZ, "OV5640/16MHz")) {
      logLine("[CAM] OV5640 re-init on 16MHz failed");
      return false;
    }
  }

  sensor_t *sensor = esp_camera_sensor_get();
  if (!sensor) {
    logLine("[CAM] Sensor unavailable after profile init");
    return false;
  }

  if (sensorName == "OV5640") {
    sensor->set_reg(sensor, 0x3023, 0xFF, 0x01);
    sensor->set_reg(sensor, 0x3022, 0xFF, 0x08);
  }

  camCfg.framesize = effectiveCaptureSize();
  camCfg.quality = effectiveCaptureQuality();
  setCaptureMode(false);
  discardFrames(1, 100);
  setPreviewMode();
  logf("[CAM] %s ready", sensorName.c_str());
  return true;
}

// ------------------------------------------------------------
// LittleFS
// ------------------------------------------------------------
bool initLittleFS() {
  if (!LittleFS.begin(true)) {
    logLine("[FS] LittleFS mount failed");
    return false;
  }
  logf("[FS] Ready: used=%u total=%u", (unsigned int)LittleFS.usedBytes(), (unsigned int)LittleFS.totalBytes());
  return true;
}

bool savePatchMetadata(int patchIndex, const String &capturedAt, bool uploaded) {
  DynamicJsonDocument doc(768);
  doc["patch_index"] = patchIndex;
  doc["captured_at"] = capturedAt;
  doc["uploaded"] = uploaded;
  fillGpsJson(doc);

  removeIfExists(patchMetaPath(patchIndex));
  File file = LittleFS.open(patchMetaPath(patchIndex), "w");
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

bool loadPatchMetadata(int patchIndex, DynamicJsonDocument &doc) {
  File file = LittleFS.open(patchMetaPath(patchIndex), "r");
  if (!file) {
    return false;
  }
  DeserializationError err = deserializeJson(doc, file);
  file.close();
  return !err;
}

bool markPatchUploaded(int patchIndex) {
  DynamicJsonDocument doc(768);
  if (!loadPatchMetadata(patchIndex, doc)) {
    return false;
  }
  doc["uploaded"] = true;

  removeIfExists(patchMetaPath(patchIndex));
  File file = LittleFS.open(patchMetaPath(patchIndex), "w");
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
  if (uploadInProgress) {
    uploadMessage = "upload-in-progress";
    return false;
  }

  clearStoredFlight();
  localFlightId = generateLocalFlightId();
  remoteFlightId = "";
  nextPatchIndex = 1;
  uploadComplete = false;
  uploadMessage = "capture-ready";
  captureEnabled = true;
  lastErrorMessage = "";
  refreshModeFromState();
  savePreferences();
  saveManifest();
  logf("[FLIGHT] Started %s", localFlightId.c_str());
  return true;
}

bool capturePatchToFlash() {
  if (localFlightId.isEmpty() && !startNewFlight()) {
    return false;
  }

  if (nextPatchIndex > MAX_PATCHES_FLASH) {
    if (uploadMessage != "flash-buffer-full-upload-now" || captureEnabled) {
      logLine("[CAPTURE] Flash patch limit reached - upload current batch before capturing more");
    }
    pauseCaptureForFullBuffer();
    return false;
  }

  if (streamActive || uploadInProgress) {
    uploadMessage = "busy";
    return false;
  }

  captureBusy = true;
  refreshModeFromState();
  setCaptureMode();

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    setPreviewMode();
    captureBusy = false;
    refreshModeFromState();
    logLine("[CAPTURE] Frame capture failed");
    return false;
  }

  removeIfExists(patchImagePath(nextPatchIndex));
  File file = LittleFS.open(patchImagePath(nextPatchIndex), "w");
  if (!file) {
    esp_camera_fb_return(fb);
    setPreviewMode();
    captureBusy = false;
    refreshModeFromState();
    logLine("[FS] Failed to open patch image");
    return false;
  }

  size_t written = file.write(fb->buf, fb->len);
  file.close();
  esp_camera_fb_return(fb);
  setPreviewMode();
  captureBusy = false;

  if (written == 0) {
    refreshModeFromState();
    logLine("[FS] Failed to write patch image");
    return false;
  }

  String capturedAt = gpsTimestampOrFallback();
  if (!savePatchMetadata(nextPatchIndex, capturedAt, false)) {
    refreshModeFromState();
    logLine("[FS] Failed to write patch metadata");
    return false;
  }

  logf("[CAPTURE] Stored patch %d (%u bytes)", nextPatchIndex, (unsigned int)written);
  nextPatchIndex++;
  uploadComplete = false;
  uploadMessage = "patch-buffered";
  lastCaptureMs = millis();
  refreshModeFromState();
  savePreferences();
  saveManifest();
  return true;
}

// ------------------------------------------------------------
// Backend upload
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
  req["operator_notes"] = "post-flight LittleFS upload";

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
  savePreferences();
  saveManifest();
  logf("[UPLOAD] Remote flight: %s", remoteFlightId.c_str());
  return !remoteFlightId.isEmpty();
}

bool uploadPatchFile(int patchIndex) {
  DynamicJsonDocument meta(768);
  if (!loadPatchMetadata(patchIndex, meta)) {
    return false;
  }
  if (meta["uploaded"] == true) {
    return true;
  }

  File file = LittleFS.open(patchImagePath(patchIndex), "r");
  if (!file) {
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
    "Content-Disposition: form-data; name=\"gps_fix\"\r\n\r\n" + String(meta["fix"] == true ? "true" : "false");

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
    uploadMessage = "multipart-allocation-failed";
    return false;
  }

  size_t offset = 0;
  memcpy(body + offset, bodyStart.c_str(), bodyStart.length());
  offset += bodyStart.length();
  size_t readBytes = file.read(body + offset, fileSize);
  file.close();
  if (readBytes != fileSize) {
    free(body);
    uploadMessage = "image-read-failed";
    return false;
  }
  offset += readBytes;

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
    uploadMessage = "mark-uploaded-failed";
    return false;
  }

  uploadMessage = "uploaded-patch-" + String(patchIndex);
  savePreferences();
  saveManifest();
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

  clearStoredPatchFiles();
  localFlightId = "";
  nextPatchIndex = 1;
  uploadComplete = true;
  captureEnabled = false;
  uploadMessage = "queued-for-backend-processing";
  refreshModeFromState();
  savePreferences();
  saveManifest();
  logf("[UPLOAD] Local patch buffer cleared for %s", remoteFlightId.c_str());
  return true;
}

void uploadCurrentFlight() {
  if (uploadInProgress || localFlightId.isEmpty()) {
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    uploadMessage = "wifi-disconnected";
    return;
  }
  if (streamActive) {
    uploadMessage = "close-stream-before-upload";
    return;
  }

  uploadInProgress = true;
  captureEnabled = false;
  refreshModeFromState();
  savePreferences();
  saveManifest();

  wakeBackend();
  if (!createRemoteFlight()) {
    uploadInProgress = false;
    refreshModeFromState();
    saveManifest();
    return;
  }

  for (int i = 1; i < nextPatchIndex; i++) {
    pumpGPS();
    if (!LittleFS.exists(patchImagePath(i))) {
      continue;
    }
    if (!uploadPatchFile(i)) {
      uploadInProgress = false;
      refreshModeFromState();
      saveManifest();
      return;
    }
    delay(500);
  }

  completeRemoteFlight();
  uploadInProgress = false;
  refreshModeFromState();
  savePreferences();
  saveManifest();
}

// ------------------------------------------------------------
// HTTP helpers
// ------------------------------------------------------------
void setCorsHeaders(httpd_req_t *req) {
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
}

void appendCameraConfig(JsonDocument &doc) {
  doc["quality"] = camCfg.quality;
  doc["brightness"] = camCfg.brightness;
  doc["contrast"] = camCfg.contrast;
  doc["saturation"] = camCfg.saturation;
  doc["sharpness"] = camCfg.sharpness;
  doc["vflip"] = camCfg.vflip;
  doc["hmirror"] = camCfg.hmirror;
  doc["framesize"] = camCfg.framesize;
}

String currentSsid() {
  if (WiFi.status() != WL_CONNECTED) {
    return "";
  }
  return WiFi.SSID();
}

String buildStatusJson() {
  DynamicJsonDocument doc(2048);

  DynamicJsonDocument wifi(256);
  wifi["connected"] = WiFi.status() == WL_CONNECTED;
  wifi["ssid"] = currentSsid();
  wifi["ip"] = WiFi.localIP().toString();
  wifi["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -100;
  wifi["provisioning_mode"] = provisioningMode;

  DynamicJsonDocument camera(256);
  camera["sensor_pid"] = sensorPidHex;
  appendCameraConfig(camera);

  DynamicJsonDocument flight(256);
  flight["local_flight_id"] = localFlightId;
  flight["remote_flight_id"] = remoteFlightId;
  flight["capture_enabled"] = captureEnabled;
  flight["next_patch_index"] = nextPatchIndex;
  flight["max_patches_flash"] = MAX_PATCHES_FLASH;

  DynamicJsonDocument storage(128);
  storage["flash_used_bytes"] = LittleFS.usedBytes();
  storage["flash_total_bytes"] = LittleFS.totalBytes();

  DynamicJsonDocument upload(160);
  upload["upload_in_progress"] = uploadInProgress;
  upload["upload_complete"] = uploadComplete;
  upload["upload_message"] = uploadMessage;

  DynamicJsonDocument gpsDoc(256);
  fillGpsJson(gpsDoc);

  DynamicJsonDocument battery(128);
  battery["voltage"] = batt.voltage;
  battery["percent"] = batt.percent;
  battery["low"] = batt.low;

  DynamicJsonDocument ota(96);
  ota["ready"] = otaReady;
  ota["hostname"] = OTA_HOSTNAME;
  ota["port"] = OTA_PORT;

  doc["mode"] = modeName(currentMode);
  doc["wifi"] = wifi.as<JsonObject>();
  doc["camera"] = camera.as<JsonObject>();
  doc["flight"] = flight.as<JsonObject>();
  doc["storage"] = storage.as<JsonObject>();
  doc["upload"] = upload.as<JsonObject>();
  doc["gps"] = gpsDoc.as<JsonObject>();
  doc["battery"] = battery.as<JsonObject>();
  doc["ota"] = ota.as<JsonObject>();
  doc["error_message"] = lastErrorMessage;

  // Backward-compatible top-level mirrors for the current app.
  doc["device_id"] = DEVICE_ID;
  doc["field_id"] = FIELD_ID;
  doc["crop_type"] = CROP_TYPE;
  doc["local_flight_id"] = localFlightId;
  doc["remote_flight_id"] = remoteFlightId;
  doc["next_patch_index"] = nextPatchIndex;
  doc["max_patches_flash"] = MAX_PATCHES_FLASH;
  doc["capture_enabled"] = captureEnabled;
  doc["upload_in_progress"] = uploadInProgress;
  doc["upload_complete"] = uploadComplete;
  doc["upload_message"] = uploadMessage;
  doc["flash_used_bytes"] = LittleFS.usedBytes();
  doc["flash_total_bytes"] = LittleFS.totalBytes();
  doc["wifi_connected"] = wifi["connected"].as<bool>();
  doc["ip"] = wifi["ip"].as<const char *>();
  doc["sensor_pid"] = sensorPidHex;
  doc["gps_fix"] = gpsDoc["fix"].as<bool>();
  if (!gpsDoc["lat"].isNull()) {
    doc["lat"] = gpsDoc["lat"].as<double>();
  }
  if (!gpsDoc["lon"].isNull()) {
    doc["lon"] = gpsDoc["lon"].as<double>();
  }
  doc["battery_voltage"] = batt.voltage;
  doc["battery_percent"] = batt.percent;
  doc["battery_low"] = batt.low;
  doc["ota_ready"] = otaReady;
  doc["ota_hostname"] = OTA_HOSTNAME;
  doc["ota_port"] = OTA_PORT;
  appendCameraConfig(doc);

  String body;
  serializeJsonPretty(doc, body);
  return body;
}

static esp_err_t stream_handler(httpd_req_t *req) {
  char partBuf[64];
  esp_err_t res = ESP_OK;

  streamActive = true;
  setPreviewMode();

  httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  setCorsHeaders(req);
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
      size_t headerLength = snprintf(partBuf, sizeof(partBuf), STREAM_PART, fb->len);
      res = httpd_resp_send_chunk(req, partBuf, headerLength);
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
  refreshModeFromState();
  return res;
}

static esp_err_t capture_handler(httpd_req_t *req) {
  if (captureBusy || uploadInProgress) {
    httpd_resp_set_status(req, "409 Conflict");
    httpd_resp_set_type(req, "application/json");
    setCorsHeaders(req);
    httpd_resp_send(req, "{\"error\":\"camera-busy\"}", HTTPD_RESP_USE_STRLEN);
    return ESP_FAIL;
  }

  captureBusy = true;
  refreshModeFromState();
  bool wasStreaming = streamActive;
  if (!wasStreaming) {
    setCaptureMode();
  } else {
    discardFrames(1, 20);
  }
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    if (!wasStreaming) {
      setPreviewMode();
    }
    captureBusy = false;
    refreshModeFromState();
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  httpd_resp_set_type(req, "image/jpeg");
  setCorsHeaders(req);
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=snapshot.jpg");
  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  if (!wasStreaming) {
    setPreviewMode();
  }
  captureBusy = false;
  refreshModeFromState();
  return res;
}

static esp_err_t status_handler(httpd_req_t *req) {
  String body = buildStatusJson();
  httpd_resp_set_type(req, "application/json");
  setCorsHeaders(req);
  return httpd_resp_send(req, body.c_str(), body.length());
}

static esp_err_t control_handler(httpd_req_t *req) {
  char buffer[256];
  size_t length = httpd_req_get_url_query_len(req) + 1;
  if (length > 1 && length < sizeof(buffer)) {
    if (httpd_req_get_url_query_str(req, buffer, length) == ESP_OK) {
      char value[16];
      if (httpd_query_key_value(buffer, "quality", value, sizeof(value)) == ESP_OK) {
        camCfg.quality = atoi(value);
      }
      if (httpd_query_key_value(buffer, "brightness", value, sizeof(value)) == ESP_OK) {
        camCfg.brightness = atoi(value);
      }
      if (httpd_query_key_value(buffer, "contrast", value, sizeof(value)) == ESP_OK) {
        camCfg.contrast = atoi(value);
      }
      if (httpd_query_key_value(buffer, "saturation", value, sizeof(value)) == ESP_OK) {
        camCfg.saturation = atoi(value);
      }
      if (httpd_query_key_value(buffer, "sharpness", value, sizeof(value)) == ESP_OK) {
        camCfg.sharpness = atoi(value);
      }
      if (httpd_query_key_value(buffer, "vflip", value, sizeof(value)) == ESP_OK) {
        camCfg.vflip = atoi(value) == 1;
      }
      if (httpd_query_key_value(buffer, "hmirror", value, sizeof(value)) == ESP_OK) {
        camCfg.hmirror = atoi(value) == 1;
      }
      if (httpd_query_key_value(buffer, "framesize", value, sizeof(value)) == ESP_OK) {
        camCfg.framesize = atoi(value);
      }
    }
  }

  sensor_t *sensor = esp_camera_sensor_get();
  applyCameraConfig(sensor);
  discardFrames(1, 40);

  DynamicJsonDocument doc(256);
  appendCameraConfig(doc);
  String body;
  serializeJson(doc, body);
  httpd_resp_set_type(req, "application/json");
  setCorsHeaders(req);
  return httpd_resp_send(req, body.c_str(), body.length());
}

static esp_err_t start_flight_handler(httpd_req_t *req) {
  bool ok = startNewFlight();
  const char *body = ok ? "{\"ok\":true}" : "{\"ok\":false}";
  httpd_resp_set_type(req, "application/json");
  setCorsHeaders(req);
  return httpd_resp_send(req, body, strlen(body));
}

static esp_err_t stop_flight_handler(httpd_req_t *req) {
  captureEnabled = false;
  refreshModeFromState();
  savePreferences();
  saveManifest();
  const char *body = "{\"ok\":true}";
  httpd_resp_set_type(req, "application/json");
  setCorsHeaders(req);
  return httpd_resp_send(req, body, strlen(body));
}

static esp_err_t capture_patch_handler(httpd_req_t *req) {
  captureRequested = true;
  const char *body = "{\"ok\":true}";
  httpd_resp_set_type(req, "application/json");
  setCorsHeaders(req);
  return httpd_resp_send(req, body, strlen(body));
}

static esp_err_t upload_handler(httpd_req_t *req) {
  uploadRequested = true;
  const char *body = "{\"ok\":true}";
  httpd_resp_set_type(req, "application/json");
  setCorsHeaders(req);
  return httpd_resp_send(req, body, strlen(body));
}

static esp_err_t index_handler(httpd_req_t *req) {
  String html;
  html.reserve(3200);
  html += "<!doctype html><html><head>";
  html += "<meta charset='utf-8'>";
  html += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>AgriDrone Guardian</title>";
  html += "<style>";
  html += "body{background:#08110b;color:#d6f5df;font-family:ui-monospace,monospace;padding:20px;margin:0}";
  html += "h2{font-size:1.2rem;letter-spacing:0.18em;margin-bottom:12px}";
  html += "img{width:100%;max-width:760px;display:block;border:1px solid #2a7c55;border-radius:14px}";
  html += ".bar{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}";
  html += "button,a{background:#0f1d14;color:#7ae7a3;border:1px solid #2e7d5f;padding:8px 14px;text-decoration:none;font:inherit;cursor:pointer;border-radius:999px}";
  html += "pre{margin-top:14px;padding:14px;border:1px solid #203d2b;background:#0c1711;border-radius:16px;white-space:pre-wrap}";
  html += ".warn{margin-top:10px;color:#d8c56c}";
  html += "</style></head><body>";
  html += "<h2>AGRIDRONE GUARDIAN</h2>";
  html += "<div class='warn'>Production v1 batch mode · LittleFS buffer max ";
  html += String(MAX_PATCHES_FLASH);
  html += " patches.</div>";
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

void stopCameraServer() {
  if (camera_httpd != NULL) {
    httpd_stop(camera_httpd);
    camera_httpd = NULL;
  }
  httpServerIp = "";
  streamActive = false;
}

void startCameraServer() {
  if (camera_httpd != NULL) {
    stopCameraServer();
    delay(100);
  }

  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = SERVER_PORT;
  config.ctrl_port = 32768;
  config.recv_wait_timeout = 30;
  config.send_wait_timeout = 30;
  config.max_uri_handlers = 13;
  config.stack_size = 16384;

  httpd_uri_t r_index = {"/", HTTP_GET, index_handler, NULL};
  httpd_uri_t r_capture = {"/capture", HTTP_GET, capture_handler, NULL};
  httpd_uri_t r_stream = {"/stream", HTTP_GET, stream_handler, NULL};
  httpd_uri_t r_status = {"/api/status", HTTP_GET, status_handler, NULL};
  httpd_uri_t r_control = {"/api/control", HTTP_GET, control_handler, NULL};
  httpd_uri_t r_start = {"/api/flight/start", HTTP_POST, start_flight_handler, NULL};
  httpd_uri_t r_stop = {"/api/flight/stop", HTTP_POST, stop_flight_handler, NULL};
  httpd_uri_t r_patch = {"/api/patch/capture", HTTP_POST, capture_patch_handler, NULL};
  httpd_uri_t r_upload = {"/api/upload", HTTP_POST, upload_handler, NULL};

  if (httpd_start(&camera_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(camera_httpd, &r_index);
    httpd_register_uri_handler(camera_httpd, &r_capture);
    httpd_register_uri_handler(camera_httpd, &r_stream);
    httpd_register_uri_handler(camera_httpd, &r_status);
    httpd_register_uri_handler(camera_httpd, &r_control);
    httpd_register_uri_handler(camera_httpd, &r_start);
    httpd_register_uri_handler(camera_httpd, &r_stop);
    httpd_register_uri_handler(camera_httpd, &r_patch);
    httpd_register_uri_handler(camera_httpd, &r_upload);
    httpServerIp = WiFi.localIP().toString();
    logf("[HTTP] Ready -> http://%s:%d/", WiFi.localIP().toString().c_str(), SERVER_PORT);
  } else {
    camera_httpd = NULL;
    enterErrorState("http-server-start-failed");
  }
}

void ensureCameraServer() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  String currentIp = WiFi.localIP().toString();
  if (currentIp == "0.0.0.0") {
    return;
  }

  if (camera_httpd == NULL || httpServerIp != currentIp) {
    logLine("[HTTP] Starting local stream server");
    startCameraServer();
  }
}

// ------------------------------------------------------------
// WiFi
// ------------------------------------------------------------
bool connectWithSavedCredentials() {
  WiFi.mode(WIFI_STA);
  WiFi.persistent(true);
  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.begin();

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0";
}

void startProvisioningPortal() {
  provisioningMode = true;
  refreshModeFromState();
  logLine("[WiFi] Saved credentials unavailable");
  logf("[WiFi] Starting AP onboarding: %s", AP_NAME);

  WiFiManager wm;
  wm.setConfigPortalBlocking(true);
  wm.setConfigPortalTimeout(0);
  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);

  bool connected = wm.startConfigPortal(AP_NAME, AP_PASSWORD);
  provisioningMode = false;

  if (!connected) {
    enterErrorState("wifi-provisioning-failed");
    return;
  }
}

void startWiFi() {
  if (!connectWithSavedCredentials()) {
    startProvisioningPortal();
  }

  wifiConnected = WiFi.status() == WL_CONNECTED;
  if (!wifiConnected || WiFi.localIP().toString() == "0.0.0.0") {
    enterErrorState("wifi-no-ip");
    return;
  }

  setupOTA();
  logf("[WiFi] Connected -> %s", WiFi.localIP().toString().c_str());
  refreshModeFromState();
}

// ------------------------------------------------------------
// Setup / loop
// ------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);
  logLine("=== AgriDrone Guardian | Production batch firmware ===");

  setMode(MODE_BOOT);
  pinMode(BATT_PIN, INPUT);
  analogReadResolution(12);
  loadPreferences();
  initGPS();
  startWiFi();

  if (!initCamera()) {
    enterErrorState("camera-init-failed");
    while (true) {
      delay(1000);
    }
  }

  if (!initLittleFS()) {
    enterErrorState("littlefs-init-failed");
    while (true) {
      delay(1000);
    }
  }

  loadManifest();
  readBattery();
  refreshModeFromState();
  savePreferences();
  saveManifest();
  startCameraServer();

  logLine("[BOOT] All systems ready ✓");
  logf("[BOOT] Stream -> http://%s:%d/", WiFi.localIP().toString().c_str(), SERVER_PORT);
  logf("[BOOT] Status -> http://%s:%d/api/status", WiFi.localIP().toString().c_str(), SERVER_PORT);
  logf("[BOOT] OTA -> %s.local:%d / %s:%d", OTA_HOSTNAME, OTA_PORT, WiFi.localIP().toString().c_str(), OTA_PORT);
}

void loop() {
  pumpGPS();

  if (otaReady && WiFi.status() == WL_CONNECTED) {
    ArduinoOTA.handle();
  }

  if (WiFi.status() != WL_CONNECTED) {
    wifiConnected = false;
    otaReady = false;
    if (camera_httpd != NULL) {
      stopCameraServer();
    }
    if (!provisioningMode) {
      logLine("[WiFi] Lost connection - retrying saved credentials");
      startWiFi();
    }
  } else {
    wifiConnected = true;
    ensureCameraServer();
  }

  if (millis() - lastBatterySampleMs >= BATTERY_SAMPLE_INTERVAL_MS) {
    lastBatterySampleMs = millis();
    readBattery();
  }

  if (captureEnabled && !uploadInProgress && millis() - lastCaptureMs >= FLIGHT_CAPTURE_INTERVAL_MS) {
    lastCaptureMs = millis();
    capturePatchToFlash();
  }

  if (captureRequested) {
    captureRequested = false;
    capturePatchToFlash();
  }

  if (uploadRequested) {
    uploadRequested = false;
    uploadCurrentFlight();
  }

  refreshModeFromState();
  delay(20);
}

