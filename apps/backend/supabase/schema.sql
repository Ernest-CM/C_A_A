-- Block 1 (Uploads): Supabase schema
-- Run this in Supabase SQL Editor.

-- Extensions
create extension if not exists pgcrypto;

-- Uploaded files metadata
create table if not exists public.uploaded_files (
  id uuid primary key,
  user_id uuid not null,

  storage_bucket text not null,
  storage_path text not null,

  file_name text not null,
  original_file_name text not null,
  file_size_bytes bigint,
  mime_type text,

  file_type text not null check (file_type in ('pdf','image','unknown')),
  category text,

  processing_status text not null default 'pending' check (processing_status in ('pending','processing','completed','failed')),
  extraction_error text,

  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_uploaded_files_user on public.uploaded_files(user_id) where deleted_at is null;
create index if not exists idx_uploaded_files_status on public.uploaded_files(processing_status);

-- Extracted content per page
create table if not exists public.extracted_content (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.uploaded_files(id) on delete cascade,

  page_number integer not null,
  raw_text text,
  ocr_confidence double precision,

  created_at timestamptz not null default now()
);

create index if not exists idx_extracted_content_file on public.extracted_content(file_id);

-- RLS (optional but recommended)
alter table public.uploaded_files enable row level security;
alter table public.extracted_content enable row level security;

-- Policies: users can only see their own files/content
create policy if not exists "uploaded_files_read_own"
  on public.uploaded_files for select
  to authenticated
  using (user_id = auth.uid());

create policy if not exists "uploaded_files_insert_own"
  on public.uploaded_files for insert
  to authenticated
  with check (user_id = auth.uid());

create policy if not exists "uploaded_files_update_own"
  on public.uploaded_files for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy if not exists "uploaded_files_delete_own"
  on public.uploaded_files for delete
  to authenticated
  using (user_id = auth.uid());

create policy if not exists "extracted_content_read_own"
  on public.extracted_content for select
  to authenticated
  using (exists (
    select 1 from public.uploaded_files f
    where f.id = extracted_content.file_id and f.user_id = auth.uid()
  ));

create policy if not exists "extracted_content_write_own"
  on public.extracted_content for insert
  to authenticated
  with check (exists (
    select 1 from public.uploaded_files f
    where f.id = extracted_content.file_id and f.user_id = auth.uid()
  ));
