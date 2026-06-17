'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Profile } from '@/types';
import { getAvatarColor } from '@/lib/utils/helpers';
import { RefreshCw, Search, UserPlus, Check, X, MoreHorizontal, UserMinus } from 'lucide-react';

interface FriendWithProfile {
  friend_id: string;
  friend: Profile;
}

interface IncomingRequest {
  id: string;
  from_user_id: string;
  created_at: string;
  profile: { id: string; nickname: string; avatar_url: string | null } | null;
}

type SearchStatus = 'none' | 'pending_outgoing' | 'pending_incoming' | 'accepted';
interface SearchResultItem {
  id: string;
  nickname: string;
  avatar_url: string | null;
  status: SearchStatus;
}

export default function FriendsPage() {
  const router = useRouter();
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 검색
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // 친구 카드 메뉴
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // ── 데이터 fetch ─────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoadError(false);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [friendsRes, reqRes] = await Promise.all([
        supabase
          .from('friendships')
          .select('friend_id, friend:profiles!friendships_friend_id_fkey(*)')
          .eq('user_id', user.id)
          .eq('status', 'accepted'),
        fetch('/api/friends/requests'),
      ]);

      setFriends((friendsRes.data || []) as unknown as FriendWithProfile[]);

      if (reqRes.ok) {
        const json = (await reqRes.json()) as { items: IncomingRequest[] };
        setRequests(json.items ?? []);
      }
    } catch {
      // 네트워크 등으로 목록 로드 실패 → 무한 스켈레톤 대신 에러 상태
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // 메뉴 외부 클릭으로 닫기
  useEffect(() => {
    if (!openMenuId) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [openMenuId]);

  // ── 카카오 동기화 ────────────────────────────────────────
  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/kakao/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast(`${data.newFriends ?? 0}명 동기화됨`);
        await fetchAll();
      } else {
        showToast(data.error || '동기화 실패');
      }
    } catch {
      showToast('동기화 실패');
    } finally {
      setSyncing(false);
    }
  };

  // ── 검색 (디바운스 300ms) ────────────────────────────────
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const q = searchQuery.trim();
    if (q.length === 0) {
      setSearchResults([]);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const json = (await res.json()) as { items: SearchResultItem[] };
          setSearchResults(json.items ?? []);
        } else {
          showToast('검색 중 문제가 발생했어요');
        }
      } catch {
        showToast('검색 중 문제가 발생했어요');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery]);

  // ── 친구 요청/수락/거절/끊기 ─────────────────────────────
  const handleRequest = async (targetId: string) => {
    const res = await fetch('/api/friends/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: targetId }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      showToast('친구 요청을 보냈어요');
      setSearchResults((prev) =>
        prev.map((r) => (r.id === targetId ? { ...r, status: 'pending_outgoing' as const } : r)),
      );
    } else {
      showToast(json.error ?? '요청 실패');
    }
  };

  const handleAccept = async (fromId: string) => {
    const res = await fetch('/api/friends/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId: fromId }),
    });
    if (res.ok) {
      showToast('친구가 됐어요');
      setRequests((prev) => prev.filter((r) => r.from_user_id !== fromId));
      setSearchResults((prev) =>
        prev.map((r) => (r.id === fromId ? { ...r, status: 'accepted' as const } : r)),
      );
      await fetchAll();
    } else {
      const json = await res.json().catch(() => ({}));
      showToast(json.error ?? '수락 실패');
    }
  };

  const handleReject = async (fromId: string) => {
    const res = await fetch('/api/friends/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId: fromId }),
    });
    if (res.ok) {
      showToast('요청을 거절했어요');
      setRequests((prev) => prev.filter((r) => r.from_user_id !== fromId));
      setSearchResults((prev) =>
        prev.map((r) => (r.id === fromId ? { ...r, status: 'none' as const } : r)),
      );
    } else {
      showToast('거절 실패');
    }
  };

  const handleRemove = async (targetId: string, nickname: string) => {
    if (!window.confirm(`${nickname}님을 친구에서 끊을까요?`)) return;
    const res = await fetch(`/api/friends/${targetId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('친구를 끊었어요');
      setFriends((prev) => prev.filter((f) => f.friend_id !== targetId));
      setOpenMenuId(null);
    } else {
      showToast('해제 실패');
    }
  };

  const filteredFriends = friends; // 별도 필터 없음 — 검색은 search API 사용

  return (
    <div className="max-w-3xl mx-auto p-8 animate-fade-up">
      <h2 className="text-2xl font-bold mb-6">친구</h2>

      {/* 검색창 */}
      <div className="relative mb-6">
        <Search className="w-4 h-4 text-zinc-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full p-3 pl-10 pr-5 rounded-full bg-zinc-900 border border-zinc-800 text-sm placeholder-zinc-600 outline-none focus:border-zinc-600 transition"
          placeholder="닉네임으로 친구 검색..."
        />
      </div>

      {/* 검색 결과 (검색어 있을 때만) */}
      {searchQuery.trim().length > 0 && (
        <div className="mb-8">
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">검색 결과</h3>
          {searching ? (
            <div className="text-sm text-zinc-500 px-2">검색 중...</div>
          ) : searchResults.length === 0 ? (
            <div className="text-sm text-zinc-600 px-2">일치하는 사용자가 없어요</div>
          ) : (
            <div className="space-y-1">
              {searchResults.map((item) => {
                const colorClass = getAvatarColor(item.nickname);
                return (
                  <div
                    key={item.id}
                    className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-3 flex items-center gap-3"
                  >
                    {item.avatar_url ? (
                      <img src={item.avatar_url} alt={item.nickname} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className={`w-10 h-10 rounded-full ${colorClass} flex items-center justify-center font-bold text-xs`}>
                        {item.nickname.slice(0, 2)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{item.nickname}</div>
                    </div>
                    {item.status === 'none' && (
                      <button
                        onClick={() => handleRequest(item.id)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white text-black text-xs font-semibold hover:bg-zinc-100 transition"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        친구 추가
                      </button>
                    )}
                    {item.status === 'pending_outgoing' && (
                      <span className="text-xs text-zinc-500 px-2">요청 보냄</span>
                    )}
                    {item.status === 'pending_incoming' && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleAccept(item.id)}
                          className="p-1.5 rounded-full bg-white text-black hover:bg-zinc-100 transition"
                          aria-label="수락"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleReject(item.id)}
                          className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                          aria-label="거절"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    {item.status === 'accepted' && (
                      <span className="text-xs text-emerald-400 px-2">이미 친구</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 받은 요청 */}
      {requests.length > 0 && (
        <div className="mb-8">
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">
            받은 요청 · {requests.length}
          </h3>
          <div className="space-y-1">
            {requests.map((r) => {
              const nick = r.profile?.nickname ?? '사용자';
              const colorClass = getAvatarColor(nick);
              return (
                <div
                  key={r.id}
                  className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 flex items-center gap-3"
                >
                  {r.profile?.avatar_url ? (
                    <img src={r.profile.avatar_url} alt={nick} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className={`w-10 h-10 rounded-full ${colorClass} flex items-center justify-center font-bold text-xs`}>
                      {nick.slice(0, 2)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{nick}</div>
                    <div className="text-[11px] text-zinc-500">친구 요청을 보냈어요</div>
                  </div>
                  <button
                    onClick={() => handleAccept(r.from_user_id)}
                    className="px-3 py-1.5 rounded-full bg-white text-black text-xs font-semibold hover:bg-zinc-100 transition"
                  >
                    수락
                  </button>
                  <button
                    onClick={() => handleReject(r.from_user_id)}
                    className="px-3 py-1.5 rounded-full text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                  >
                    거절
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 카톡 친구 헤더 + 동기화 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
          친구 · {filteredFriends.length}명
        </h3>
        <button
          onClick={handleSync}
          disabled={syncing}
          title="카카오 친구 동기화"
          className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 친구 목록 */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-4 animate-pulse flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-zinc-800" />
              <div className="space-y-2 flex-1">
                <div className="w-20 h-4 bg-zinc-800 rounded" />
                <div className="w-32 h-3 bg-zinc-800 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="bg-zinc-900/50 border border-zinc-800/35 rounded-2xl p-8 text-center">
          <p className="text-zinc-300 font-medium mb-1">친구 목록을 불러오지 못했어요</p>
          <p className="text-sm text-zinc-500 mb-5">네트워크 연결을 확인한 뒤 다시 시도해 주세요.</p>
          <button
            onClick={() => { setLoading(true); fetchAll(); }}
            className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-sm font-semibold transition"
          >
            다시 시도
          </button>
        </div>
      ) : filteredFriends.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-zinc-600 text-base">아직 친구가 없어요</div>
          <p className="text-zinc-700 text-sm mt-2">위에서 검색하거나 카톡 친구가 가입하면 자동으로 추가됩니다</p>
        </div>
      ) : (
        <div className="space-y-1">
          {filteredFriends.map((item) => {
            const friend = item.friend;
            const colorClass = getAvatarColor(friend.nickname);
            return (
              <div
                key={item.friend_id}
                className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/35 rounded-xl p-4 flex items-center gap-4 hover:bg-zinc-800/60 hover:border-zinc-700/50 transition-all relative"
              >
                <div
                  onClick={() => router.push(`/friends/${item.friend_id}`)}
                  className="flex items-center gap-4 flex-1 min-w-0 cursor-pointer"
                >
                  {friend.avatar_url ? (
                    <img src={friend.avatar_url} alt={friend.nickname} className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className={`w-12 h-12 rounded-full ${colorClass} flex items-center justify-center font-bold text-sm flex-shrink-0`}>
                      {friend.nickname.slice(0, 2)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{friend.nickname}</div>
                  </div>
                </div>
                <div className="relative" ref={openMenuId === item.friend_id ? menuRef : null}>
                  <button
                    onClick={() => setOpenMenuId(openMenuId === item.friend_id ? null : item.friend_id)}
                    aria-label="메뉴"
                    className="p-1.5 rounded-full text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {openMenuId === item.friend_id && (
                    <div className="absolute right-0 top-9 z-20 min-w-[140px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl py-1 animate-fade-in">
                      <button
                        onClick={() => handleRemove(item.friend_id, friend.nickname)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-zinc-800/60 transition"
                      >
                        <UserMinus className="w-4 h-4" />
                        친구 끊기
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 bg-zinc-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-up">
          {toast}
        </div>
      )}
    </div>
  );
}
