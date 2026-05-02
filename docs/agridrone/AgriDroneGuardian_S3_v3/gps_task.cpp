#include "gps_task.h"
#include <TinyGPSPlus.h>
#include "esp_task_wdt.h"

SemaphoreHandle_t  gpsMutex = NULL;
static GpsSnapshot _gpsData;
static TinyGPSPlus _gps;

void gps_init() {
  gpsMutex = xSemaphoreCreateMutex();
  // Serial1.begin(baud, config, rxPin, txPin)
  // GPS_RX_PIN = GPIO18 ← receives from GPS TX
  // GPS_TX_PIN = GPIO17 → sends to GPS RX
  Serial1.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.printf("[GPS] UART1 → RX=GPIO%d (GPS TX), TX=GPIO%d (GPS RX), %d baud\n",
                GPS_RX_PIN, GPS_TX_PIN, GPS_BAUD);
}

void gps_task(void *pvParam) {
  // Register this task with the Task Watchdog so a GPS parse stall triggers reboot
  esp_task_wdt_add(NULL);

  uint32_t lastDebug = 0;

  while (true) {
    esp_task_wdt_reset();

    // Drain all available NMEA bytes this tick (~100 Hz cadence)
    while (Serial1.available()) {
      _gps.encode(Serial1.read());
    }

    // Update shared snapshot whenever TinyGPS++ decodes a new position
    if (_gps.location.isUpdated() || _gps.altitude.isUpdated()) {
      if (xSemaphoreTake(gpsMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        if (_gps.location.isValid()) {
          _gpsData.lat   = _gps.location.lat();
          _gpsData.lng   = _gps.location.lng();
          _gpsData.valid = true;
          _gpsData.age   = _gps.location.age();
        }
        if (_gps.altitude.isValid())  _gpsData.alt_m = _gps.altitude.meters();
        if (_gps.hdop.isValid())      _gpsData.hdop  = _gps.hdop.hdop();
        xSemaphoreGive(gpsMutex);
      }
    }

    // Debug every 30 s — visible on Serial Monitor to confirm GPS is running
    if (millis() - lastDebug > 30000UL) {
      lastDebug = millis();
      Serial.printf("[GPS] Lat:%.6f Lng:%.6f Alt:%.1fm HDOP:%.1f valid:%d sats:%u\n",
                    _gpsData.lat, _gpsData.lng, _gpsData.alt_m,
                    _gpsData.hdop, _gpsData.valid,
                    (unsigned)_gps.satellites.value());
    }

    vTaskDelay(pdMS_TO_TICKS(10));   // 100 Hz parsing cadence
  }
}

GpsSnapshot gps_get_snapshot() {
  GpsSnapshot snap;
  if (xSemaphoreTake(gpsMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
    snap = _gpsData;
    xSemaphoreGive(gpsMutex);
  }
  return snap;
}
