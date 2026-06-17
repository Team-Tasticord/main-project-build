-- 안 읽은 메시지 총 개수 단일 집계 RPC.
-- 이전: 클라이언트가 방마다 count 쿼리(N+1)를 Sidebar/MobileNav 양쪽에서 중복 실행.
-- 이후: 단일 RPC 호출로 본인 참여 방 전체의 안 읽은 메시지 합계를 서버에서 계산.
--
-- 보안 (P-001류 친구범위 누수 방지):
--   - SECURITY INVOKER(기본) 유지 → 호출자의 RLS 정책이 그대로 적용됨.
--   - 파라미터 없이 내부에서 auth.uid()만 사용 → 타 유저 uid 주입 불가.
--   - 정의: 본인(chat_members.user_id = auth.uid())의 각 방에서
--           last_read_at 이후 + 본인이 보낸 게 아닌 메시지 수의 합계.
--   - chat_members / chat_messages SELECT RLS가 "본인 참여 방"으로 이미 제한하므로
--     SECURITY DEFINER 없이도 안전. (DEFINER 미사용)

CREATE OR REPLACE FUNCTION public.get_unread_total()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(*), 0)::int
  FROM chat_members cm
  JOIN chat_messages msg
    ON msg.room_id = cm.room_id
   AND msg.created_at > cm.last_read_at
   AND msg.sender_id <> auth.uid()
  WHERE cm.user_id = auth.uid()
    AND cm.last_read_at IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_total() TO authenticated;
