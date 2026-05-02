#pragma once
#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "config.h"

struct GpsSnapshot {
  double   lat   = DEFAULT_LAT;   // Kathmandu fallback until GPS gets fix
  double   lng   = DEFAULT_LNG;
  double   alt_m = 0.0;
  float    hdop  = 99.0f;
  bool     valid = false;
  uint32_t age   = 9999;
};

// Global GPS mutex — created in gps_init(), accessed from both cores.
extern SemaphoreHandle_t gpsMutex;

// Call once from setup() BEFORE xTaskCreatePinnedToCore.
// Initialises gpsMutex and starts Serial1 on GPS_RX_PIN / GPS_TX_PIN.
void gps_init();

// FreeRTOS task function — pin to Core 1.
// Parses NMEA at ~100 Hz and updates shared GpsSnapshot.
void gps_task(void *pvParam);

// Thread-safe copy of latest GPS data. Safe to call from Core 0.
GpsSnapshot gps_get_snapshot();
