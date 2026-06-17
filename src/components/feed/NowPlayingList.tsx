'use client';

import NowPlayingCard from './NowPlayingCard';
import { useNowTick } from '@/hooks/useNowTick';
import type { NowPlayingItem } from '@/hooks/useNowPlayingFeed';

// 카드별 setInterval 대신 단일 타이머를 여기서 관리.
// 30s 주기 틱은 이 리스트 서브트리만 리렌더 → FeedPage/FeedCard는 영향 없음.
const NOW_TICK_MS = 30 * 1000;

export default function NowPlayingList({ items }: { items: NowPlayingItem[] }) {
  const nowTs = useNowTick(NOW_TICK_MS);
  return (
    <>
      {items.map((item) => (
        <NowPlayingCard
          key={`np-${item.user_id}-${item.kind}`}
          item={item}
          nowTs={nowTs}
        />
      ))}
    </>
  );
}
