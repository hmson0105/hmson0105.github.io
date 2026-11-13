# 웹 푸시 — 앱을 닫아도 오는 알림

지금 앱에 들어 있는 알림은 **앱이 열려 있는 동안에만** 뜬다. 앱을 완전히 닫아도
"30분 뒤 학원" 같은 알림이 오게 하려면 서버가 보내 줘야 한다. 받는 쪽(브라우저)은
이미 다 만들어 두었고, 보내는 쪽만 Supabase에 올리면 된다.

받는 쪽에서 이미 된 것
- `sw.js` 의 `push` 이벤트 — 서버가 보낸 알림을 띄운다
- `sw.js` 의 `notificationclick` — 알림을 누르면 앱으로 간다
- `js/config.js` 의 `PUSH_PUBLIC_KEY` — 비어 있으면 푸시를 쓰지 않는다

## 1. VAPID 키 만들기

```
npx web-push generate-vapid-keys
```

- **공개 키** → `js/config.js` 의 `PUSH_PUBLIC_KEY` 에 넣는다. 공개 키라 저장소에 있어도 된다.
- **비밀 키** → 저장소에 절대 넣지 않는다. 아래 3번에서 Supabase 비밀값으로만 넣는다.

## 2. 구독을 담을 표 만들기

`schema.sql` 을 Supabase SQL 편집기에서 실행한다. 기기마다 하나씩 구독이 쌓이고,
RLS 로 본인 것만 읽고 쓸 수 있다. 보내는 Edge Function 은 service_role 로 전체를 읽는다.

## 3. 보내는 Edge Function 올리기

Edge Function 하나가 두 가지 일을 한다.

1. **다가오는 일정** — `pg_cron` 이 5분마다 불러서, 설정한 미리알림 시간 안에
   시작하는 일정을 찾아 그 일정에 엮인 가족에게 보낸다. 보낸 건 `push_sent` 에 적어
   두 번 보내지 않는다.
2. **가족이 올린 것** — `family_items` 에 INSERT/UPDATE 트리거를 걸고 `pg_net` 으로
   같은 함수를 부른다. 바꾼 사람 말고 나머지 가족에게 보낸다.

비밀값은 함수 쪽에만 둔다.

```
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...
supabase functions deploy send-push
```

## 4. 앱에서 구독 켜기

`PUSH_PUBLIC_KEY` 를 채우고 배포하면, 연동·데이터 화면의 알림 카드에서 알림을 켤 때
이 기기의 구독이 자동으로 저장된다.

## 휴대폰에서 주의할 것

- **iOS** 는 앱을 **홈 화면에 추가**해야 푸시가 온다(iOS 16.4 이상). 사파리 탭으로만
  열어 두면 오지 않는다.
- **Android/Chrome** 은 홈 화면 추가 없이도 오지만, 추가하는 편이 안정적이다.
- 알림 권한은 **기기마다 따로** 켜야 한다.

## 보안

- VAPID **비밀 키는 브라우저 코드·저장소에 절대 두지 않는다.** Edge Function 비밀값에만.
- 푸시 본문에는 **제목 정도만** 담고 자세한 내용은 담지 않는다. 푸시는 브라우저
  업체 서버를 거쳐 가고, 잠금 화면에도 그대로 뜬다.
- 구독 표는 RLS 로 본인 기기 것만 보이게 한다(`schema.sql` 참고).
