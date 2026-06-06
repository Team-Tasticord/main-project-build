'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MessageCircle, Music, Plus, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import Avatar from '@/components/ui/Avatar';
import { timeAgo } from '@/lib/utils/helpers';
import type { Profile } from '@/types';

interface ChatRoomItem {
  id: string;
  type: string;
  created_at: string;
  otherUser: Profile | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

interface PlaylistListItem {
  id: string;
  name: string;
  cover_url: string | null;
  updated_at: string;
  memberCount: number;
  songCount: number;
  myRole: 'owner' | 'editor' | 'viewer';
}

type TabKey = 'chats' | 'playlists';

// 역할 뱃지 스타일
const roleLabel = (role: string) => (role === 'owner' ? '방장' : role === 'editor' ? '편집자' : '뷰어');
const roleBadgeClass = (role: string) =>
  role === 'owner'
    ? 'bg-purple-600/20 text-purple-400'
    : role === 'editor'
    ? 'bg-blue-600/20 text-blue-400'
    : 'bg-zinc-700/20 text-zinc-400';

// 카드 임베드 프리뷰 문구
const previewFor = (embed_type: string | null, content: string | null): string => {
  if (embed_type === 'music') return '🎵 음악 추천 카드';
  if (embed_type === 'game') return '🎮 게임 추천 카드';
  if (embed_type === 'movie') return '🎬 영화/드라마 추천 카드';
  return content || '';
};

function MessagesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  // URL ?tab=playlists 로 초기 탭 결정
  const initialTab: TabKey = searchParams.get('tab') === 'playlists' ? 'playlists' : 'chats';
  const [tab, setTab] = useState<TabKey>(initialTab);

  // 대화 탭 상태
  const [chatRooms, setChatRooms] = useState<ChatRoomItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 플레이리스트 탭 상태
  const [playlists, setPlaylists] = useState<PlaylistListItem[]>([]);
  const [plLoading, setPlLoading] = useState(true);

  // 플레이리스트 생성 모달 상태
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [friendOptions, setFriendOptions] = useState<Profile[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  // 탭 변경 시 URL 업데이트 (뒤로 가기 등에 대응)
  const switchTab = (next: TabKey) => {
    setTab(next);
    const url = next === 'playlists' ? '/messages?tab=playlists' : '/messages';
    window.history.replaceState(null, '', url);
  };

  // 대화 목록 로드 — N+1 쿼리 제거: 방 개수 상관없이 ~4개 쿼리로 처리한다.
  useEffect(() => {
    async function fetchData() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // [쿼리 1] 내 멤버십 (room_id + last_read_at) — 조인 한 번에 끝
      const { data: myMemberDetails } = await supabase
        .from('chat_members')
        .select('room_id, last_read_at')
        .eq('user_id', user.id);

      if (!myMemberDetails || myMemberDetails.length === 0) {
        setLoading(false);
        return;
      }

      const roomIds = myMemberDetails.map((m) => m.room_id);
      const lastReadMap: Record<string, string> = {};
      for (const m of myMemberDetails) {
        lastReadMap[m.room_id] = m.last_read_at;
      }

      // [쿼리 2] 방 정보 — DM만 필터
      const { data: rooms } = await supabase
        .from('chat_rooms')
        .select('*')
        .in('id', roomIds)
        .eq('type', 'dm');

      if (!rooms || rooms.length === 0) {
        setChatRooms([]);
        setLoading(false);
        return;
      }

      const dmRoomIds = rooms.map((r) => r.id);

      // [쿼리 3] 모든 DM 방의 멤버를 한 번에 — 클라이언트에서 room_id로 그룹화
      const { data: allMembers } = await supabase
        .from('chat_members')
        .select('room_id, user_id, profile:profiles(*)')
        .in('room_id', dmRoomIds);

      const membersByRoom: Record<string, Array<{ user_id: string; profile: Profile | null }>> = {};
      for (const m of allMembers || []) {
        const row = m as unknown as { room_id: string; user_id: string; profile: Profile | null };
        if (!membersByRoom[row.room_id]) membersByRoom[row.room_id] = [];
        membersByRoom[row.room_id].push({ user_id: row.user_id, profile: row.profile });
      }

      // [쿼리 4] 모든 방의 메시지를 한 번에 — 최근 메시지 + 안읽은 카운트 집계를 클라에서 처리
      //   · `limit(roomIds.length * 30)` 은 room 당 평균 30개 정도의 최근 메시지를 가정한 근사치.
      //   · 정확한 "각 방의 마지막 메시지 1개씩"은 RPC나 window function이 필요한데,
      //     RLS 제한 하에서 과도한 복잡도이므로 created_at desc 로 받은 뒤 room_id 당 첫 row = last message 로 처리.
      //   · unread count: 각 방별 last_read_at 이후 + sender != me 인 메시지만 카운트.
      const { data: recentMessages } = await supabase
        .from('chat_messages')
        .select('room_id, sender_id, content, embed_type, created_at')
        .in('room_id', dmRoomIds)
        .order('created_at', { ascending: false })
        .limit(Math.max(dmRoomIds.length * 30, 60));

      // 방별로 "가장 최근 메시지" 1개, 그리고 unread 카운트 누적
      const lastMsgByRoom: Record<string, { content: string | null; embed_type: string | null; created_at: string }> = {};
      const unreadByRoom: Record<string, number> = {};
      for (const msg of recentMessages || []) {
        const rid = msg.room_id;
        // 최신부터 내려오니 처음 만난 row가 가장 최신 메시지
        if (!lastMsgByRoom[rid]) {
          lastMsgByRoom[rid] = {
            content: msg.content,
            embed_type: msg.embed_type,
            created_at: msg.created_at,
          };
        }
        // unread: last_read 이후 + 내가 보낸 게 아닐 때
        const lastRead = lastReadMap[rid];
        if (lastRead && msg.sender_id !== user.id && new Date(msg.created_at) > new Date(lastRead)) {
          unreadByRoom[rid] = (unreadByRoom[rid] || 0) + 1;
        }
      }

      const roomItems: ChatRoomItem[] = rooms.map((room) => {
        const members = membersByRoom[room.id] || [];
        const other = members.find((m) => m.user_id !== user.id);
        const last = lastMsgByRoom[room.id];
        return {
          id: room.id,
          type: room.type,
          created_at: room.created_at,
          otherUser: other?.profile || null,
          lastMessage: last ? previewFor(last.embed_type, last.content) : null,
          lastMessageAt: last?.created_at || null,
          unreadCount: unreadByRoom[room.id] || 0,
        };
      });

      // 마지막 메시지 시간 기준 정렬
      roomItems.sort((a, b) => {
        const timeA = a.lastMessageAt || a.created_at;
        const timeB = b.lastMessageAt || b.created_at;
        return new Date(timeB).getTime() - new Date(timeA).getTime();
      });

      setChatRooms(roomItems);
      setLoading(false);
    }
    fetchData();
  }, [supabase]);

  // 플레이리스트 목록 로드
  const reloadPlaylists = async () => {
    const res = await fetch('/api/playlists/list');
    if (!res.ok) return;
    const json = await res.json();
    setPlaylists(json.playlists || []);
  };

  useEffect(() => {
    async function fetchPlaylists() {
      try {
        await reloadPlaylists();
      } finally {
        setPlLoading(false);
      }
    }
    fetchPlaylists();
  }, []);

  // 새 메시지 수신 시 미리보기·시간·안읽은수 실시간 업데이트
  useEffect(() => {
    const channel = supabase
      .channel('messages-list-updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        async (payload) => {
          const newMsg = payload.new as {
            room_id: string;
            sender_id: string;
            content: string | null;
            embed_type: string | null;
            created_at: string;
          };

          const preview = previewFor(newMsg.embed_type, newMsg.content);

          const { data: { user } } = await supabase.auth.getUser();
          const isOwnMessage = user && newMsg.sender_id === user.id;

          setChatRooms((prev) => {
            const updated = prev.map((room) => {
              if (room.id !== newMsg.room_id) return room;
              return {
                ...room,
                lastMessage: preview,
                lastMessageAt: newMsg.created_at,
                unreadCount: isOwnMessage ? room.unreadCount : room.unreadCount + 1,
              };
            });
            // 최신 메시지 순으로 재정렬
            return updated.sort((a, b) => {
              const timeA = a.lastMessageAt || a.created_at;
              const timeB = b.lastMessageAt || b.created_at;
              return new Date(timeB).getTime() - new Date(timeA).getTime();
            });
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // 플레이리스트 만들기 모달 열기 — 친구 목록 로드
  const openCreateModal = async () => {
    setCreateOpen(true);
    setNewName('');
    setSelectedFriendIds([]);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('friendships')
      .select('friend:profiles!friendships_friend_id_fkey(*)')
      .eq('user_id', user.id)
      .eq('status', 'accepted'); // P-001: accepted 친구만 플레이리스트 멤버 후보

    const friends = ((data || []) as unknown as Array<{ friend: Profile | null }>)
      .map((row) => row.friend)
      .filter((f): f is Profile => !!f);
    setFriendOptions(friends);
  };

  const toggleFriend = (id: string) => {
    setSelectedFriendIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleCreatePlaylist = async () => {
    const trimmed = newName.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, memberIds: selectedFriendIds }),
      });
      if (!res.ok) {
        console.error('[Playlist] 생성 실패');
        setCreating(false);
        return;
      }
      const playlist = await res.json();
      setCreateOpen(false);
      if (playlist?.id) {
        router.push(`/playlists/${playlist.id}`);
      } else {
        // 생성 후 이동이 안 되면 목록이라도 새로고침
        await reloadPlaylists();
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-8 animate-fade-up">
      <h2 className="text-2xl font-bold mb-6">메시지</h2>

      {/* 탭 */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => switchTab('chats')}
          className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
            tab === 'chats' ? 'bg-purple-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }`}
        >
          대화
        </button>
        <button
          onClick={() => switchTab('playlists')}
          className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
            tab === 'playlists' ? 'bg-purple-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }`}
        >
          플레이리스트
        </button>
      </div>

      {tab === 'chats' ? (
        <>
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">대화</h3>
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-4 animate-pulse flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-zinc-800" />
                  <div className="space-y-2 flex-1">
                    <div className="w-20 h-4 bg-zinc-800 rounded" />
                    <div className="w-40 h-3 bg-zinc-800 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : chatRooms.length === 0 ? (
            <div className="bg-zinc-900/50 border border-zinc-800/35 rounded-2xl p-8 text-center">
              <MessageCircle className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-500">대화가 없습니다</p>
              <p className="text-zinc-600 text-sm mt-1">친구 페이지에서 메시지를 보내보세요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {chatRooms.map((room) => (
                <button
                  key={room.id}
                  onClick={() => router.push(`/messages/${room.id}`)}
                  className="w-full bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-4 flex items-center gap-4 hover:bg-zinc-800/50 transition text-left"
                >
                  <Avatar
                    name={room.otherUser?.nickname || '?'}
                    imageUrl={room.otherUser?.avatar_url}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">
                      {room.otherUser?.nickname || '알 수 없음'}
                    </p>
                    <p className="text-xs text-zinc-400 truncate mt-0.5">
                      {room.lastMessage || '메시지가 없습니다'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {room.lastMessageAt && (
                      <span className="text-[10px] text-zinc-400">
                        {timeAgo(room.lastMessageAt)}
                      </span>
                    )}
                    {room.unreadCount > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-purple-600 text-[10px] font-bold flex items-center justify-center">
                        {room.unreadCount > 99 ? '99+' : room.unreadCount}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        // 플레이리스트 탭
        <>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
              내 플레이리스트
            </h3>
            <button
              onClick={openCreateModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 backdrop-blur-sm transition"
            >
              <Plus className="w-3.5 h-3.5" />
              플레이리스트 만들기
            </button>
          </div>
          {plLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-4 animate-pulse flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-zinc-800" />
                  <div className="space-y-2 flex-1">
                    <div className="w-20 h-4 bg-zinc-800 rounded" />
                    <div className="w-40 h-3 bg-zinc-800 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : playlists.length === 0 ? (
            <div className="bg-zinc-900/50 border border-zinc-800/35 rounded-2xl p-8 text-center">
              <Music className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-500">플레이리스트가 없습니다</p>
              <p className="text-zinc-600 text-sm mt-1">친구와 함께 공유 플레이리스트를 만들어 보세요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => router.push(`/playlists/${pl.id}`)}
                  className="w-full bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-4 flex items-center gap-4 hover:bg-zinc-800/50 transition text-left"
                >
                  {pl.cover_url ? (
                    <div
                      className="w-12 h-12 rounded-lg bg-cover bg-center bg-zinc-800 flex-shrink-0"
                      style={{ backgroundImage: `url('${pl.cover_url}')` }}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-600/30 to-pink-600/30 flex-shrink-0 flex items-center justify-center">
                      <Music className="w-5 h-5 text-zinc-200" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{pl.name}</p>
                    <p className="text-xs text-zinc-400 truncate mt-0.5">
                      {pl.songCount}곡 · 멤버 {pl.memberCount}명
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${roleBadgeClass(pl.myRole)}`}>
                    {roleLabel(pl.myRole)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* 플레이리스트 생성 모달 */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-zinc-900/90 border border-zinc-800/60 rounded-2xl p-6 backdrop-blur-xl animate-fade-up">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold">플레이리스트 만들기</h4>
              <button
                onClick={() => setCreateOpen(false)}
                className="text-zinc-500 hover:text-white transition"
                aria-label="닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
              이름
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="플레이리스트 이름"
              className="w-full mb-4 p-3 px-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm placeholder-zinc-600 outline-none focus:border-purple-500/60 transition"
              maxLength={60}
            />

            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
              함께할 친구 (선택)
            </label>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/60 mb-5">
              {friendOptions.length === 0 ? (
                <p className="text-center text-zinc-600 text-xs py-4">친구가 없습니다</p>
              ) : (
                friendOptions.map((f) => {
                  const selected = selectedFriendIds.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => toggleFriend(f.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-800/50 transition ${
                        selected ? 'bg-purple-600/10' : ''
                      }`}
                    >
                      <Avatar name={f.nickname} imageUrl={f.avatar_url} size="sm" />
                      <span className="flex-1 text-sm truncate">{f.nickname}</span>
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                          selected ? 'bg-purple-600 border-purple-500 text-white' : 'border-zinc-700'
                        }`}
                      >
                        {selected ? '✓' : ''}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setCreateOpen(false)}
                className="px-4 py-2 rounded-full text-sm font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
              >
                취소
              </button>
              <button
                onClick={handleCreatePlaylist}
                disabled={!newName.trim() || creating}
                className="px-4 py-2 rounded-full text-sm font-semibold bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {creating ? '만드는 중...' : '만들기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// useSearchParams는 Suspense로 감싸야 함 (Next.js 요구사항)
export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="max-w-3xl mx-auto p-8" />}>
      <MessagesPageInner />
    </Suspense>
  );
}
