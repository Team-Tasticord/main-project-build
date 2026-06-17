-- supabase-migration-p001-friend-rls-fix.sql
-- ============================================================
-- P-001 (CRITICAL) 수정 — 친구범위 RLS 가시성 누수.
--
-- friendships.status(pending/accepted) 도입 후, 친구범위 SELECT 정책들이
--   user_id IN (SELECT friend_id FROM friendships WHERE user_id = auth.uid())
-- 처럼 status를 필터하지 않아 → 내가 보낸 pending 요청만으로 상대의
-- friend-scoped 데이터(profiles/activities/user_now_playing/taste_profiles)가 열렸다.
--
-- 수정: 친구 서브쿼리에 AND status = 'accepted' 추가 (4개 테이블 정책).
-- friendships는 수락 시 양방향 2행이 모두 'accepted'이므로 정당 친구 가시성은 유지된다.
--
-- 적용: Supabase SQL Editor에서 실행.
-- 롤백: supabase-rollback-p001.sql (git revert로는 DB RLS가 안 돌아감).
-- 검증: npm run test:rls — pending=0행 / accepted=1행으로 fail→pass.
-- ============================================================

-- profiles: 본인 + accepted 친구 프로필만
DROP POLICY IF EXISTS "Users can read profiles" ON profiles;
CREATE POLICY "Users can read profiles" ON profiles FOR SELECT USING (
  id = auth.uid() OR
  id IN (SELECT friend_id FROM friendships WHERE user_id = auth.uid() AND status = 'accepted')
);

-- activities: 본인 + accepted 친구 활동만
DROP POLICY IF EXISTS "Users can read friend activities" ON activities;
CREATE POLICY "Users can read friend activities" ON activities FOR SELECT USING (
  auth.uid() = user_id OR
  user_id IN (SELECT friend_id FROM friendships WHERE user_id = auth.uid() AND status = 'accepted')
);

-- user_now_playing: 본인 + accepted 친구 실시간 활동만
DROP POLICY IF EXISTS "Users can read friend now_playing" ON user_now_playing;
CREATE POLICY "Users can read friend now_playing" ON user_now_playing FOR SELECT USING (
  auth.uid() = user_id OR
  user_id IN (SELECT friend_id FROM friendships WHERE user_id = auth.uid() AND status = 'accepted')
);

-- taste_profiles: 본인 + accepted 친구 취향 스냅샷만
DROP POLICY IF EXISTS "Users can read friend taste profiles" ON taste_profiles;
CREATE POLICY "Users can read friend taste profiles" ON taste_profiles FOR SELECT USING (
  auth.uid() = user_id OR
  user_id IN (SELECT friend_id FROM friendships WHERE user_id = auth.uid() AND status = 'accepted')
);
