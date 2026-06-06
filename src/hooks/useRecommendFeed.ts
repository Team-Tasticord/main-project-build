'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Activity } from '@/types';

/**
 * 본인+친구의 추천 카드(activity_type='recommend')를 받아오는 훅.
 * useNowPlayingFeed와 패턴 동일 — 60초 주기 새로고침 + 탭 활성화 시 즉시 갱신.
 */
const REFRESH_MS = 60 * 1000;

export function useRecommendFeed() {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/feed/recommendations');
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = (await res.json()) as { items: Activity[] };
      setItems(data.items ?? []);
      setError(false);
    } catch (e) {
      console.error('[RecommendFeed] load failed:', e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
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
