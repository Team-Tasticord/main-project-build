'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * 안 읽은 메시지 총 개수. Sidebar/MobileNav 공유 훅.
 * - 카운트 조회: RPC `get_unread_total` 단일 집계 쿼리(서버 집계).
 *   최초 마운트 + 메시지 페이지를 벗어날 때 재조회 → 방을 읽어 last_read_at 이
 *   갱신된 뒤에도 stale 없이 정확.
 * - 새 메시지 INSERT 실시간 감지로 +1 (본인 메시지·현재 보는 방 제외).
 * - 메시지 페이지를 보는 동안엔 배지를 숨김(파생값 0).
 */
export function useUnreadCount(): number {
  const pathname = usePathname();
  const onMessages = pathname.startsWith('/messages');
  const pathnameRef = useRef(pathname);
  const [unread, setUnread] = useState(0);
  const supabase = useMemo(() => createClient(), []);
  // 인스턴스별 고유 채널명 (Sidebar/MobileNav 동시 마운트 시 채널 충돌 방지)
  const channelId = useId();

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // 정확한 카운트 재조회 — onMessages 가 false 일 때(최초 마운트 + 메시지 페이지 이탈) 1회.
  // 메시지 페이지에선 어차피 배지를 숨기므로 그동안엔 조회 생략(over-fetch 방지).
  // 메시지 페이지를 떠나면 onMessages 가 true→false 로 바뀌며 재조회 → 읽음 처리로
  // last_read_at 이 갱신된 카운트를 다시 받아 stale 제거. 비메시지 페이지 간 이동
  // (home↔friends 등)에서는 onMessages 가 false 로 유지돼 재조회되지 않음.
  useEffect(() => {
    if (onMessages) return;
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data, error } = await supabase.rpc('get_unread_total');
      if (error) {
        console.error('[useUnreadCount] rpc get_unread_total failed:', error);
        return;
      }
      if (active) setUnread(typeof data === 'number' ? data : 0);
    })();
    return () => {
      active = false;
    };
  }, [supabase, onMessages]);

  // 새 메시지 INSERT 실시간 감지로 +1. 구독은 마운트 시 1회 설정(네비게이션마다 재구독 안 함).
  useEffect(() => {
    let active = true;
    let userId: string | null = null;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (active) userId = user?.id ?? null;
    });

    const channel = supabase
      .channel(`unread-${channelId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const newMsg = payload.new as { sender_id: string; room_id: string };
          if (!userId || newMsg.sender_id === userId) return;
          // 현재 해당 채팅방을 보고 있으면 카운트 증가하지 않음
          if (pathnameRef.current === `/messages/${newMsg.room_id}`) return;
          setUnread((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, channelId]);

  // 메시지 페이지를 보는 동안엔 배지를 숨김(파생값) — effect 내 setState 회피.
  return onMessages ? 0 : unread;
}
