'use client';

import Avatar from '@/components/ui/Avatar';
import PlatformTag from '@/components/ui/PlatformTag';
import { timeAgo } from '@/lib/utils/helpers';
import type { NowPlayingItem } from '@/hooks/useNowPlayingFeed';

interface Props {
  item: NowPlayingItem;
  // 현재 시각(ms). 상위 NowPlayingList 의 단일 타이머에서 주입(카드별 setInterval 제거).
  nowTs: number;
}

const LIVE_THRESHOLD_MS = 4 * 60 * 1000; // 4분 이내 = 지금 활동 중

const KIND_LABEL: Record<NowPlayingItem['kind'], string> = {
  music: 'LISTENING NOW',
  game: 'PLAYING NOW',
};

const KIND_COLOR: Record<NowPlayingItem['kind'], string> = {
  music: 'text-emerald-400',
  game: 'text-blue-400',
};

const KIND_GLOW: Record<NowPlayingItem['kind'], string> = {
  music: 'shadow-[0_0_20px_rgba(16,185,129,.12)]',
  game: 'shadow-[0_0_20px_rgba(59,130,246,.12)]',
};

const RECENT_LABEL: Record<NowPlayingItem['kind'], string> = {
  music: 'RECENTLY PLAYED',
  game: 'RECENTLY PLAYED',
};

export default function NowPlayingCard({ item, nowTs }: Props) {
  const playedAtMs = new Date(item.played_at).getTime();
  const isLive = nowTs - playedAtMs < LIVE_THRESHOLD_MS;
  const nickname = item.profiles?.nickname ?? '사용자';
  const avatarUrl = item.profiles?.avatar_url ?? undefined;
  const glow = isLive ? KIND_GLOW[item.kind] : '';
  const liveColor = KIND_COLOR[item.kind];

  return (
    <div
      className={`bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/35 rounded-2xl p-6 transition-all hover:scale-[1.005] ${glow}`}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center space-x-3">
          <Avatar name={nickname} imageUrl={avatarUrl} online={isLive} />
          <div>
            <span className="font-semibold">{nickname}</span>
            {isLive ? (
              <span
                className={`ml-2 text-xs font-bold tracking-wider uppercase ${liveColor}`}
              >
                <span className="inline-block animate-pulse">●</span>{' '}
                {KIND_LABEL[item.kind]}
              </span>
            ) : (
              <span className="ml-2 text-xs font-medium tracking-wider uppercase text-zinc-500">
                {RECENT_LABEL[item.kind]}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs text-zinc-500">{timeAgo(item.played_at)}</span>
          <div className="mt-0.5">
            <PlatformTag platform={item.platform} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {item.album_image_url ? (
          <div
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg flex-shrink-0 bg-cover bg-center bg-zinc-800"
            style={{ backgroundImage: `url('${item.album_image_url}')` }}
          />
        ) : (
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg flex-shrink-0 bg-zinc-800" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-zinc-100 text-base truncate">{item.title}</div>
          {item.artist && (
            <div className="text-sm text-zinc-400 mt-0.5 truncate">{item.artist}</div>
          )}
          {item.external_url && (
            <a
              href={item.external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 text-xs text-zinc-300 hover:text-white transition"
            >
              열어보기 ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
