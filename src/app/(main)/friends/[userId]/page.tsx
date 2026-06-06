'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ChevronLeft, MessageCircle, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Profile } from '@/types';
import { getAvatarColor } from '@/lib/utils/helpers';
import TasteWrapped from '@/components/compare/TasteWrapped';
import { useTasteProfileSync } from '@/hooks/useTasteProfileSync';

export default function FriendDetailPage() {
  const router = useRouter();
  const params = useParams();
  // 친구 비교 페이지 진입 시에만 본인 taste_profiles 갱신 ping (TTL 48h)
  // 스키마 마이그레이션이 필요한 첫 진입에는 ready=false 로 잠시 대기
  const { ready: profileReady } = useTasteProfileSync();
  const [friend, setFriend] = useState<Profile | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    async function fetchAll() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const friendQ = supabase
        .from('profiles')
        .select('*')
        .eq('id', params.userId as string)
        .single();

      const meQ = user
        ? supabase.from('profiles').select('*').eq('id', user.id).single()
        : Promise.resolve({ data: null });

      const [{ data: friendData }, { data: meData }] = await Promise.all([friendQ, meQ]);

      setFriend(friendData as Profile);
      setMe(meData as Profile | null);
      setLoading(false);
    }
    fetchAll();
  }, [params.userId]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <div className="animate-pulse space-y-4">
          <div className="w-20 h-20 rounded-full bg-zinc-800 mx-auto" />
          <div className="w-32 h-6 bg-zinc-800 rounded mx-auto" />
        </div>
      </div>
    );
  }

  if (!friend) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center">
        <p className="text-zinc-500">친구를 찾을 수 없습니다</p>
      </div>
    );
  }

  const colorClass = getAvatarColor(friend.nickname);

  return (
    <div className="max-w-3xl mx-auto p-8 animate-fade-up">
      <button
        onClick={() => router.push('/friends')}
        className="flex items-center gap-2 text-zinc-400 hover:text-white transition mb-6 text-sm"
      >
        <ChevronLeft className="w-5 h-5" />
        친구 목록
      </button>

      <div className="text-center mb-8">
        {friend.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={friend.avatar_url} alt={friend.nickname} className="w-20 h-20 rounded-full mx-auto mb-3 object-cover" />
        ) : (
          <div className={`w-20 h-20 rounded-full ${colorClass} flex items-center justify-center font-bold text-2xl mx-auto mb-3`}>
            {friend.nickname.slice(0, 2)}
          </div>
        )}
        <div className="text-xl font-bold">{friend.nickname}</div>

        <button
          onClick={async () => {
            setChatLoading(true);
            try {
              const res = await fetch('/api/chat/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ friendId: friend.id }),
              });
              const data = await res.json();
              if (res.ok && data.room) {
                router.push(`/messages/${data.room.id}`);
              } else {
                console.error('Chat room creation failed:', data);
              }
            } catch {
              console.error('Failed to create chat room');
            }
            setChatLoading(false);
          }}
          disabled={chatLoading}
          className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-sm font-medium transition disabled:opacity-50"
        >
          {chatLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <MessageCircle className="w-4 h-4" />
          )}
          메시지 보내기
        </button>
      </div>

      {profileReady ? (
        <TasteWrapped
          friendId={friend.id}
          friendName={friend.nickname}
          friendAvatarUrl={friend.avatar_url ?? null}
          meName={me?.nickname ?? '나'}
          meAvatarUrl={me?.avatar_url ?? null}
        />
      ) : (
        <div className="text-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500 mx-auto mb-3" />
          <div className="text-sm text-zinc-400">취향 데이터를 준비 중...</div>
          <div className="text-xs text-zinc-600 mt-1">Spotify · Steam · Netflix 정보를 모으고 있어요</div>
        </div>
      )}
    </div>
  );
}
