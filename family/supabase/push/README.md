# 웹 푸시 — 앱을 닫아도 오는 알림

## 다 올라가 있다 (2026-11-13)

사람이 비밀 키를 손으로 옮기는 단계는 없다. 서버 함수가 처음 실행될 때
서명 키를 스스로 만들어 Vault 에 넣고, 그 뒤로는 거기서 읽어 쓴다.

| 조각 | 어디에 |
| --- | --- |
| 기기별 구독 | `public.push_subscriptions` — RLS 로 본인 것만 |
| 중복 발송 방지 | `public.push_sent` — 정책 없음 = service_role 만 |
| 보내는 함수 | Edge Function `send-push` (verify_jwt 끔) |
| 주기 작업 | `send-push-5min` (5분), `push-sent-cleanup` (매일 04:17) |
| 호출 도우미 | `public.push_call(jsonb)` — Vault 비밀값을 헤더에 싣는다 |
| 서명 키 | Vault 의 `vapid_public` / `vapid_private` — **함수가 직접 만들었다** |
| 호출 비밀번호 | Vault 의 `push_secret` |
| Vault 도우미 | `push_vault_get/set` — service_role 만 실행 가능 |
| 앱 | `js/config.js` 의 `PUSH_PUBLIC_KEY`(공개 키), `notify.js` 구독, `sw.js` 수신 |

확인된 것: `select public.push_call('{}'::jsonb)` → 200,
`{"ok":true,"due":{...},"recent":{...}}`

## 쓰는 사람이 할 일

기기마다 **연동·데이터 → 알림**에서 알림을 한 번 켠다. 켤 때 이 기기의 구독이 저장된다.
아이폰은 **홈 화면에 추가**가 먼저다(iOS 16.4 이상).

## 알림이 오는 경우

- **일정 시작 30분 전** — 그 일정의 담당자·참석자에게만. 반복 일정도 앱과 같은 규칙으로 센다.
- **가족이 올렸을 때** — 올린 사람 빼고 나머지에게. 여러 건이면 묶어서 한 통. 최대 5분 안에.
- 비밀(🔒) 항목은 본인에게만.

## 손볼 곳

| 바꾸고 싶은 것 | 어디 |
| --- | --- |
| 몇 분 전에 보낼지 | 함수의 `LEAD_MIN` (기본 30) |
| 얼마나 자주 도는지 | `cron.schedule('send-push-5min', ...)` |
| 알림에 뜨는 글귀 | 함수의 `pushTo(...)` 호출부 |

## 손으로 불러 보기

```sql
select public.push_call('{"mode":"test"}'::jsonb);   -- 등록된 모든 기기에 시험 알림
select public.push_call('{"mode":"due"}'::jsonb);    -- 곧 시작하는 일정만
select public.push_call('{"mode":"setup"}'::jsonb);  -- 공개 키 확인
-- 결과 보기(pg_net 은 비동기라 몇 초 뒤에)
select status_code, left(content, 300) from net._http_response order by created desc limit 1;
```

## 보안 메모

- VAPID 비밀 키는 Vault 안에만 있다. 저장소·브라우저·이 문서 어디에도 없다.
- 함수는 `x-push-secret` 헤더로 스스로 확인한다. 헤더 없이 부르면 401.
- 푸시 본문에는 제목 정도만 담는다. 브라우저 업체 서버를 거쳐 가고 잠금 화면에도 뜬다.
- 기기에서 알림을 끄거나 앱을 지우면 404/410 이 오고, 그 구독은 자동으로 지워진다.
- 서명 키를 새로 만들면 **기존 구독이 모두 무효**가 된다(각 기기에서 알림 껐다 켜기).
  앱은 저장된 구독의 키가 다르면 알아서 새로 만든다.
