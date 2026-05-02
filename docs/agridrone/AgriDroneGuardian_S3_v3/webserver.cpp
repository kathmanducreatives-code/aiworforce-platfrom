#include "webserver.h"
#include "camera.h"
#include "session.h"
#include "gps_task.h"
#include "supabase.h"
#include "config.h"
#include <WiFi.h>
#include <ArduinoJson.h>
#include "esp_task_wdt.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

// ── MJPEG boundary constants ──────────────────────────────────
#define PART_BOUNDARY "AgriFrame"
static const char *STREAM_CT  = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *STREAM_SEP = "\r\n--" PART_BOUNDARY "\r\n";
static const char *STREAM_HDR = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static httpd_handle_t _server = NULL;

// ─────────────────────────────────────────────────────────────
//  GET /stream — MJPEG live video feed
// ─────────────────────────────────────────────────────────────
static esp_err_t h_stream(httpd_req_t *req) {
  char hdrBuf[64];
  httpd_resp_set_type(req, STREAM_CT);
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-cache, no-store, must-revalidate");

  Serial.println("[STREAM] Client connected");
  TickType_t lastFrame = xTaskGetTickCount();

  while (true) {
    esp_task_wdt_reset();   // keep WDT fed during long-running connection

    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) { vTaskDelay(pdMS_TO_TICKS(30)); continue; }

    esp_err_t res = httpd_resp_send_chunk(req, STREAM_SEP, strlen(STREAM_SEP));
    if (res == ESP_OK) {
      int hl = snprintf(hdrBuf, sizeof(hdrBuf), STREAM_HDR, fb->len);
      res = httpd_resp_send_chunk(req, hdrBuf, hl);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    }
    esp_camera_fb_return(fb);

    if (res != ESP_OK) break;   // client disconnected or network error
    vTaskDelayUntil(&lastFrame, pdMS_TO_TICKS(STREAM_FRAME_MS));
  }

  Serial.println("[STREAM] Client disconnected");
  return ESP_OK;
}

// ─────────────────────────────────────────────────────────────
//  GET /capture — High-res still + optional Supabase upload
// ─────────────────────────────────────────────────────────────
static esp_err_t h_capture(httpd_req_t *req) {
  camera_fb_t *fb = camera_capture_highres();
  camera_restore_stream();   // always restore even if fb is NULL

  if (!fb) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  // ── Session-aware Supabase upload ────────────────────────
  SessionState sess = session_get();
  if (sess.active) {
    uint32_t     idx  = session_next_index();
    GpsSnapshot  snap = gps_get_snapshot();
    char storagePath[160];
    char imgUrl[SESSION_URL_LEN];

    snprintf(storagePath, sizeof(storagePath),
             "sessions/%s/img_%04lu.jpg", sess.id, (unsigned long)idx);

    bool uploaded = supabase_upload_image(fb->buf, fb->len,
                                          storagePath, imgUrl, sizeof(imgUrl));
    if (uploaded) {
      session_set_last_url(imgUrl);
      supabase_log(snap, sess.id, imgUrl, "capture");
      Serial.printf("[CAP] #%lu → %s\n", (unsigned long)idx, imgUrl);
    } else {
      Serial.printf("[CAP] #%lu upload failed — JPEG still returned\n",
                    (unsigned long)idx);
    }
  }

  // ── Return JPEG bytes to browser / Flutter app ───────────
  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=snapshot.jpg");
  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

// ─────────────────────────────────────────────────────────────
//  GET /status — JSON for Flutter frontend
//  Shape: { device_id, ip, rssi_dbm, lat, lng, alt_m, hdop,
//           gps_valid, gps_age_ms, session_active, session_id,
//           capture_count, latest_image_url, uptime_ms, stream_url }
// ─────────────────────────────────────────────────────────────
static esp_err_t h_status(httpd_req_t *req) {
  GpsSnapshot  snap = gps_get_snapshot();
  SessionState sess = session_get();

  StaticJsonDocument<768> doc;
  doc["device_id"]         = DEVICE_ID;
  doc["ip"]                = WiFi.localIP().toString();
  doc["rssi_dbm"]          = WiFi.RSSI();
  doc["lat"]               = snap.lat;
  doc["lng"]               = snap.lng;
  doc["alt_m"]             = snap.alt_m;
  doc["hdop"]              = snap.hdop;
  doc["gps_valid"]         = snap.valid;
  doc["gps_age_ms"]        = snap.age;
  doc["session_active"]    = sess.active;
  doc["session_id"]        = sess.id;
  doc["capture_count"]     = sess.count;
  doc["latest_image_url"]  = sess.lastImageUrl;
  doc["uptime_ms"]         = millis();
  doc["stream_url"]        = "http://" + WiFi.localIP().toString() + "/stream";

  String body;
  serializeJson(doc, body);

  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
  httpd_resp_send(req, body.c_str(), body.length());
  return ESP_OK;
}

// ─────────────────────────────────────────────────────────────
//  POST /session/start
// ─────────────────────────────────────────────────────────────
static esp_err_t h_session_start(httpd_req_t *req) {
  session_start();
  SessionState s = session_get();
  char json[128];
  snprintf(json, sizeof(json), "{\"ok\":true,\"session_id\":\"%s\"}", s.id);
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_send(req, json, strlen(json));
  return ESP_OK;
}

// ─────────────────────────────────────────────────────────────
//  POST /session/stop
// ─────────────────────────────────────────────────────────────
static esp_err_t h_session_stop(httpd_req_t *req) {
  SessionState s     = session_get();
  uint32_t     total = s.count;
  char         sid[37];
  strlcpy(sid, s.id, sizeof(sid));
  session_stop();

  char json[128];
  snprintf(json, sizeof(json),
           "{\"ok\":true,\"session_id\":\"%s\",\"total_captures\":%lu}",
           sid, (unsigned long)total);
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_send(req, json, strlen(json));
  return ESP_OK;
}

// ─────────────────────────────────────────────────────────────
//  GET / — Web UI (in PROGMEM to save DRAM)
// ─────────────────────────────────────────────────────────────
static const char WEB_UI[] PROGMEM = R"rawhtml(
<!DOCTYPE html><html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AgriDrone Guardian</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0a0f0d;color:#e8f5e9;font-family:'Courier New',monospace;padding:14px;font-size:13px}
    h1{font-size:.8rem;letter-spacing:.4em;color:#4ade80;margin-bottom:12px}
    .wrap{max-width:800px}
    .stream-box{position:relative;background:#000;border:1px solid #14532d;line-height:0}
    .stream-box img{width:100%}
    .badge{position:absolute;top:7px;left:8px;background:rgba(0,0,0,.72);
           color:#4ade80;font-size:.6rem;letter-spacing:.15em;padding:3px 8px}
    .row{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
    button{background:transparent;border:1px solid #4ade80;color:#4ade80;
           padding:7px 12px;font-family:inherit;font-size:.7rem;
           letter-spacing:.12em;cursor:pointer;text-transform:uppercase}
    button:hover{background:rgba(74,222,128,.12)}
    .stop{border-color:#f87171!important;color:#f87171!important}
    #stat{margin-top:8px;padding:9px;background:#0d1a10;
          border:1px solid #14532d;line-height:2;color:#86a98e;font-size:.7rem}
    #stat b{color:#4ade80}
    #prev{width:100%;margin-top:8px;border:1px solid #14532d;display:none}
    .dot{display:inline-block;width:7px;height:7px;border-radius:50%;
         background:#f87171;margin-right:5px;vertical-align:middle}
    .dot.lock{background:#4ade80}
  </style>
</head>
<body>
<div class="wrap">
  <h1>⬡ AGRIDRONE GUARDIAN</h1>
  <div class="stream-box">
    <img id="mjpeg" src="/stream" onerror="retry()">
    <div class="badge" id="badge">● LIVE</div>
  </div>
  <div class="row">
    <button onclick="snap()">📷 Snapshot</button>
    <button id="bs" onclick="startSess()">▶ Start Session</button>
    <button class="stop" onclick="stopSess()">■ Stop Session</button>
    <button onclick="loadStat()">↻ Refresh</button>
  </div>
  <div id="stat">Connecting...</div>
  <img id="prev" alt="Last snapshot">
</div>
<script>
var sid=null;
function retry(){
  document.getElementById('badge').textContent='◌ Reconnecting';
  setTimeout(function(){
    var m=document.getElementById('mjpeg');
    m.src='/stream?t='+Date.now();
  },2000);
}
document.getElementById('mjpeg').onload=function(){
  document.getElementById('badge').textContent='● LIVE';
};
function snap(){
  fetch('/capture').then(function(r){return r.blob();}).then(function(b){
    var p=document.getElementById('prev');
    p.src=URL.createObjectURL(b);
    p.style.display='block';
  });
}
function startSess(){
  fetch('/session/start',{method:'POST'})
    .then(function(r){return r.json();})
    .then(function(d){
      sid=d.session_id;
      document.getElementById('bs').textContent='▶ '+sid.substring(0,8)+'...';
      alert('Session started\n'+sid);
    });
}
function stopSess(){
  fetch('/session/stop',{method:'POST'})
    .then(function(r){return r.json();})
    .then(function(d){
      alert('Session stopped\nCaptures: '+d.total_captures);
      sid=null;
      document.getElementById('bs').textContent='▶ Start Session';
    });
}
function loadStat(){
  fetch('/status').then(function(r){return r.json();}).then(function(d){
    var lock=d.gps_valid;
    document.getElementById('stat').innerHTML=
      '<span class="dot'+(lock?' lock':'')+'"></span>'+(lock?'GPS LOCK':'NO GPS LOCK')+
      ' &nbsp;Lat:<b>'+d.lat.toFixed(6)+'</b> Lng:<b>'+d.lng.toFixed(6)+'</b><br>'+
      'Alt:<b>'+d.alt_m.toFixed(1)+'m</b> &nbsp;HDOP:<b>'+d.hdop.toFixed(1)+'</b><br>'+
      'IP:<b>'+d.ip+'</b> &nbsp;RSSI:<b>'+d.rssi_dbm+' dBm</b><br>'+
      'Session:<b>'+(d.session_active?'▶ '+d.session_id.substring(0,8)+'...':'IDLE')+'</b>'+
      ' &nbsp;Captures:<b>'+d.capture_count+'</b>'+
      (d.latest_image_url?'<br>Last: <a style="color:#4ade80" href="'+
        d.latest_image_url+'" target="_blank">view ↗</a>':'');
  });
}
setInterval(loadStat,5000);
loadStat();
</script>
</body></html>
)rawhtml";

static esp_err_t h_index(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html");
  httpd_resp_send(req, WEB_UI, sizeof(WEB_UI) - 1);
  return ESP_OK;
}

// ─────────────────────────────────────────────────────────────
//  Start HTTP server
// ─────────────────────────────────────────────────────────────
void webserver_start() {
  httpd_config_t cfg    = HTTPD_DEFAULT_CONFIG();
  cfg.server_port       = 80;
  cfg.ctrl_port         = 32768;
  cfg.max_uri_handlers  = 12;
  cfg.stack_size        = 20480;       // camera + JSON handlers need extra stack
  cfg.task_priority     = tskIDLE_PRIORITY + 5;
  cfg.core_id           = 0;           // pin httpd to Core 0 alongside WiFi
  cfg.recv_wait_timeout = 30;
  cfg.send_wait_timeout = 30;
  cfg.lru_purge_enable  = true;        // drop stale connections under load

  if (httpd_start(&_server, &cfg) != ESP_OK) {
    Serial.println("[HTTP] Server start FAILED — check stack/memory");
    return;
  }

  const httpd_uri_t routes[] = {
    {"/",              HTTP_GET,  h_index,         NULL},
    {"/stream",        HTTP_GET,  h_stream,        NULL},
    {"/capture",       HTTP_GET,  h_capture,       NULL},
    {"/status",        HTTP_GET,  h_status,        NULL},
    {"/session/start", HTTP_POST, h_session_start, NULL},
    {"/session/stop",  HTTP_POST, h_session_stop,  NULL},
  };
  for (const auto &r : routes) {
    httpd_register_uri_handler(_server, &r);
  }

  Serial.printf("[HTTP] Ready    → http://%s/\n",       WiFi.localIP().toString().c_str());
  Serial.printf("[HTTP] Stream   → http://%s/stream\n", WiFi.localIP().toString().c_str());
  Serial.printf("[HTTP] Status   → http://%s/status\n", WiFi.localIP().toString().c_str());
}
