// 가족 자동 동기화(Supabase) 연결 정보.
// 공개 키(publishable/anon)는 브라우저에 두도록 만든 키라 공개 저장소에 있어도 된다.
// 실제 접근 제한은 데이터베이스의 RLS 정책(가족 구성원만 읽기·쓰기)이 맡는다.
// 비어 있으면 동기화 없이 이 기기에만 저장한다.
export const SUPABASE_URL = '';
export const SUPABASE_KEY = '';
