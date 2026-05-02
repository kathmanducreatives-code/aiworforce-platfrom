-- ============================================================
--  AgriDrone Guardian — Supabase Schema v2
--  Run ONCE in: Supabase Dashboard → SQL Editor → Run
--  URL: https://supabase.com/dashboard/project/luvostyizefajbltukkc/sql/new
-- ============================================================

CREATE TABLE IF NOT EXISTS drone_logs (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID         NOT NULL,
  lat          FLOAT8       NOT NULL,
  lng          FLOAT8       NOT NULL,
  altitude_m   FLOAT8,
  hdop         FLOAT4,
  gps_valid    BOOLEAN      DEFAULT false,
  image_url    TEXT,
  device_id    TEXT         NOT NULL DEFAULT 'esp32-drone-01',
  log_type     TEXT         NOT NULL DEFAULT 'gps',   -- 'gps' | 'capture'
  captured_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- Row-Level Security
ALTER TABLE drone_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON drone_logs;
CREATE POLICY "service_all" ON drone_logs FOR ALL USING (true);

-- Indexes for Flutter app queries (session gallery, device track)
CREATE INDEX IF NOT EXISTS idx_session ON drone_logs(session_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_device  ON drone_logs(device_id,  captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_type    ON drone_logs(log_type,   captured_at DESC);

-- Verify table exists:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'drone_logs' ORDER BY ordinal_position;

-- Verify storage bucket:
-- SELECT * FROM storage.buckets WHERE id = 'drone-images';
