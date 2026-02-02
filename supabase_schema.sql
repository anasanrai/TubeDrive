-- Create the transfers table
create table transfers (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_email text not null,
  type text not null,
  title text,
  original_size bigint,
  final_size bigint,
  status text default 'success',
  drive_file_id text
);

-- Enable RLS
alter table transfers enable row level security;

-- Policies
create policy "Users can view their own transfers"
  on transfers for select
  using (auth.jwt() ->> 'email' = user_email);

create policy "Users can insert their own transfers"
  on transfers for insert
  with check (true);
