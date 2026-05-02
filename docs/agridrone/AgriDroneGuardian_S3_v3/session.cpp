#include "session.h"
#include "esp_system.h"   // esp_random()

SemaphoreHandle_t sessionMutex = NULL;
SessionState      sessionState;

void session_init() {
  sessionMutex = xSemaphoreCreateMutex();
}

void session_generate_uuid(char *out37) {
  uint8_t b[16];
  for (int i = 0; i < 16; i++) b[i] = (uint8_t)(esp_random() & 0xFF);
  b[6] = (b[6] & 0x0F) | 0x40;   // version 4
  b[8] = (b[8] & 0x3F) | 0x80;   // RFC 4122 variant
  snprintf(out37, 37,
    "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    b[0],b[1],b[2],b[3],  b[4],b[5],  b[6],b[7],
    b[8],b[9],  b[10],b[11],b[12],b[13],b[14],b[15]);
}

void session_start() {
  xSemaphoreTake(sessionMutex, portMAX_DELAY);
  session_generate_uuid(sessionState.id);
  sessionState.active           = true;
  sessionState.count            = 0;
  sessionState.lastImageUrl[0]  = '\0';
  xSemaphoreGive(sessionMutex);
  Serial.printf("[SESSION] Started → %s\n", sessionState.id);
}

void session_stop() {
  xSemaphoreTake(sessionMutex, portMAX_DELAY);
  sessionState.active = false;
  xSemaphoreGive(sessionMutex);
  Serial.printf("[SESSION] Stopped. Total captures: %lu\n",
                (unsigned long)sessionState.count);
}

SessionState session_get() {
  SessionState copy;
  xSemaphoreTake(sessionMutex, portMAX_DELAY);
  copy = sessionState;
  xSemaphoreGive(sessionMutex);
  return copy;
}

void session_set_last_url(const char *url) {
  xSemaphoreTake(sessionMutex, portMAX_DELAY);
  strlcpy(sessionState.lastImageUrl, url, SESSION_URL_LEN);
  xSemaphoreGive(sessionMutex);
}

uint32_t session_next_index() {
  xSemaphoreTake(sessionMutex, portMAX_DELAY);
  uint32_t idx = sessionState.count++;
  xSemaphoreGive(sessionMutex);
  return idx;
}
