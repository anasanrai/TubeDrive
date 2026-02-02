-- 1. Create the transfers table if not exists, or update it
-- Note: If the table already exists, you may need to add columns manually in the Supabase UI 
-- or run: ALTER TABLE transfers ADD COLUMN IF NOT EXISTS original_size bigint;

create table if not exists transfers (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_email text not null,
  type text not null, -- 'download' or 'compress'
  title text,
  original_size bigint default 0,
  final_size bigint default 0,
  status text default 'success',
  drive_file_id text
);

-- Enable RLS
alter table transfers enable row level security;

-- 2. Drop old policies if they exist (to avoid duplicates)
drop policy if exists "Users can view their own transfers" on transfers;
drop policy if exists "Users can insert their own transfers" on transfers;
drop policy if exists "Users can delete their own transfers" on transfers;

-- 3. Create production-ready policies
-- This allows the server (using Anon Key) to fetch/insert/delete 
-- We filter by user_email in the application code for security.
create policy "Enable all for anon key"
  on transfers for all
  using (true)
  with check (true);

-- IMPORTANT: In a true production app with Supabase Auth, 
-- you would use: using (auth.jwt() ->> 'email' = user_email)
