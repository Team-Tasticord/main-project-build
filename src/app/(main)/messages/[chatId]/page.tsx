'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import ChatBubble from '@/components/chat/ChatBubble';
import ChatInput from '@/components/chat/ChatInput';
import TypingBubble from '@/components/chat/TypingBubble';
import type { ChatMessage, Profile } from '@/types';

const PAGE_SIZE = 30;

export default function ChatRoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.chatId as string;

  // ChatMessage에 client_id 필드가 없을 수 있으므로 임시 메시지 식별용으로
  // 로컬 상태 메시지에 client_id 를 얹어서 관리한다.
  const [messages, setMessages] = useState<Array<ChatMessage & { client_id?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [otherUser, setOtherUser] = useState<Profile | null>(null);
  const [otherLastRead, setOtherLastRead] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // supabase 클라이언트는 한 번만 생성되도록 useMemo (Realtime 구독 유지 위해)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // currentUserId를 ref로도 보관해서 Realtime 콜백에서 최신값 참조
  const currentUserIdRef = useRef<string | null>(null);
  // Optimistic update로 방금 추가한 임시 메시지들의 content를 추적하여
  // Realtime INSERT로 같은 내용이 다시 오면 중복 렌더를 방지한다.
  // (같은 내용을 연속 전송해도 insert 응답으로 받은 real id로 replace 하므로 안전)
  const pendingTempsRef = useRef<Map<string, { content: string; embed_type: string | null }>>(new Map());

  // 초기 로드
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);
      currentUserIdRef.current = user.id;

      // Realtime에 인증 토큰 명시적으로 전달 (RLS가 있는 테이블 구독 시 필요)
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }

      // 멤버 정보 (상대방 프로필 + 상대방 last_read_at)
      const { data: members } = await supabase
        .from('chat_members')
        .select('user_id, last_read_at, profile:profiles(*)')
        .eq('room_id', roomId);

      const other = members?.find(m => m.user_id !== user.id);
      if (other?.profile) {
        setOtherUser(other.profile as unknown as Profile);
        setOtherLastRead(other.last_read_at);
      }

      // 최신 메시지 로드
      const { data: prevMessages } = await supabase
        .from('chat_messages')
        .select('*, sender:profiles(*)')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      const sorted = (prevMessages || []).reverse() as ChatMessage[];
      setMessages(sorted);
      setHasMore((prevMessages || []).length === PAGE_SIZE);
      setLoading(false);

      // 읽음 처리
      const now = new Date().toISOString();
      const { error: readError } = await supabase
        .from('chat_members')
        .update({ last_read_at: now })
        .eq('room_id', roomId)
        .eq('user_id', user.id);
      if (readError) console.error('[Chat] 읽음 처리 실패:', readError);
    }

    init().catch(() => {
      setLoadError(true);
      setLoading(false);
    });
  }, [roomId, supabase]);

  // Realtime: 메시지 수신 + 상대방 읽음 상태 감지
  // Strict Mode 대응: removeChannel이 공유 WebSocket을 재설정하면서
  // Presence 등 다른 채널도 함께 CLOSED되는 문제 방지
  useEffect(() => {
    if (!currentUserId) return;
    if (realtimeRef.current) return;

    // 싱글톤 클라이언트에 이전 방문에서 남은 같은 이름의 채널이 있으면 제거
    const channelName = `room-${roomId}`;
    const existing = supabase.getChannels().find(
      (ch) => ch.topic === `realtime:${channelName}`
    );
    if (existing) {
      supabase.removeChannel(existing);
    }

    console.log('[Realtime] 채널 구독 시작:', roomId);

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          const newMsg = payload.new as ChatMessage;
          console.log('[Realtime] 메시지 수신:', newMsg);

          const myId = currentUserIdRef.current;
          if (newMsg.sender_id === myId) return;

          const { data: sender } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', newMsg.sender_id)
            .single();

          setMessages(prev => [...prev, { ...newMsg, sender: sender as Profile }]);
          setIsTyping(false);

          if (myId) {
            const readAt = new Date().toISOString();
            const { error: readErr } = await supabase
              .from('chat_members')
              .update({ last_read_at: readAt })
              .eq('room_id', roomId)
              .eq('user_id', myId);
            if (readErr) console.error('[Chat] 읽음 처리 실패:', readErr);

            // 상대방에게 읽음 알림
            realtimeRef.current?.send({
              type: 'broadcast',
              event: 'read',
              payload: { user_id: myId, last_read_at: readAt },
            });
          }
        }
      )
      .on('broadcast', { event: 'read' }, (payload) => {
        const senderId = payload.payload?.user_id;
        if (senderId !== currentUserIdRef.current) {
          setOtherLastRead(payload.payload?.last_read_at);
        }
      })
      .on('broadcast', { event: 'typing' }, (payload) => {
        const senderId = payload.payload?.user_id;
        if (senderId === currentUserIdRef.current) return;
        setIsTyping(true);
      })
      .on('broadcast', { event: 'stop_typing' }, (payload) => {
        const senderId = payload.payload?.user_id;
        if (senderId === currentUserIdRef.current) return;
        setIsTyping(false);
      })
      .subscribe((status, err) => {
        console.log('[Realtime] 구독 상태:', status, err || '');
        // 구독 완료 시 읽음 상태를 상대방에게 알림
        if (status === 'SUBSCRIBED') {
          channel.send({
            type: 'broadcast',
            event: 'read',
            payload: {
              user_id: currentUserIdRef.current,
              last_read_at: new Date().toISOString(),
            },
          });
        }
      });

    realtimeRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      realtimeRef.current = null;
    };
  }, [roomId, currentUserId, supabase]);

  // 타이핑 상태 전송
  const sendTyping = useCallback(() => {
    realtimeRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: currentUserIdRef.current },
    });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      realtimeRef.current?.send({
        type: 'broadcast',
        event: 'stop_typing',
        payload: { user_id: currentUserIdRef.current },
      });
    }, 2000);
  }, []);

  // 새 메시지 또는 타이핑 표시 시 스크롤 하단으로
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // 스크롤 페이지네이션: 맨 위 도달 시 이전 메시지 로드
  useEffect(() => {
    if (!topRef.current || loading) return;

    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting || loadingMore || !hasMore) return;

        setLoadingMore(true);
        const oldestMessage = messages[0];
        if (!oldestMessage) {
          setLoadingMore(false);
          return;
        }

        const container = scrollContainerRef.current;
        const prevScrollHeight = container?.scrollHeight || 0;

        const { data: olderMessages } = await supabase
          .from('chat_messages')
          .select('*, sender:profiles(*)')
          .eq('room_id', roomId)
          .lt('created_at', oldestMessage.created_at)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE);

        const sorted = (olderMessages || []).reverse() as ChatMessage[];

        if (sorted.length === 0) {
          setHasMore(false);
        } else {
          setMessages(prev => [...sorted, ...prev]);
          setHasMore(sorted.length === PAGE_SIZE);

          // 스크롤 위치 유지
          requestAnimationFrame(() => {
            if (container) {
              const newScrollHeight = container.scrollHeight;
              container.scrollTop = newScrollHeight - prevScrollHeight;
            }
          });
        }

        setLoadingMore(false);
      },
      { root: scrollContainerRef.current, threshold: 0.1 }
    );

    observer.observe(topRef.current);
    return () => observer.disconnect();
  }, [loading, loadingMore, hasMore, messages, roomId, supabase]);

  // 텍스트 메시지 전송
  // 중복 방지 전략: 삽입 성공 시 서버가 반환하는 real DB row로 temp 메시지를 "교체"한다.
  // 덤으로 Realtime INSERT 핸들러는 이미 내 메시지(`sender_id === myId`)를 skip 하므로
  // temp와 realtime 이벤트가 겹쳐 동일 메시지가 두 번 렌더되는 일이 없다.
  const handleSend = async (content: string) => {
    if (!currentUserId) return;

    const clientId = crypto.randomUUID();
    const tempMessage: ChatMessage & { client_id: string } = {
      id: clientId,
      client_id: clientId,
      room_id: roomId,
      sender_id: currentUserId,
      content,
      embed_type: null,
      embed_data: null,
      created_at: new Date().toISOString(),
    };
    pendingTempsRef.current.set(clientId, { content, embed_type: null });
    setMessages(prev => [...prev, tempMessage]);

    const { data: inserted, error } = await supabase
      .from('chat_messages')
      .insert({
        room_id: roomId,
        sender_id: currentUserId,
        content,
      })
      .select('*, sender:profiles(*)')
      .single();

    if (error || !inserted) {
      console.error('[Chat] 메시지 전송 실패:', error);
      // 전송 실패 시 temp 메시지 제거
      pendingTempsRef.current.delete(clientId);
      setMessages(prev => prev.filter(m => (m as ChatMessage & { client_id?: string }).client_id !== clientId));
      return;
    }

    // temp 메시지를 서버가 돌려준 real row로 교체 (중복 방지)
    pendingTempsRef.current.delete(clientId);
    setMessages(prev =>
      prev.map(m =>
        (m as ChatMessage & { client_id?: string }).client_id === clientId
          ? ({ ...(inserted as ChatMessage) } as ChatMessage & { client_id?: string })
          : m
      )
    );
  };

  // 카드 메시지 전송 (음악/게임/영화 추천)
  const handleSendCard = async (embedType: 'music' | 'game' | 'movie' | null, embedData: Record<string, unknown>) => {
    if (!currentUserId || !embedType) return;

    const clientId = crypto.randomUUID();
    const tempMessage: ChatMessage & { client_id: string } = {
      id: clientId,
      client_id: clientId,
      room_id: roomId,
      sender_id: currentUserId,
      content: '',
      embed_type: embedType,
      embed_data: embedData,
      created_at: new Date().toISOString(),
    };
    pendingTempsRef.current.set(clientId, { content: '', embed_type: embedType });
    setMessages(prev => [...prev, tempMessage]);

    const { data: inserted, error } = await supabase
      .from('chat_messages')
      .insert({
        room_id: roomId,
        sender_id: currentUserId,
        content: '',
        embed_type: embedType,
        embed_data: embedData,
      })
      .select('*, sender:profiles(*)')
      .single();

    if (error || !inserted) {
      console.error('[Chat] 카드 메시지 전송 실패:', error);
      pendingTempsRef.current.delete(clientId);
      setMessages(prev => prev.filter(m => (m as ChatMessage & { client_id?: string }).client_id !== clientId));
      return;
    }

    // temp → real row 교체
    pendingTempsRef.current.delete(clientId);
    setMessages(prev =>
      prev.map(m =>
        (m as ChatMessage & { client_id?: string }).client_id === clientId
          ? ({ ...(inserted as ChatMessage) } as ChatMessage & { client_id?: string })
          : m
      )
    );
  };

  if (loadError) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <p className="text-zinc-300 font-medium mb-1">대화를 불러오지 못했어요</p>
        <p className="text-sm text-zinc-500 mb-5">네트워크 연결을 확인한 뒤 다시 시도해 주세요.</p>
        <button
          onClick={() => router.push('/messages')}
          className="px-5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold transition"
        >
          목록으로
        </button>
      </div>
    );
  }

  // 참여하지 않은 대화방(RLS로 멤버 0건 → 상대 정보 없음) 접근 차단
  if (!loading && !otherUser) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <p className="text-zinc-300 font-medium mb-1">접근할 수 없는 대화입니다</p>
        <p className="text-sm text-zinc-500 mb-5">참여 중인 대화만 볼 수 있어요.</p>
        <button
          onClick={() => router.push('/messages')}
          className="px-5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold transition"
        >
          목록으로
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="border-b border-zinc-800/50 px-6 py-4 flex items-center gap-3">
        <button
          onClick={() => router.push('/messages')}
          className="text-zinc-400 hover:text-white transition"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        {otherUser && (
          <div className="flex items-center gap-3">
            {otherUser.avatar_url ? (
              <img src={otherUser.avatar_url} alt={otherUser.nickname} className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold">
                {otherUser.nickname.slice(0, 1)}
              </div>
            )}
            <span className="font-semibold text-sm">{otherUser.nickname}</span>
          </div>
        )}
      </div>

      {/* 메시지 영역 */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* 페이지네이션 상단 감지 요소 */}
        <div ref={topRef} />
        {loadingMore && (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="w-4 h-4 text-zinc-600 animate-spin" />
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-zinc-600 py-20">
            <p>아직 메시지가 없습니다</p>
            <p className="text-sm text-zinc-700 mt-1">첫 메시지를 보내보세요</p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            // 내 메시지 중 마지막으로 상대방이 읽은 메시지인지 확인
            const isOwn = msg.sender_id === currentUserId;
            let showRead = false;
            if (isOwn && otherLastRead) {
              const isRead = new Date(otherLastRead) >= new Date(msg.created_at);
              // 읽음 표시는 내 메시지 중 가장 마지막 읽은 메시지에만 표시
              const nextOwnMsg = messages.slice(idx + 1).find(m => m.sender_id === currentUserId);
              if (isRead && (!nextOwnMsg || new Date(otherLastRead) < new Date(nextOwnMsg.created_at))) {
                showRead = true;
              }
            }

            return (
              <div key={msg.id}>
                <ChatBubble message={msg} isOwn={isOwn} showTimestamp={idx === messages.length - 1} />
                {showRead && (
                  <div className="text-[10px] text-purple-400 text-right mt-0.5 mr-1">읽음</div>
                )}
              </div>
            );
          })
        )}
        {isTyping && otherUser && <TypingBubble user={otherUser} />}
        <div ref={bottomRef} />
      </div>

      {/* 입력 — 모바일 하단 네비(64px, fixed bottom-0, md:hidden)에 가려지지 않도록 패딩 확보 */}
      <div className="pb-16 md:pb-0">
        <ChatInput onSend={handleSend} onSendCard={handleSendCard} onTyping={sendTyping} />
      </div>
    </div>
  );
}
