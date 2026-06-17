'use client';

import { useEffect, useState } from 'react';

/**
 * 일정 주기로 갱신되는 현재 시각(ms) 단일 타이머.
 * 리스트에서 카드마다 setInterval 을 두는 대신 상위에서 1회 호출해 공유 →
 * 타이머 K개 + 엇박자 리렌더를 타이머 1개 + 동기 리렌더로 축소.
 */
export function useNowTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
