-- 우리집 미니월드 · 보안 강화 (2026-11-13). schema.sql 뒤에 이어서 적용한다.

-- 1) 권한: 로그인하지 않은 역할(anon)은 아무 권한도 없고, 로그인한 역할도 필요한 것만.
revoke all on table public.families, public.family_members, public.family_items from anon, public, authenticated;
grant select (id, name, created_by, created_at) on public.families to authenticated;   -- 초대 코드 열은 읽을 수 없다
grant select, delete on public.family_members to authenticated;
grant select, insert, update on public.family_items to authenticated;
revoke all on function public.touch_family_item() from public, anon, authenticated;

-- 2) 항목 형식 검사: 종류·id·크기
alter table public.family_items
  add constraint family_items_kind_ok check (kind in ('events','issues','trips','tripComments','boardItems','places','recurrenceRules','sources','posts','guestbook','members','activity','family','sync')),
  add constraint family_items_id_ok   check (id ~ '^[A-Za-z0-9_:.@-]{1,80}$'),
  add constraint family_items_size_ok check (data is null or octet_length(data::text) <= 3000000);

-- 3) 초대 코드: 평소엔 닫혀 있고, 관리자가 만들면 24시간 동안 한 번만 쓸 수 있다. 가족 정원 3명.
alter table public.families alter column invite_code drop not null, alter column invite_code drop default;
alter table public.families add column if not exists invite_expires_at timestamptz;
update public.families set invite_code = null, invite_expires_at = null;

create or replace function public.rotate_invite_code() returns text
language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  code := encode(extensions.gen_random_bytes(8), 'hex');
  update public.families set invite_code = code, invite_expires_at = now() + interval '24 hours' where created_by = auth.uid();
  if not found then raise exception 'not family admin'; end if;
  return code;
end $$;

create or replace function public.join_family(p_code text, p_member_id text) returns public.families
language plpgsql security definer set search_path = '' as $$
declare f public.families; n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_code is null or length(trim(p_code)) < 12 then raise exception 'invalid invite code'; end if;
  select * into f from public.families where invite_code = lower(trim(p_code)) and invite_expires_at > now() for update;
  if f.id is null then raise exception 'invalid invite code'; end if;
  if exists (select 1 from public.family_members where user_id = auth.uid() and family_id <> f.id) then raise exception 'already in a family'; end if;
  if not exists (select 1 from public.family_members where family_id = f.id and user_id = auth.uid()) then
    select count(*) into n from public.family_members where family_id = f.id;
    if n >= 3 then raise exception 'family is full'; end if;
  end if;
  insert into public.family_members(family_id, user_id, member_id, email) values (f.id, auth.uid(), p_member_id, auth.jwt()->>'email')
    on conflict (family_id, user_id) do update set member_id = excluded.member_id, email = excluded.email;
  update public.families set invite_code = null, invite_expires_at = null where id = f.id;
  f.invite_code := null; f.invite_expires_at := null;
  return f;
end $$;

revoke all on function public.rotate_invite_code() from public, anon;
revoke all on function public.join_family(text, text) from public, anon;
grant execute on function public.rotate_invite_code() to authenticated;
grant execute on function public.join_family(text, text) to authenticated;
