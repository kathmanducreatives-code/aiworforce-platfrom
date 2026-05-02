#pragma once
#include "esp_http_server.h"

// Starts the httpd server on port 80 pinned to Core 0.
// Registers all routes:
//   GET  /               → Web UI (PROGMEM HTML)
//   GET  /stream         → MJPEG live video
//   GET  /capture        → High-res JPEG + optional Supabase upload
//   GET  /status         → JSON (lat, lng, alt, session, image_url, uptime)
//   POST /session/start  → Start new session, returns {ok, session_id}
//   POST /session/stop   → Stop session, returns {ok, total_captures}
// Must be called AFTER WiFi is connected and camera is initialised.
void webserver_start();
