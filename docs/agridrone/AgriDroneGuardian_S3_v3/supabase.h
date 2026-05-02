#pragma once
#include "esp_camera.h"
#include "gps_task.h"
#include "config.h"
#include "freertos/semphr.h"

// Serialises all Supabase HTTPS calls so only one TLS session runs at a time.
// Created in supabase_init(). Both upload and log acquire/release this internally.
extern SemaphoreHandle_t httpMutex;

// Call once from setup() before any Supabase calls.
void supabase_init();

// Upload raw JPEG bytes to the drone-images Storage bucket.
// storagePath: relative path inside bucket, e.g. "sessions/<uuid>/img_0001.jpg"
// On success: fills urlOut with the public URL and returns true.
// Acquires httpMutex internally (30 s timeout).
bool supabase_upload_image(const uint8_t *buf, size_t len,
                           const char *storagePath,
                           char *urlOut, size_t urlLen);

// POST one row to the drone_logs table.
// logType: "capture" (has image) or "gps" (position-only, imageUrl = "")
// Acquires httpMutex internally (15 s timeout).
bool supabase_log(const GpsSnapshot &gps,
                  const char *sessionId,
                  const char *imageUrl,
                  const char *logType);
