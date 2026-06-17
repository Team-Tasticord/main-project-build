'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Activity } from '@/types';

/**
 * 본인+친구의 추천 카드(activity_type='recommend')를 받아오는 훅.
 * useNowPlayingFeed와 패턴 동일 — 60초 주기 새로고침 + 탭 활성화 시 즉시 갱신.
 *
 * stale-while-revalidate: 재방문 시 직전 추천 피드를 localStorage 캐시에서 즉시 표시하고
 * 백그라운드로 갱신 → 스켈레톤 대기 없이 바로 뜨는 체감.
 */
const REFRESH_MS = 60 * 1000;
const CACHE_KEY = 'tasticord:recommendFeed:v1';

const subscribeNoop = () => () => {};

function readCache(): Activity[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Activity[]) : [];
  } catch {
    return [];
  }
}

export function useRecommendFeed() {
  const hydrated = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [items, setItems] = useState<Activity[]>([]);
  const [fetched, setFetched] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/feed/recommendations');
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = (await res.json()) as { items: Activity[] };
      const next = data.items ?? [];
      setItems(next);
      setError(false);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(next));
      } catch {
        /* 저장 한도 초과 등은 무시 */
      }
    } catch (e) {
      console.error('[RecommendFeed] load failed:', e);
      setError(true);
    } finally {
      setFetched(true);
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

  // 서버 응답 전엔 캐시 즉시 표시, 응답 오면 신선 데이터로 교체 (hydration-safe).
  const cached = hydrated && !fetched ? readCache() : [];
  const displayItems = fetched ? items : cached;
  const loading = !hydrated ? true : !fetched && cached.length === 0;

  return { items: displayItems, loading, error, refresh: load };
}
