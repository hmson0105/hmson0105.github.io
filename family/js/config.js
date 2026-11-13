// 가족 자동 동기화(Supabase) 연결 정보.
// 공개 키(publishable/anon)는 브라우저에 두도록 만든 키라 공개 저장소에 있어도 된다.
// 실제 접근 제한은 데이터베이스의 RLS 정책(가족 구성원만 읽기·쓰기)이 맡는다.
// 비어 있으면 동기화 없이 이 기기에만 저장한다.
export const SUPABASE_URL = 'https://awnwytdiweeciilpzhny.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3bnd5dGRpd2VlY2lpbHB6aG55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0OTM4MjEsImV4cCI6MjExMDA2OTgyMX0.cjlB3ow6w-lWwFR4f6WrbgI0Zsenho-5kXX-l5kyOpw'; // anon(공개용) 키

// 웹 푸시(앱을 닫아도 오는 알림)용 VAPID 공개 키.
// 짝이 되는 비밀 키는 Supabase Vault 안에만 있다. 서버 함수가 직접 만들어 넣은 것이라
// 사람도 이 저장소도 그 값을 본 적이 없다. 공개 키는 브라우저에 두는 게 맞다.
// 비어 있으면 앱이 열려 있는 동안만 알림이 뜬다.
export const PUSH_PUBLIC_KEY = 'BH4mGt4tXZ28Fi6ERbA6mVAsv4bifGpXGPx5ykwRKXr-LgngogK8-AYdS3tsJbcV1rhbwG2QhK-p0NeD8ZUXnMY';

// 앱의 대표 주소(Vercel). 비어 있으면 지금 연 주소를 쓴다.
// 다른 주소(예: GitHub Pages)에서 열면 '새 주소로 옮기기' 안내가 뜬다.
export const APP_URL = 'https://family-miniworld.vercel.app/';
