'use client';

import { useEffect, useMemo, useState } from 'react';
import NowPlayingList from '@/components/feed/NowPlayingList';
import FeedCard from '@/components/feed/FeedCard';
import CreatePostBox from '@/components/feed/CreatePostBox';
import Chip from '@/components/ui/Chip';
import { createClient } from '@/lib/supabase/client';
import { useNowPlayingFeed } from '@/hooks/useNowPlayingFeed';
import { useRecommendFeed } from '@/hooks/useRecommendFeed';
import { FEED_FILTERS, FILTER_TO_PLATFORM } from '@/lib/utils/constants';

export default function FeedPage() {
  const [activeFilter, setActiveFilter] = useState<string>('전체');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const { items: nowPlayingItems, loading: loadingNow, refresh: refreshNow } = useNowPlayingFeed();
  const { items: recommendItems, loading: loadingRec, refresh: refreshRec } = useRecommendFeed();

  // 본인 user id 1회 조회 — 삭제 메뉴 노출 여부 판단용
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);

  // 홈 페이지 진입 시 본인 캐시도 즉시 갱신
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await fetch('/api/now-playing/sync', { method: 'POST' });
      } catch {
        // sync 실패해도 피드 자체는 useNowPlayingFeed가 이미 호출 중이라 무시
      }
      if (!cancelled) refreshNow();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshNow]);

  const filteredNowPlaying = useMemo(() => {
    const platforms = FILTER_TO_PLATFORM[activeFilter];
    if (!platforms || platforms.length === 0) return nowPlayingItems;
    return nowPlayingItems.filter((it) => platforms.includes(it.platform));
  }, [nowPlayingItems, activeFilter]);

  const filteredRecommends = useMemo(() => {
    const platforms = FILTER_TO_PLATFORM[activeFilter];
    const notDeleted = recommendItems.filter((it) => !deletedIds.has(it.id));
    // '전체' 필터일 땐 모두 보여줌 (텍스트 only tasticord 포함)
    if (!platforms || platforms.length === 0) return notDeleted;
    return notDeleted.filter((it) => platforms.includes(it.platform));
  }, [recommendItems, activeFilter, deletedIds]);

  const handleDeleted = (id: string) => {
    setDeletedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // 백그라운드로 피드 새로고침 (소스 데이터도 정리)
    refreshRec();
  };

  const loading = loadingNow || loadingRec;

  return (
    <div className="animate-fade-up">
      {/* 섹션 필터 */}
      <div className="sticky top-0 z-10 bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800/50 px-8 py-4">
        <div className="flex space-x-2 max-w-3xl mx-auto">
          {FEED_FILTERS.map((filter) => (
            <Chip
              key={filter}
              label={filter}
              active={activeFilter === filter}
              onClick={() => setActiveFilter(filter)}
            />
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-8">
        {/* 컴포저 — 실시간 피드 위 박스 */}
        <CreatePostBox onPosted={refreshRec} />

        <div className="space-y-6">
          {loading ? (
            <div className="space-y-6">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/35 rounded-2xl p-6 animate-pulse"
                >
                  <div className="flex items-center space-x-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-zinc-800" />
                    <div className="space-y-2">
                      <div className="w-24 h-4 bg-zinc-800 rounded" />
                      <div className="w-16 h-3 bg-zinc-800 rounded" />
                    </div>
                  </div>
                  <div className="w-full h-32 bg-zinc-800 rounded-xl" />
                </div>
              ))}
            </div>
          ) : filteredNowPlaying.length === 0 && filteredRecommends.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-zinc-400 text-lg">
                {activeFilter === '전체'
                  ? '아직 활동이 없어요'
                  : `${activeFilter} 활동이 없어요`}
              </div>
              <p className="text-zinc-500 text-sm mt-2">
                플랫폼을 연동하거나 위에서 글을 올려보세요
              </p>
            </div>
          ) : (
            <>
              {/* 실시간 — 상단 핀 (단일 타이머는 NowPlayingList 내부) */}
              <NowPlayingList items={filteredNowPlaying} />
              {/* 추천/포스트 — 하단 */}
              {filteredRecommends.map((activity) => (
                <FeedCard
                  key={`rec-${activity.id}`}
                  activity={activity}
                  currentUserId={currentUserId}
                  onDeleted={handleDeleted}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
