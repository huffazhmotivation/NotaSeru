-- ================================================
-- NotaSeru — Setup Supabase (jalankan di SQL Editor)
-- https://supabase.com → project → SQL Editor
-- ================================================

-- 1. Tabel utama penyimpanan data per user
CREATE TABLE IF NOT EXISTS public.userdata (
  user_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key       TEXT        NOT NULL,
  value     JSONB,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- 2. Index untuk performa
CREATE INDEX IF NOT EXISTS idx_userdata_user_id ON public.userdata(user_id);

-- 3. Row Level Security — user hanya bisa akses data sendiri
ALTER TABLE public.userdata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own data"
  ON public.userdata FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own data"
  ON public.userdata FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own data"
  ON public.userdata FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own data"
  ON public.userdata FOR DELETE
  USING (auth.uid() = user_id);

-- Selesai! Sekarang isi config.js dengan URL dan anon key project ini.
