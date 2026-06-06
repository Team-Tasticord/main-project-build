'use client';

import { useEffect, useState } from 'react';

/**
 * 친구 비교 페이지 진입 시 본인 taste_profiles 스냅샷을 백그라운드로 갱신 요청.
 * - 페이지 단위 호출 — 다른 페이지를 돌아다닐 때는 호출되지 않음
 * - 서버 48h 가드(/api/taste-profile/refresh)가 TTL을 판정 → fresh면 즉시 스킵
 * - 클라이언트도 localStorage로 48h 쓰로틀 — 짧은 시간 안의 반복 진입에서 네트워크 라운드트립도 차단
 *
 * 스키마 마이그레이션:
 *   기존 taste_profiles 행은 games.images / movies.images 필드가 없음.
 *   localStorage 의 schemaVersion 이 현재 보다 낮으면 첫 호출을 force=true 로 보내고
 *   완료까지 ready=false 로 유지 → 호출부가 stale 데이터로 비교를 먼저 그리지 않도록 함.
 *   이후엔 정상 TTL 흐름 (fire-and-forget).
 *
 * 사용처: /friends/[userId] (취향 비교 페이지) 에서 1회 호출
 */
const CLIENT_THROTTLE_MS = 48 * 60 * 60 * 1000; // 48h
const LS_KEY = 'tasticord:taste-profile:lastPing';
const SCHEMA_KEY = 'tasticord:taste-profile:schemaVersion';
const SCHEMA_VERSION = 2; // v2 = games.images / movies.images 필드 추가

function readSchemaVersion(): number {
  if (typeof window === 'undefined') return 0;
  return Number(window.localStorage.getItem(SCHEMA_KEY) ?? 0);
}

export function useTasteProfileSync(): { ready: boolean } {
  // 마이그레이션이 필요한 사용자는 ready=false 로 시작, 갱신 완료 후 true
  // 그 외 사용자는 즉시 ready=true (fire-and-forget 흐름)
  const [ready, setReady] = useState<boolean>(() => readSchemaVersion() >= SCHEMA_VERSION);

  useEffect(() => {
    let cancelled = false;
    const needsMigration = readSchemaVersion() < SCHEMA_VERSION;

    // 마이그레이션이 필요 없으면 throttle 적용, 필요하면 강제 통과
    if (!needsMigration) {
      const last = Number(localStorage.getItem(LS_KEY) ?? 0);
      if (Date.now() - last < CLIENT_THROTTLE_MS) return;
    }

    (async () => {
      try {
        const res = await fetch('/api/taste-profile/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: needsMigration }),
        });
        if (cancelled) return;
        if (res.ok) {
          localStorage.setItem(LS_KEY, String(Date.now()));
          if (needsMigration) localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION));
        }
      } catch {
        // 실패해도 다음 진입 때 재시도 — 조용히 무시
      } finally {
        if (!cancelled && needsMigration) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { ready };
}
