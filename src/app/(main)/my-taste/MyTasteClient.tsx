'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Gamepad2, Clock, Trophy, Loader2, Music, Film, ShieldAlert, Mic2 } from 'lucide-react';
import NetflixUpload from '@/components/NetflixUpload';
import type { GameTabData } from './_data/game-tab';

// Steam 게임 헤더 이미지 URL (Store API 프록시 경유 — 정확한 이미지 보장)
function getSteamHeaderUrl(appId: number) {
  return `/api/steam/image?appid=${appId}`;
}

// 이미지 로드 실패 시 텍스트 fallback
function handleImgError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  img.style.display = 'none';
  const parent = img.parentElement;
  if (parent && !parent.querySelector('.img-fallback')) {
    const fallbackDiv = document.createElement('div');
    fallbackDiv.className = 'img-fallback absolute inset-0 bg-zinc-800 flex items-center justify-center p-2';
    fallbackDiv.innerHTML = `<span class="text-xs text-zinc-400 text-center font-medium">${img.alt}</span>`;
    parent.style.position = 'relative';
    parent.appendChild(fallbackDiv);
  }
}

// 플레이타임(분)을 읽기 쉽게 변환
function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours.toLocaleString()}시간`;
  return `${minutes}분`;
}

interface GenreStat {
  name: string;
  playtime: number;
  count: number;
}

// 장르별 색상
const GENRE_COLORS: Record<string, string> = {
  'Action': 'bg-red-500',
  '액션': 'bg-red-500',
  'Adventure': 'bg-emerald-500',
  '어드벤처': 'bg-emerald-500',
  'RPG': 'bg-purple-500',
  'Strategy': 'bg-blue-500',
  '전략': 'bg-blue-500',
  'Simulation': 'bg-cyan-500',
  '시뮬레이션': 'bg-cyan-500',
  'Sports': 'bg-orange-500',
  '스포츠': 'bg-orange-500',
  'Racing': 'bg-yellow-500',
  '레이싱': 'bg-yellow-500',
  'Indie': 'bg-pink-500',
  '인디': 'bg-pink-500',
  'Casual': 'bg-lime-500',
  '캐주얼': 'bg-lime-500',
  'Free to Play': 'bg-teal-500',
  '무료 플레이': 'bg-teal-500',
  'Massively Multiplayer': 'bg-violet-500',
  'Early Access': 'bg-amber-500',
  '앞서 해보기': 'bg-amber-500',
};

interface Achievement {
  gameName: string;
  appid: number;
  name: string;
  description: string;
  icon: string;
  unlockedAt: number;
  globalPercent: number | null;
}

// Spotify 관련 타입
interface SpotifyArtistItem {
  id: string;
  name: string;
  image: string | null;
  genres: string[];
  url: string;
}

interface SpotifyTrackItem {
  id: string;
  name: string;
  artist: string;
  album: string;
  image: string | null;
  duration_ms: number;
  url: string;
}

interface SpotifyRecentItem extends SpotifyTrackItem {
  played_at: string;
}

interface SpotifyGenreStat {
  name: string;
  count: number;
  percentage: number;
}

interface SpotifyNowPlaying {
  is_playing: boolean;
  item: {
    name: string;
    artists: { name: string }[];
    album: { name: string; images: { url: string }[] };
    external_urls: { spotify: string };
  } | null;
}

// 곡 재생시간 포맷
function formatDuration(ms: number) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

// 상대 시간 포맷
function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export default function MyTasteClient({ initialGame }: { initialGame: GameTabData }) {
  // 게임 탭 1차 데이터는 서버가 이미 fetch해서 prop으로 내려줌 (불변) — 클라 워터폴 없음
  const {
    steamConnected,
    steamProfilePublic,
    ownedGames,
    gameCount,
    totalPlaytime,
    recentGames,
    currentlyPlaying,
  }: GameTabData = initialGame;

  // 게임 탭 2차 데이터(genres/achievements)는 외부 Store API fan-out이라 progressive 유지
  const [genres, setGenres] = useState<GenreStat[]>([]);
  const [genresLoading, setGenresLoading] = useState(false);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [achievementsLoading, setAchievementsLoading] = useState(false);
  const [gameSecondaryFetched, setGameSecondaryFetched] = useState(false);

  const [showAll, setShowAll] = useState(false);
  const [activeTab, setActiveTab] = useState<'game' | 'music' | 'movie'>('game');
  const [spotifyFetched, setSpotifyFetched] = useState(false);

  // Spotify 관련 state
  const [spotifyConnected, setSpotifyConnected] = useState<boolean | null>(null);
  const [musicLoading, setMusicLoading] = useState(true);
  const [nowPlaying, setNowPlaying] = useState<SpotifyNowPlaying | null>(null);
  const [topArtists, setTopArtists] = useState<SpotifyArtistItem[]>([]);
  const [topTracks, setTopTracks] = useState<SpotifyTrackItem[]>([]);
  const [recentTracks, setRecentTracks] = useState<SpotifyRecentItem[]>([]);
  const [artistTimeRange, setArtistTimeRange] = useState<'short_term' | 'medium_term' | 'long_term'>('long_term');
  const [trackTimeRange, setTrackTimeRange] = useState<'short_term' | 'medium_term' | 'long_term'>('long_term');
  const [artistsLoading, setArtistsLoading] = useState(false);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [spotifyGenres, setSpotifyGenres] = useState<SpotifyGenreStat[]>([]);
  const [spotifyGenresLoading, setSpotifyGenresLoading] = useState(false);

  // Netflix 관련 state
  const [netflixCount, setNetflixCount] = useState<number | null>(null);
  const [netflixFetched, setNetflixFetched] = useState(false);
  const [netflixHistory, setNetflixHistory] = useState<Array<{ title: string; date_watched: string; poster_url: string | null; metadata: { genres?: string[]; media_type?: string } }>>([]);
  const [netflixRecentCount, setNetflixRecentCount] = useState(0);
  const [netflixLoading, setNetflixLoading] = useState(true);
  const [netflixShowAll, setNetflixShowAll] = useState(false);

  // 게임 탭 2차 데이터(장르 + 도전과제) — 게임 탭 진입 시 한 번만 progressive 로드
  // (1차 데이터는 서버 prop이라 여기서 fetch하지 않는다)
  useEffect(() => {
    if (activeTab !== 'game' || !steamConnected || steamProfilePublic === false || gameSecondaryFetched) return;

    let cancelled = false;
    async function fetchSecondary() {
      setGenresLoading(true);
      setAchievementsLoading(true);

      const [genresRes, achievementsRes] = await Promise.allSettled([
        fetch('/api/steam/genres'),
        fetch('/api/steam/achievements'),
      ]);
      if (cancelled) return;

      if (genresRes.status === 'fulfilled' && genresRes.value.ok) {
        const data = await genresRes.value.json();
        if (!cancelled) setGenres(data.genres || []);
      }
      if (!cancelled) setGenresLoading(false);

      if (achievementsRes.status === 'fulfilled' && achievementsRes.value.ok) {
        const data = await achievementsRes.value.json();
        if (!cancelled) setAchievements(data.achievements || []);
      }
      if (!cancelled) {
        setAchievementsLoading(false);
        setGameSecondaryFetched(true);
      }
    }

    fetchSecondary();
    return () => {
      cancelled = true;
    };
  }, [activeTab, steamConnected, steamProfilePublic, gameSecondaryFetched]);

  // Spotify 데이터 가져오기
  useEffect(() => {
    if (activeTab !== 'music' || spotifyFetched) return;

    async function fetchSpotifyData() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: connection } = await supabase
        .from('platform_connections')
        .select('platform_user_id')
        .eq('user_id', user.id)
        .eq('platform', 'spotify')
        .single();

      if (!connection) {
        setSpotifyConnected(false);
        setMusicLoading(false);
        setSpotifyFetched(true);
        return;
      }

      setSpotifyConnected(true);

      // 현재 재생 중 + Top 아티스트 + Top 트랙 + 최근 재생 병렬 호출
      const [nowRes, artistsRes, tracksRes, recentRes] = await Promise.allSettled([
        fetch('/api/spotify/now-playing'),
        fetch('/api/spotify/top-artists?time_range=long_term'),
        fetch('/api/spotify/top-tracks?time_range=long_term'),
        fetch('/api/spotify/recent'),
      ]);

      if (nowRes.status === 'fulfilled' && nowRes.value.ok) {
        try {
          const data = await nowRes.value.json();
          setNowPlaying(data);
        } catch { /* 재생 중 아닐 수 있음 */ }
      }

      if (artistsRes.status === 'fulfilled' && artistsRes.value.ok) {
        const data = await artistsRes.value.json();
        setTopArtists(data.artists || []);
      }

      if (tracksRes.status === 'fulfilled' && tracksRes.value.ok) {
        const data = await tracksRes.value.json();
        setTopTracks(data.tracks || []);
      }

      if (recentRes.status === 'fulfilled' && recentRes.value.ok) {
        const data = await recentRes.value.json();
        setRecentTracks(data.tracks || []);
      }

      setMusicLoading(false);

      // 장르 분포 (별도 로딩)
      setSpotifyGenresLoading(true);

      try {
        const genresRes2 = await fetch('/api/spotify/genres');
        if (genresRes2.ok) {
          const data = await genresRes2.json();
          setSpotifyGenres(data.genres || []);
        }
      } catch { /* ignore */ }
      setSpotifyGenresLoading(false);
      setSpotifyFetched(true);
    }

    fetchSpotifyData();
  }, [activeTab, spotifyFetched]);

  // 아티스트 기간 변경
  useEffect(() => {
    if (!spotifyConnected) return;
    setArtistsLoading(true);
    fetch(`/api/spotify/top-artists?time_range=${artistTimeRange}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setTopArtists(data.artists || []); })
      .finally(() => setArtistsLoading(false));
  }, [artistTimeRange, spotifyConnected]);

  // 트랙 기간 변경
  useEffect(() => {
    if (!spotifyConnected) return;
    setTracksLoading(true);
    fetch(`/api/spotify/top-tracks?time_range=${trackTimeRange}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setTopTracks(data.tracks || []); })
      .finally(() => setTracksLoading(false));
  }, [trackTimeRange, spotifyConnected]);

  // Netflix 데이터 가져오기 (영화/드라마 탭 진입 시)
  useEffect(() => {
    if (activeTab !== 'movie' || netflixFetched) return;

    async function fetchNetflixData() {
      setNetflixLoading(true);
      try {
        const res = await fetch('/api/netflix/history');
        if (res.ok) {
          const data = await res.json();
          setNetflixHistory(data.history || []);
          setNetflixCount(data.totalCount || 0);
          setNetflixRecentCount(data.recentCount || 0);
        } else {
          setNetflixCount(0);
        }
      } catch {
        setNetflixCount(0);
      }
      setNetflixLoading(false);
      setNetflixFetched(true);
    }

    fetchNetflixData();
  }, [activeTab, netflixFetched]);

  const TIME_RANGE_LABELS: Record<string, string> = {
    short_term: '4주',
    medium_term: '6개월',
    long_term: '전체',
  };

  return (
    <div className="max-w-3xl mx-auto p-8 animate-fade-up">
      <h2 className="text-2xl font-bold mb-6">내 취향</h2>

      {/* 카테고리 탭 */}
      <div className="flex gap-2 mb-8">
        {([
          { key: 'game', label: '게임', icon: Gamepad2 },
          { key: 'music', label: '음악', icon: Music },
          { key: 'movie', label: '영화/드라마', icon: Film },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition ${activeTab === key
              ? 'bg-white text-black'
              : 'bg-zinc-900/50 border border-zinc-800/35 text-zinc-400 hover:text-zinc-200'
              }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* 게임 탭 */}
      {activeTab === 'game' && (
        <div className="mb-10">

          {!steamConnected ? (
            <div className="text-center py-16 bg-zinc-900/50 border border-zinc-800/35 rounded-2xl">
              <Gamepad2 className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-500">Steam이 연동되지 않았습니다</p>
              <a
                href="/api/auth/steam"
                className="inline-block mt-4 px-6 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-lg transition"
              >
                Steam 연동하기
              </a>
            </div>
          ) : steamProfilePublic === false ? (
            <div className="text-center py-16 bg-zinc-900/50 border border-zinc-800/35 rounded-2xl">
              <ShieldAlert className="w-10 h-10 text-yellow-500/70 mx-auto mb-3" />
              <p className="text-zinc-300 font-medium">Steam 프로필이 비공개 상태입니다</p>
              <p className="text-sm text-zinc-500 mt-2 max-w-sm mx-auto">
                게임 정보를 불러오려면 Steam 프로필 공개 설정을 <span className="text-zinc-300">공개</span>로 변경해주세요
              </p>
              <a
                href="https://steamcommunity.com/my/edit/settings"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-5 px-6 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-lg transition"
              >
                Steam 설정으로 이동 ↗
              </a>
            </div>
          ) : (
            <>
              {/* Steam 프로필 */}
              {currentlyPlaying && (
                <div className="mb-4 flex items-center gap-3">
                  {currentlyPlaying.avatarUrl && (
                    <img
                      src={currentlyPlaying.avatarUrl}
                      alt={currentlyPlaying.profileName}
                      className="w-8 h-8 rounded-full"
                    />
                  )}
                  <span className="text-sm font-medium text-zinc-300">{currentlyPlaying.profileName}</span>
                  {currentlyPlaying.steamLevel != null && (
                    <span className="text-xs text-zinc-500 bg-zinc-800/60 px-2 py-0.5 rounded-full">Lv. {currentlyPlaying.steamLevel}</span>
                  )}
                </div>
              )}

              {/* 현재 플레이 중 */}
              {currentlyPlaying?.isPlaying ? (
                <div className="mb-6 bg-gradient-to-r from-green-900/30 to-emerald-900/20 border border-green-800/30 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-xs font-bold text-green-400 uppercase tracking-wider">현재 플레이 중</span>
                  </div>
                  <div className="flex items-center gap-4">
                    {currentlyPlaying.gameId && (
                      <img
                        src={getSteamHeaderUrl(Number(currentlyPlaying.gameId))}
                        alt={currentlyPlaying.gameName || ''}
                        className="w-40 h-[75px] rounded-lg object-cover"
                        onError={(e) => handleImgError(e)}
                      />
                    )}
                    <div>
                      <p className="text-lg font-bold">{currentlyPlaying.gameName}</p>
                      <a
                        href={`https://store.steampowered.com/app/${currentlyPlaying.gameId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-zinc-400 hover:text-white transition"
                      >
                        Steam에서 보기 ↗
                      </a>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mb-6 flex items-center gap-2 px-4 py-3 rounded-xl border border-zinc-800/40 bg-zinc-900/30">
                  <Gamepad2 className="w-4 h-4 text-zinc-600" />
                  <span className="text-sm text-zinc-500">현재 플레이 중인 게임이 없습니다</span>
                </div>
              )}

              {/* 통계 요약 */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-4 text-center">
                  <Gamepad2 className="w-5 h-5 text-zinc-500 mx-auto mb-2" />
                  <div className="text-xl font-bold">{gameCount}</div>
                  <div className="text-xs text-zinc-500">보유 게임</div>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-4 text-center">
                  <Clock className="w-5 h-5 text-zinc-500 mx-auto mb-2" />
                  <div className="text-xl font-bold">{formatMinutes(totalPlaytime)}</div>
                  <div className="text-xs text-zinc-500">총 플레이타임</div>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-4 text-center">
                  <Trophy className="w-5 h-5 text-zinc-500 mx-auto mb-2" />
                  <div className="text-xl font-bold">
                    {formatMinutes(recentGames.reduce((sum, g) => sum + g.playtime_2weeks, 0))}
                  </div>
                  <div className="text-xs text-zinc-500">최근 2주 플레이</div>
                </div>
              </div>

              {/* 요즘 많이 플레이한 장르 */}
              {genresLoading ? (
                <div className="mb-8">
                  <div className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-6 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-zinc-500 animate-spin mr-2" />
                    <span className="text-sm text-zinc-500">장르 분석 중...</span>
                  </div>
                </div>
              ) : genres.length > 0 && (
                <div className="mb-8">
                  <p className="text-sm text-zinc-400 mb-3">요즘 이런 장르를 많이 플레이했어요</p>
                  <div className="flex flex-wrap gap-2">
                    {genres.slice(0, 5).map((genre) => {
                      const colorClass = GENRE_COLORS[genre.name] || 'bg-zinc-500';
                      return (
                        <span
                          key={genre.name}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900/50 border border-zinc-800/35 rounded-full"
                        >
                          <span className={`w-2 h-2 rounded-full ${colorClass}`} />
                          <span className="text-sm font-medium">{genre.name}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 최근 달성한 도전과제 */}
              {achievementsLoading ? (
                <div className="mb-8">
                  <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">최근 달성한 도전과제 <span className="text-zinc-600 normal-case font-normal">(🌍 전체 플레이어 대비 비율)</span></h4>
                  <div className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-6 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-zinc-500 animate-spin mr-2" />
                    <span className="text-sm text-zinc-500">도전과제 불러오는 중...</span>
                  </div>
                </div>
              ) : achievements.length > 0 && (
                <div className="mb-8">
                  <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">최근 달성한 도전과제 <span className="text-zinc-600 normal-case font-normal">(🌍 전체 플레이어 대비 비율)</span></h4>
                  <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                    {achievements.map((ach, idx) => (
                      <div
                        key={`${ach.appid}-${ach.name}-${idx}`}
                        className="flex-shrink-0 w-[140px] bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-3 flex flex-col items-center text-center"
                      >
                        {ach.icon ? (
                          <img
                            src={ach.icon}
                            alt={ach.name}
                            className="w-12 h-12 rounded-lg mb-2"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-lg mb-2 bg-zinc-800 flex items-center justify-center">
                            <Trophy className="w-5 h-5 text-zinc-600" />
                          </div>
                        )}
                        <p className="text-xs font-semibold truncate w-full">{ach.name}</p>
                        <p className="text-[10px] text-zinc-500 truncate w-full mt-0.5">{ach.gameName}</p>
                        {ach.globalPercent != null && (
                          <p className={`text-[10px] font-medium mt-1 ${Number(ach.globalPercent) < 10 ? 'text-yellow-400' : 'text-zinc-500'}`}>
                            {Number(ach.globalPercent).toFixed(1)}%
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 최근에 많이 플레이한 게임 */}
              {recentGames.length > 0 && (
                <>
                  <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">최근에 많이 플레이한 게임</h4>
                  <div className="grid grid-cols-3 gap-3 mb-8">
                    {recentGames.slice(0, 3).map((game) => (
                      <a
                        key={game.appid}
                        href={`https://store.steampowered.com/app/${game.appid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group"
                      >
                        <div className="relative rounded-xl overflow-hidden aspect-[16/9] bg-zinc-800">
                          <img
                            src={getSteamHeaderUrl(game.appid)}
                            alt={game.name}
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            onError={(e) => handleImgError(e)}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                          <div className="absolute bottom-2 left-3 right-3 z-10">
                            <p className="text-xs font-semibold truncate">{game.name}</p>
                            <p className="text-[10px] text-purple-400 font-medium mt-0.5">
                              최근 {formatMinutes(game.playtime_2weeks)}
                            </p>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                </>
              )}

              {/* 게임 목록 (플레이타임 순) */}
              <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">전체 플레이타임 순</h4>
              {(() => {
                const playedGames = ownedGames.filter(g => g.playtime_minutes > 0);
                const visibleGames = showAll ? playedGames : playedGames.slice(0, 10);
                const hasMore = playedGames.length > 10;

                return (
                  <div className="space-y-2">
                    {visibleGames.map((game, idx) => (
                      <a
                        key={game.appid}
                        href={`https://store.steampowered.com/app/${game.appid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-3 flex items-center gap-4 hover:bg-zinc-800/50 transition group"
                      >
                        {/* 순위 */}
                        <span className={`text-sm font-bold w-6 text-center ${idx < 3 ? 'text-yellow-400' : 'text-zinc-600'}`}>
                          {idx + 1}
                        </span>

                        {/* 게임 이미지 */}
                        <img
                          src={getSteamHeaderUrl(game.appid)}
                          alt={game.name}
                          className="w-[120px] h-[45px] rounded-lg object-cover flex-shrink-0 bg-zinc-800"
                          onError={(e) => handleImgError(e)}
                        />

                        {/* 게임 정보 */}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate group-hover:text-white transition">
                            {game.name}
                          </p>
                        </div>

                        {/* 플레이타임 */}
                        <div className="text-right flex-shrink-0">
                          <span className="text-sm font-semibold text-zinc-300">
                            {formatMinutes(game.playtime_minutes)}
                          </span>
                        </div>
                      </a>
                    ))}

                    {/* 더보기 / 접기 버튼 */}
                    {hasMore && (
                      <button
                        onClick={() => setShowAll(!showAll)}
                        className="w-full py-3 text-sm text-zinc-500 hover:text-zinc-300 transition border border-zinc-800/35 rounded-xl hover:bg-zinc-800/30"
                      >
                        {showAll ? '접기' : `더보기 (${playedGames.length - 10}개)`}
                      </button>
                    )}

                    {/* 미플레이 게임 */}
                    {ownedGames.filter(g => g.playtime_minutes === 0).length > 0 && (
                      <div className="text-center py-4 text-xs text-zinc-600">
                        + 미플레이 게임 {ownedGames.filter(g => g.playtime_minutes === 0).length}개
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* 음악 탭 */}
      {activeTab === 'music' && (
        <div className="mb-10">
          {musicLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
            </div>
          ) : !spotifyConnected ? (
            <div className="text-center py-16 bg-zinc-900/50 border border-zinc-800/35 rounded-2xl">
              <Music className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-500">Spotify가 연동되지 않았습니다</p>
              <a
                href="/api/auth/spotify"
                className="inline-block mt-4 px-6 py-2 text-sm bg-green-600 hover:bg-green-500 rounded-lg transition"
              >
                Spotify 연동하기
              </a>
            </div>
          ) : (
            <>
              {/* 현재 재생 중 */}
              {nowPlaying?.is_playing && nowPlaying.item ? (
                <div className="mb-6 bg-gradient-to-r from-green-900/30 to-emerald-900/20 border border-green-800/30 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-xs font-bold text-green-400 uppercase tracking-wider">현재 재생 중</span>
                  </div>
                  <div className="flex items-center gap-4">
                    {nowPlaying.item.album.images?.[0]?.url && (
                      <img
                        src={nowPlaying.item.album.images[0].url}
                        alt={nowPlaying.item.album.name}
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-lg font-bold truncate">{nowPlaying.item.name}</p>
                      <p className="text-sm text-zinc-400 truncate">
                        {nowPlaying.item.artists.map(a => a.name).join(', ')}
                      </p>
                      <a
                        href={nowPlaying.item.external_urls?.spotify}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-zinc-400 hover:text-green-400 transition"
                      >
                        Spotify에서 듣기 ↗
                      </a>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mb-6 flex items-center gap-2 px-4 py-3 rounded-xl border border-zinc-800/40 bg-zinc-900/30">
                  <Music className="w-4 h-4 text-zinc-600" />
                  <span className="text-sm text-zinc-500">현재 재생 중인 노래가 없습니다</span>
                </div>
              )}

              {/* 장르 뱃지 (Last.fm 기반, 최근 4주 Top Tracks 분석) */}
              {spotifyGenresLoading ? (
                <div className="mb-8">
                  <div className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-6 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-zinc-500 animate-spin mr-2" />
                    <span className="text-sm text-zinc-500">음악 장르 분석 중...</span>
                  </div>
                </div>
              ) : spotifyGenres.length > 0 && (
                <div className="mb-8">
                  <p className="text-sm text-zinc-400 mb-3">최근 4주간 이런 장르를 많이 들었어요</p>
                  <div className="flex flex-wrap gap-2">
                    {spotifyGenres.slice(0, 5).map((genre, idx) => {
                      const badgeStyles = [
                        'bg-green-500/15 border-green-500/30 text-green-400',
                        'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
                        'bg-teal-500/15 border-teal-500/30 text-teal-400',
                        'bg-cyan-500/15 border-cyan-500/30 text-cyan-400',
                        'bg-zinc-500/15 border-zinc-500/30 text-zinc-400',
                      ];
                      return (
                        <span
                          key={genre.name}
                          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border capitalize ${badgeStyles[idx]}`}
                        >
                          {genre.name}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Top 아티스트 */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Top 아티스트</h4>
                  <div className="flex gap-1">
                    {(['short_term', 'medium_term', 'long_term'] as const).map(range => (
                      <button
                        key={range}
                        onClick={() => setArtistTimeRange(range)}
                        className={`px-3 py-1 text-xs rounded-full transition ${artistTimeRange === range
                          ? 'bg-green-600 text-white'
                          : 'bg-zinc-800/50 text-zinc-500 hover:text-zinc-300'
                          }`}
                      >
                        {TIME_RANGE_LABELS[range]}
                      </button>
                    ))}
                  </div>
                </div>
                {artistsLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                  </div>
                ) : topArtists.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {topArtists.slice(0, 8).map((artist, idx) => (
                      <a
                        key={artist.id}
                        href={artist.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group text-center"
                      >
                        <div className="relative mb-2">
                          {artist.image ? (
                            <img
                              src={artist.image}
                              alt={artist.name}
                              className="w-full aspect-square rounded-full object-cover bg-zinc-800 group-hover:ring-2 ring-green-500 transition"
                            />
                          ) : (
                            <div className="w-full aspect-square rounded-full bg-zinc-800 flex items-center justify-center">
                              <Mic2 className="w-8 h-8 text-zinc-600" />
                            </div>
                          )}
                          {idx < 3 && (
                            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-green-600 text-[10px] font-bold flex items-center justify-center">
                              {idx + 1}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-medium truncate group-hover:text-green-400 transition">
                          {artist.name}
                        </p>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-600 text-center py-6">데이터가 아직 없습니다</p>
                )}
              </div>

              {/* Top 트랙 */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Top 트랙</h4>
                  <div className="flex gap-1">
                    {(['short_term', 'medium_term', 'long_term'] as const).map(range => (
                      <button
                        key={range}
                        onClick={() => setTrackTimeRange(range)}
                        className={`px-3 py-1 text-xs rounded-full transition ${trackTimeRange === range
                          ? 'bg-green-600 text-white'
                          : 'bg-zinc-800/50 text-zinc-500 hover:text-zinc-300'
                          }`}
                      >
                        {TIME_RANGE_LABELS[range]}
                      </button>
                    ))}
                  </div>
                </div>
                {tracksLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {topTracks.slice(0, 10).map((track, idx) => (
                      <a
                        key={track.id}
                        href={track.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-3 flex items-center gap-4 hover:bg-zinc-800/50 transition group"
                      >
                        <span className={`text-sm font-bold w-6 text-center ${idx < 3 ? 'text-green-400' : 'text-zinc-600'}`}>
                          {idx + 1}
                        </span>
                        {track.image && (
                          <img
                            src={track.image}
                            alt={track.album}
                            className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-zinc-800"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate group-hover:text-green-400 transition">
                            {track.name}
                          </p>
                          <p className="text-xs text-zinc-500 truncate">{track.artist}</p>
                        </div>
                        <span className="text-xs text-zinc-600 flex-shrink-0">
                          {formatDuration(track.duration_ms)}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* 최근 재생 기록 */}
              {recentTracks.length > 0 && (
                <div className="mb-8">
                  <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">최근 재생 기록</h4>
                  <div className="space-y-1">
                    {recentTracks.slice(0, 10).map((track, idx) => (
                      <a
                        key={`${track.id}-${idx}`}
                        href={track.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-zinc-900/50 transition group"
                      >
                        {track.image && (
                          <img
                            src={track.image}
                            alt={track.album}
                            className="w-8 h-8 rounded object-cover flex-shrink-0 bg-zinc-800"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate group-hover:text-green-400 transition">{track.name}</p>
                          <p className="text-xs text-zinc-600 truncate">{track.artist}</p>
                        </div>
                        <span className="text-[10px] text-zinc-600 flex-shrink-0">
                          {timeAgo(track.played_at)}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 영화/드라마 탭 */}
      {activeTab === 'movie' && (
        <div className="mb-10">
          {netflixLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
            </div>
          ) : netflixCount === 0 ? (
            <div>
              <div className="text-center py-12 bg-zinc-900/50 border border-zinc-800/35 rounded-2xl mb-6">
                <Film className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                <p className="text-zinc-500">넷플릭스 시청 기록이 없습니다</p>
                <p className="text-xs text-zinc-600 mt-2">CSV 파일을 업로드하면 취향 분석이 시작됩니다</p>
              </div>
              <NetflixUpload onUploadComplete={() => { setNetflixFetched(false); setNetflixCount(null); setNetflixLoading(true); }} />
            </div>
          ) : (
            <>
              {/* 1. 요약 통계 */}
              <div className="grid grid-cols-2 gap-3 mb-8">
                <div className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-4 text-center">
                  <Film className="w-5 h-5 text-zinc-500 mx-auto mb-2" />
                  <div className="text-xl font-bold">{netflixRecentCount}</div>
                  <div className="text-xs text-zinc-500">최근 한 달 시청</div>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-4 text-center">
                  <Film className="w-5 h-5 text-zinc-500 mx-auto mb-2" />
                  <div className="text-xl font-bold">{netflixCount}</div>
                  <div className="text-xs text-zinc-500">전체 작품</div>
                </div>
              </div>

              {/* 장르 뱃지 */}
              {(() => {
                const genreCount: Record<string, number> = {};
                for (const item of netflixHistory) {
                  for (const g of item.metadata?.genres || []) {
                    genreCount[g] = (genreCount[g] || 0) + 1;
                  }
                }
                const topGenres = Object.entries(genreCount)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 5);

                if (topGenres.length === 0) return null;

                const badgeStyles = [
                  'bg-red-500/15 border-red-500/30 text-red-400',
                  'bg-orange-500/15 border-orange-500/30 text-orange-400',
                  'bg-amber-500/15 border-amber-500/30 text-amber-400',
                  'bg-rose-500/15 border-rose-500/30 text-rose-400',
                  'bg-zinc-500/15 border-zinc-500/30 text-zinc-400',
                ];

                return (
                  <div className="mb-8">
                    <p className="text-sm text-zinc-400 mb-3">가장 많이 본 장르</p>
                    <div className="flex flex-wrap gap-2">
                      {topGenres.map(([name], idx) => (
                        <span
                          key={name}
                          className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium border ${badgeStyles[idx] || badgeStyles[4]}`}
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* 2. 최근에 본 작품 (가로 스크롤) */}
              <div className="mb-8">
                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">최근에 본 작품</h4>
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                  {netflixHistory.slice(0, 10).map((item) => (
                    <div key={item.title} className="flex-shrink-0 w-[130px]">
                      {item.poster_url ? (
                        <img
                          src={item.poster_url}
                          alt={item.title}
                          className="w-full aspect-[2/3] rounded-xl object-cover bg-zinc-800"
                        />
                      ) : (
                        <div className="w-full aspect-[2/3] rounded-xl bg-zinc-800 flex items-center justify-center p-2">
                          <span className="text-xs text-zinc-500 text-center">{item.title}</span>
                        </div>
                      )}
                      <p className="text-xs font-medium mt-2 truncate">{item.title}</p>
                      <p className="text-[10px] text-zinc-600">{item.date_watched}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3. 전체 시청 목록 (그리드) */}
              <div>
                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">전체 시청 목록</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {(netflixShowAll ? netflixHistory : netflixHistory.slice(0, 12)).map((item) => (
                    <div key={item.title} className="group">
                      {item.poster_url ? (
                        <img
                          src={item.poster_url}
                          alt={item.title}
                          className="w-full aspect-[2/3] rounded-xl object-cover bg-zinc-800 group-hover:ring-2 ring-red-500 transition"
                        />
                      ) : (
                        <div className="w-full aspect-[2/3] rounded-xl bg-zinc-800 flex items-center justify-center p-2 group-hover:ring-2 ring-red-500 transition">
                          <span className="text-xs text-zinc-500 text-center">{item.title}</span>
                        </div>
                      )}
                      <p className="text-xs font-medium mt-1.5 truncate">{item.title}</p>
                    </div>
                  ))}
                </div>
                {netflixHistory.length > 12 && (
                  <button
                    onClick={() => setNetflixShowAll(!netflixShowAll)}
                    className="w-full mt-4 py-3 text-sm text-zinc-500 hover:text-zinc-300 transition border border-zinc-800/35 rounded-xl hover:bg-zinc-800/30"
                  >
                    {netflixShowAll ? '접기' : `더보기 (${netflixHistory.length - 12}개)`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
