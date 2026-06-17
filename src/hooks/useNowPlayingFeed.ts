'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

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
const CACHE_KEY = 'tasticord:nowPlayingFeed:v1';

// useSyncExternalStore: 서버 스냅샷=false / 클라 스냅샷=true.
// hydration mismatch 없이 "클라에서 마운트됨"을 감지 (localStorage는 클라에서만 읽기 위함).
const subscribeNoop = () => () => {};

function readCache(): NowPlayingItem[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as NowPlayingItem[]) : [];
  } catch {
    return [];
  }
}

/**
 * 본인+친구의 현재 듣는 노래 캐시를 받아오는 훅.
 * 60초 주기로 재호출하며, 탭 보이지 않으면 일시정지.
 *
 * stale-while-revalidate: 재방문 시 직전 피드를 localStorage 캐시에서 "즉시" 보여주고(스켈레톤 없이),
 * 백그라운드로 새 데이터를 받아 교체한다. (대형 SNS 피드가 "바로 뜨는" 방식)
 */
export function useNowPlayingFeed() {
  const hydrated = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [items, setItems] = useState<NowPlayingItem[]>([]);
  const [fetched, setFetched] = useState(false); // 서버에서 1회 이상 받아왔는지
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/now-playing/feed');
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = (await res.json()) as { items: NowPlayingItem[] };
      const next = data.items ?? [];
      setItems(next);
      setError(false);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(next));
      } catch {
        /* 저장 한도 초과 등은 무시 */
      }
    } catch (e) {
      console.error('[NowPlayingFeed] load failed:', e);
      setError(true);
    } finally {
      setFetched(true);
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

  // 서버 응답 전엔 캐시를 즉시 표시, 응답 오면 신선 데이터로 교체.
  // hydration 동안(hydrated=false)엔 서버 렌더와 동일하게 빈/로딩 상태 유지 → mismatch 없음.
  const cached = hydrated && !fetched ? readCache() : [];
  const displayItems = fetched ? items : cached;
  const loading = !hydrated ? true : !fetched && cached.length === 0;

  return { items: displayItems, loading, error, refresh: load };
}
