#pragma once
#include "esp_camera.h"
#include "config.h"

// Initialise camera with STREAM_FRAMESIZE from config.h.
// Returns true on success. Call from setup() and halt if false.
bool camera_init();

// Switch to SNAP_FRAMESIZE, discard stale frames, return a fresh high-res frame.
// Caller MUST call esp_camera_fb_return(fb) when done with the buffer.
camera_fb_t* camera_capture_highres();

// Restore STREAM_FRAMESIZE and STREAM_QUALITY after a snapshot.
// Always call this after camera_capture_highres(), even on error.
void camera_restore_stream();

// Apply sensor image tuning (AWB, AEC, AGC, lens correction).
// Called internally by camera_init() — no need to call externally.
void camera_apply_tuning();
