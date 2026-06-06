'use client';

import { useCallback, useEffect, useState } from 'react';

export type NowPlayingItem = {
  user_id: string;
  kind: 'music' | 'game';
  platform: string;
  track_id: string | null;
  title: string;
  artist: string | null;
  album_image_url: string | null;
  external_url: string | null;
  played_at: string;
  profiles: {
    nickname: string;
    avatar_url: string | null;
  } | null;
};

const FEED_REFRESH_MS = 60 * 1000; // 60초마다 피드 새로고침 (다른 사람의 신규 캐시 반영)

/**
 * 본인+친구의 현재 듣는 노래 캐시를 받아오는 훅.
 * 30초 주기로 재호출하며, 탭 보이지 않으면 일시정지.
 */
export function useNowPlayingFeed() {
  const [items, setItems] = useState<NowPlayingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/now-playing/feed');
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = (await res.json()) as { items: NowPlayingItem[] };
      setItems(data.items ?? []);
      setError(false);
    } catch (e) {
      console.error('[NowPlayingFeed] load failed:', e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();

    const tick = () => {
      if (!document.hidden) load();
    };
    const interval = setInterval(tick, FEED_REFRESH_MS);

    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { items, loading, error, refresh: load };
}
