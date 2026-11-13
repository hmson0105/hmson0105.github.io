# 웹 푸시 — 앱을 닫아도 오는 알림

## 지금 어디까지 돼 있나 (2026-11-13)

올려 둔 것

- **표 두 개** — `public.push_subscriptions`(기기별 구독), `public.push_sent`(중복 발송 방지).
  구독은 RLS 로 본인 것만 읽고 쓸 수 있고, `push_sent` 는 정책을 두지 않아 service_role 만 쓴다.
- **Edge Function `send-push`** (verify_jwt 끔, `x-push-secret` 헤더로 스스로 확인)
  - `mode` 없음(기본) → 아래 둘 다
  - `mode=due` → 30분 뒤 시작하는 일정을, 그 일정에 엮인 가족에게
  - `mode=recent` → 최근 6분 안에 가족이 올린 것을 사람별로 묶어 한 통씩
  - `mode=item` → 한 건만(트리거용. 지금은 쓰지 않는다)
- **주기 작업(pg_cron)**
  - `send-push-5min` — 5분마다 `public.push_call('{}')`
  - `push-sent-cleanup` — 매일 04:17, 2주 지난 발송 기록 삭제
- **`public.push_call(jsonb)`** — Vault 의 `push_secret` 을 읽어 헤더에 싣고 pg_net 으로 함수를 부른다.
  `authenticated` 는 실행할 수 없다.
- **Vault 비밀값 `push_secret`** — 만들어 뒀다. 값은 대시보드에서 볼 수 있다.
- **앱 쪽** — `js/config.js` 의 `PUSH_PUBLIC_KEY` 에 공개 키가 들어갔고,
  알림을 켜면 `notify.js` 가 구독을 만들어 `sync.js` 가 `push_subscriptions` 에 올린다.
  `sw.js` 는 `push` 와 `notificationclick` 을 받는다.

## 남은 일 — Edge Function 비밀값 넣기

Supabase 대시보드 → **Edge Functions → send-push → Secrets**
(또는 Project Settings → Edge Functions → Secrets)에서 네 개를 넣는다.

| 이름 | 값을 어디서 |
| --- | --- |
| `VAPID_PUBLIC_KEY` | 키 파일 (아래) |
| `VAPID_PRIVATE_KEY` | 키 파일 — **저장소·브라우저에 절대 넣지 않는다** |
| `VAPID_SUBJECT` | `mailto:` 로 시작하는 연락 주소 |
| `PUSH_SECRET` | Project Settings → **Vault** 의 `push_secret` 값을 복사 |

키 파일은 저장소 밖(세션 임시 폴더)에 있다. 넣고 나면 파일을 지운다.

넣은 뒤 확인:

```
select public.push_call('{}'::jsonb);
select * from net._http_response order by created desc limit 1;
```

`status_code` 가 200 이고 본문이 `{"ok":true,...}` 면 연결된 것이다.

## 받는 쪽에서 할 일

- 기기마다 앱의 **연동·데이터 → 알림**에서 알림을 켠다. 켤 때 구독이 저장된다.
- **아이폰은 홈 화면에 추가**해야 푸시가 온다(iOS 16.4 이상).
- 알림이 오는 경우
  - 일정 시작 **30분 전** — 그 일정의 담당자·참석자에게만
  - 가족이 **일정·준비할 일 등을 올렸을 때** — 올린 사람 말고 나머지에게, 최대 5분 안에
  - 비밀(🔒) 항목은 본인에게만

## 보안 메모

- VAPID 비밀 키와 `PUSH_SECRET` 은 Edge Function 비밀값 / Vault 에만 둔다.
- 푸시 본문에는 제목 정도만 담는다. 브라우저 업체 서버를 거쳐 가고 잠금 화면에도 뜬다.
- 기기에서 알림을 끄거나 앱을 지우면 404/410 이 오고, 그 구독은 자동으로 지워진다.

## 키를 새로 만들어야 할 때

VAPID 키를 바꾸면 **기존 구독이 모두 무효**가 된다. 각 기기에서 알림을 껐다 다시 켜야 한다.
앱은 저장된 구독의 키가 다르면 알아서 새로 만든다.
