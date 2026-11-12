-- 우리집 미니월드 · 가족 자동 동기화 스키마 (Supabase / Postgres)
-- 가족 단위로만 읽고 쓸 수 있다(RLS). 항목은 한 줄씩 저장되어 동시에 고쳐도 서로 덮어쓰지 않는다.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '우리 가족',
  invite_code text not null unique default encode(extensions.gen_random_bytes(6), 'hex'),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  member_id text not null check (member_id in ('m_dad', 'm_mom', 'm_kid')),
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);
create index if not exists family_members_user_idx on public.family_members(user_id);

-- 일정·이슈·여행·살 것·구성원 상태 등 모든 항목: (가족, 종류, id) 한 줄
create table if not exists public.family_items (
  family_id  uuid not null references public.families(id) on delete cascade,
  kind       text not null,
  id         text not null,
  data       jsonb,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (family_id, kind, id)
);
create index if not exists family_items_updated_idx on public.family_items(family_id, updated_at);

-- 서버 시각으로 updated_at 을 찍는다(기기 시계가 달라도 순서가 맞게).
create or replace function public.touch_family_item() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists family_items_touch on public.family_items;
create trigger family_items_touch before insert or update on public.family_items
  for each row execute function public.touch_family_item();

-- 구성원 확인 함수는 외부 API(public)에 노출하지 않는 private 스키마에 둔다.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create or replace function private.is_family_member(fid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.family_members m where m.family_id = fid and m.user_id = auth.uid());
$$;

alter table public.families       enable row level security;
alter table public.family_members enable row level security;
alter table public.family_items   enable row level security;

drop policy if exists families_read on public.families;
create policy families_read on public.families for select to authenticated using (private.is_family_member(id));

drop policy if exists members_read on public.family_members;
create policy members_read on public.family_members for select to authenticated using (private.is_family_member(family_id));
drop policy if exists members_leave on public.family_members;
create policy members_leave on public.family_members for delete to authenticated using (user_id = auth.uid());

drop policy if exists items_read on public.family_items;
create policy items_read on public.family_items for select to authenticated using (private.is_family_member(family_id));
drop policy if exists items_insert on public.family_items;
create policy items_insert on public.family_items for insert to authenticated with check (private.is_family_member(family_id));
drop policy if exists items_update on public.family_items;
create policy items_update on public.family_items for update to authenticated
  using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));
-- 삭제는 행을 지우지 않고 deleted=true 로 표시한다(다른 기기에 전달하기 위해).

-- 가족 만들기 / 초대 코드로 참여하기
create or replace function public.create_family(p_name text, p_member_id text) returns public.families
language plpgsql security definer set search_path = '' as $$
declare f public.families;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.family_members where user_id = auth.uid()) then raise exception 'already in a family'; end if;
  insert into public.families(name, created_by) values (coalesce(nullif(trim(p_name), ''), '우리 가족'), auth.uid()) returning * into f;
  insert into public.family_members(family_id, user_id, member_id) values (f.id, auth.uid(), p_member_id);
  return f;
end $$;

create or replace function public.join_family(p_code text, p_member_id text) returns public.families
language plpgsql security definer set search_path = '' as $$
declare f public.families;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into f from public.families where invite_code = lower(trim(p_code));
  if f.id is null then raise exception 'invalid invite code'; end if;
  if exists (select 1 from public.family_members where user_id = auth.uid() and family_id <> f.id) then raise exception 'already in a family'; end if;
  insert into public.family_members(family_id, user_id, member_id) values (f.id, auth.uid(), p_member_id)
    on conflict (family_id, user_id) do update set member_id = excluded.member_id;
  return f;
end $$;

revoke all on function public.create_family(text, text) from public, anon;
revoke all on function public.join_family(text, text) from public, anon;
grant execute on function public.create_family(text, text) to authenticated;
grant execute on function public.join_family(text, text) to authenticated;
revoke all on function private.is_family_member(uuid) from public, anon;
grant execute on function private.is_family_member(uuid) to authenticated;

-- 실시간 전달
do $$ begin
  alter publication supabase_realtime add table public.family_items;
exception when duplicate_object then null; end $$;
