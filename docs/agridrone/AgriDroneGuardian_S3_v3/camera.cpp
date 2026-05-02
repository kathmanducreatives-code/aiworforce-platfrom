#include "camera.h"
#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

bool camera_init() {
  camera_config_t cfg = {};
  cfg.ledc_channel  = LEDC_CHANNEL_0;
  cfg.ledc_timer    = LEDC_TIMER_0;
  cfg.pin_d0        = Y2_GPIO_NUM;
  cfg.pin_d1        = Y3_GPIO_NUM;
  cfg.pin_d2        = Y4_GPIO_NUM;
  cfg.pin_d3        = Y5_GPIO_NUM;
  cfg.pin_d4        = Y6_GPIO_NUM;
  cfg.pin_d5        = Y7_GPIO_NUM;
  cfg.pin_d6        = Y8_GPIO_NUM;
  cfg.pin_d7        = Y9_GPIO_NUM;
  cfg.pin_xclk      = XCLK_GPIO_NUM;
  cfg.pin_pclk      = PCLK_GPIO_NUM;
  cfg.pin_vsync     = VSYNC_GPIO_NUM;
  cfg.pin_href      = HREF_GPIO_NUM;
  cfg.pin_sccb_sda  = SIOD_GPIO_NUM;
  cfg.pin_sccb_scl  = SIOC_GPIO_NUM;
  cfg.pin_pwdn      = PWDN_GPIO_NUM;
  cfg.pin_reset     = RESET_GPIO_NUM;
  cfg.xclk_freq_hz  = 20000000;        // 20 MHz XCLK — standard for OV5640
  cfg.pixel_format  = PIXFORMAT_JPEG;
  cfg.grab_mode     = CAMERA_GRAB_WHEN_EMPTY;

  bool hasPsram = psramFound();
  if (hasPsram) {
    cfg.frame_size   = STREAM_FRAMESIZE;   // 800×600 SVGA
    cfg.jpeg_quality = STREAM_QUALITY;     // 12
    cfg.fb_count     = 2;                  // double-buffer → smoother MJPEG
    cfg.fb_location  = CAMERA_FB_IN_PSRAM;
    Serial.println("[CAM] PSRAM detected → SVGA stream, 2 frame buffers");
  } else {
    cfg.frame_size   = FRAMESIZE_VGA;      // 640×480 fallback without PSRAM
    cfg.jpeg_quality = 15;
    cfg.fb_count     = 1;
    cfg.fb_location  = CAMERA_FB_IN_DRAM;
    Serial.println("[CAM] No PSRAM → VGA fallback, 1 frame buffer");
  }

  esp_err_t err = esp_camera_init(&cfg);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Init failed: 0x%x — check wiring and camera pins in config.h\n", err);
    return false;
  }

  camera_apply_tuning();

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    Serial.printf("[CAM] OK — sensor PID 0x%04X\n", s->id.PID);
  }
  return true;
}

void camera_apply_tuning() {
  sensor_t *s = esp_camera_sensor_get();
  if (!s) return;

  s->set_brightness(s,     0);    // -2..2
  s->set_contrast(s,       0);    // -2..2
  s->set_saturation(s,     0);    // -2..2
  s->set_sharpness(s,      1);    // 0..3
  s->set_whitebal(s,       1);    // AWB on
  s->set_awb_gain(s,       1);    // AWB gain on
  s->set_wb_mode(s,        0);    // 0 = auto
  s->set_exposure_ctrl(s,  1);    // AEC on
  s->set_aec2(s,           0);    // AEC2 off (faster exposure)
  s->set_ae_level(s,       0);    // exposure compensation 0
  s->set_gain_ctrl(s,      1);    // AGC on
  s->set_gainceiling(s,    GAINCEILING_8X);
  s->set_lenc(s,           1);    // lens distortion correction on
  s->set_raw_gma(s,        1);    // gamma correction on
  s->set_bpc(s,            0);    // black pixel correction off
  s->set_wpc(s,            1);    // white pixel correction on
  s->set_hmirror(s,        0);    // no horizontal mirror
  s->set_vflip(s,          0);    // no vertical flip
}

camera_fb_t* camera_capture_highres() {
  sensor_t *s = esp_camera_sensor_get();
  if (s && psramFound()) {
    s->set_framesize(s, SNAP_FRAMESIZE);   // 1600×1200 UXGA
    s->set_quality(s,   SNAP_QUALITY);     // 10
    vTaskDelay(pdMS_TO_TICKS(SNAP_SETTLE_MS));
    // Discard stale frames so sensor fully settles at new resolution
    for (int i = 0; i < SNAP_DISCARD; i++) {
      camera_fb_t *d = esp_camera_fb_get();
      if (d) esp_camera_fb_return(d);
      vTaskDelay(pdMS_TO_TICKS(60));
    }
  }
  return esp_camera_fb_get();
}

void camera_restore_stream() {
  sensor_t *s = esp_camera_sensor_get();
  if (s && psramFound()) {
    s->set_framesize(s, STREAM_FRAMESIZE);
    s->set_quality(s,   STREAM_QUALITY);
  }
}
