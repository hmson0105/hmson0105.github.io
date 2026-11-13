-- 웹 푸시 구독을 담는 표. 기기 하나당 한 줄.
-- 본인 것만 읽고 쓸 수 있고, 보내는 Edge Function 은 service_role 로 전체를 읽는다.
-- 적용: Supabase SQL 편집기에 붙여넣고 실행.

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  family_id   uuid not null references public.families(id) on delete cascade,
  member_id   text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fail_count  int not null default 0,
  constraint push_member_id_ok check (member_id ~ '^[A-Za-z0-9_:.@-]{1,80}$'),
  constraint push_endpoint_len check (length(endpoint) between 20 and 2048)
);

create index if not exists push_subscriptions_family_idx on public.push_subscriptions (family_id);
create index if not exists push_subscriptions_user_idx   on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- 기본 권한을 모두 거둔 뒤 필요한 것만 준다(가족 앱의 다른 표와 같은 방식).
revoke all on public.push_subscriptions from anon, public, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

drop policy if exists push_own_select on public.push_subscriptions;
drop policy if exists push_own_write  on public.push_subscriptions;
drop policy if exists push_own_update on public.push_subscriptions;
drop policy if exists push_own_delete on public.push_subscriptions;

create policy push_own_select on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

create policy push_own_write on public.push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid() and private.is_family_member(family_id));

create policy push_own_update on public.push_subscriptions
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy push_own_delete on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- 같은 알림을 두 번 보내지 않기 위한 기록. 보내는 함수(service_role)만 쓴다.
create table if not exists public.push_sent (
  key        text primary key,          -- 예: 'ev:<일정 id>:<날짜>:<시각>'
  family_id  uuid not null references public.families(id) on delete cascade,
  sent_at    timestamptz not null default now()
);
alter table public.push_sent enable row level security;
revoke all on public.push_sent from anon, public, authenticated;
-- 어떤 정책도 두지 않는다 = 클라이언트는 읽지도 쓰지도 못하고, service_role 만 쓴다.

-- 오래된 기록은 2주 뒤 지운다(pg_cron 으로 하루 한 번 부르면 된다).
create or replace function public.push_sent_cleanup()
returns void language sql security definer set search_path = public as $$
  delete from public.push_sent where sent_at < now() - interval '14 days';
$$;
revoke all on function public.push_sent_cleanup() from anon, public, authenticated;
