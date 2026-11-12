// 가족 자동 동기화(Supabase) 연결 정보.
// 공개 키(publishable/anon)는 브라우저에 두도록 만든 키라 공개 저장소에 있어도 된다.
// 실제 접근 제한은 데이터베이스의 RLS 정책(가족 구성원만 읽기·쓰기)이 맡는다.
// 비어 있으면 동기화 없이 이 기기에만 저장한다.
export const SUPABASE_URL = '';
export const SUPABASE_KEY = '';

// 앱의 대표 주소(Vercel). 비어 있으면 지금 연 주소를 쓴다.
// 다른 주소(예: GitHub Pages)에서 열면 '새 주소로 옮기기' 안내가 뜬다.
export const APP_URL = 'https://family-miniworld.vercel.app/';
