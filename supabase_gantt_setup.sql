-- ============================================================
-- Proje Yönetimi (Gantt) — Supabase kurulum SQL'i
-- Proje: ERP portal projesi (chchaielttnimuuezazb)
-- Çalıştırma: Supabase Dashboard > SQL Editor > New query > yapıştır > Run
-- (Tek seferlik; tekrar çalıştırmak güvenli — "already exists" hataları yok sayılabilir.)
-- ============================================================

-- 1) Tablo (proje-başına satır; çok-kullanıcıda projeler birbirini EZMEZ) -----
create table if not exists public.gantt_data (
  id         text primary key,                     -- 'proj:<projectId>' | 'gantt_templates'
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- 2) RLS açık -------------------------------------------------
alter table public.gantt_data enable row level security;

-- 3) Politika: giriş yapmış (onaylı) kullanıcılar oku + yaz
--    (ERP onayı zaten erp-guard ile uygulama açılışında kontrol edilir.)
drop policy if exists "gantt_data auth all" on public.gantt_data;
create policy "gantt_data auth all" on public.gantt_data
  for all to authenticated using (true) with check (true);

-- 4) Realtime (başka kullanıcıların değişikliği canlı yansısın)
alter publication supabase_realtime add table public.gantt_data;
