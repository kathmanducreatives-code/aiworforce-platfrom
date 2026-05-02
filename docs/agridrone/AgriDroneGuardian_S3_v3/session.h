#pragma once
#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

// Maximum image URL length stored per session
#define SESSION_URL_LEN 512

struct SessionState {
  char     id[37]                  = "";     // UUID v4 "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
  bool     active                  = false;
  uint32_t count                   = 0;      // captures completed this session
  char     lastImageUrl[SESSION_URL_LEN] = "";
};

// Global session mutex — created in session_init() before any task accesses it.
extern SemaphoreHandle_t sessionMutex;
extern SessionState      sessionState;

// Initialise mutex. Call once from setup() before any task starts.
void session_init();

// Generate a UUID v4 string (37 bytes incl. null) using ESP32 hardware RNG.
void session_generate_uuid(char *out37);

// Start a new session: generates UUID, resets count and lastImageUrl.
// Thread-safe.
void session_start();

// Stop the current session. Thread-safe.
void session_stop();

// Copy current session snapshot. Thread-safe.
SessionState session_get();

// Record a successful upload URL. Thread-safe.
void session_set_last_url(const char *url);

// Increment capture counter and return the old value (pre-increment index).
// Thread-safe.
uint32_t session_next_index();
