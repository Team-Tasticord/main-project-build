import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getOwnedGames, getRecentlyPlayedGames, getCurrentlyPlaying } from '@/lib/api/steam';

// ============================================
// 게임 탭 1차(첫 페인트) 데이터 — 서버 컴포넌트에서 직접 로드
// 기존 my-taste 게임 탭의 클라이언트 useEffect 워터폴
//   getUser → platform_connections → taste_cache(owned) → [recent ‖ currently]
// 를 서버에서 getUser → connection → Promise.all([owned, recent, currently]) 로 병합한다.
// genres/achievements는 외부 Store API fan-out이라 클라이언트 섬에 progressive로 남긴다.
// ============================================

export interface SteamGame {
  appid: number;
  name: string;
  playtime_minutes: number;
  icon: string;
}

export interface RecentGame {
  appid: number;
  name: string;
  playtime_2weeks: number;
  playtime_forever: number;
  img_icon_url: string;
}

export interface CurrentlyPlaying {
  isPlaying: boolean;
  gameName: string | null;
  gameId: string | null;
  personaState: number;
  profileName: string;
  avatarUrl: string;
  isProfilePublic: boolean;
  steamLevel: number | null;
}

export interface GameTabData {
  steamConnected: boolean;
  steamProfilePublic: boolean | null;
  ownedGames: SteamGame[];
  gameCount: number;
  playedCount: number;
  totalPlaytime: number;
  recentGames: RecentGame[];
  currentlyPlaying: CurrentlyPlaying | null;
}

// 캐시 TTL (기존 /api/steam 라우트와 동일하게 유지)
const OWNED_TTL_MS = 24 * 60 * 60 * 1000;
const RECENT_TTL_MS = 60 * 60 * 1000;

type ServerClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

const DISCONNECTED: GameTabData = {
  steamConnected: false,
  steamProfilePublic: null,
  ownedGames: [],
  gameCount: 0,
  playedCount: 0,
  totalPlaytime: 0,
  recentGames: [],
  currentlyPlaying: null,
};

interface RawOwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;
  img_icon_url: string;
}

interface OwnedSummary {
  ownedGames: SteamGame[];
  gameCount: number;
  playedCount: number;
  totalPlaytime: number;
}

// 보유 게임 — /api/steam/games 라우트의 캐시-aware 로직과 동일
async function loadOwned(
  supabase: ServerClient,
  admin: AdminClient,
  userId: string,
  steamId: string,
): Promise<OwnedSummary> {
  try {
    const { data: cache } = await supabase
      .from('taste_cache')
      .select('data, fetched_at')
      .eq('user_id', userId)
      .eq('platform', 'steam')
      .eq('data_type', 'owned_games')
      .maybeSingle();

    if (cache && Date.now() - new Date(cache.fetched_at).getTime() < OWNED_TTL_MS) {
      const d = cache.data;
      return {
        ownedGames: d.games || [],
        gameCount: d.game_count || 0,
        playedCount: d.played_count || 0,
        totalPlaytime: d.total_playtime || 0,
      };
    }

    const data = await getOwnedGames(steamId);
    const games: RawOwnedGame[] = data?.response?.games || [];

    const cacheData = {
      game_count: data?.response?.game_count || 0,
      played_count: games.filter((g) => g.playtime_forever > 0).length,
      total_playtime: games.reduce((sum, g) => sum + g.playtime_forever, 0),
      games: [...games]
        .sort((a, b) => b.playtime_forever - a.playtime_forever)
        .slice(0, 50)
        .map((g) => ({
          appid: g.appid,
          name: g.name,
          playtime_minutes: g.playtime_forever,
          icon: g.img_icon_url,
        })),
    };

    await admin.from('taste_cache').upsert(
      {
        user_id: userId,
        platform: 'steam',
        data_type: 'owned_games',
        data: cacheData,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,platform,data_type' },
    );

    return {
      ownedGames: cacheData.games,
      gameCount: cacheData.game_count,
      playedCount: cacheData.played_count,
      totalPlaytime: cacheData.total_playtime,
    };
  } catch {
    return { ownedGames: [], gameCount: 0, playedCount: 0, totalPlaytime: 0 };
  }
}

// 최근 플레이 — /api/steam/recent 라우트의 캐시-aware 로직과 동일 (+ playtime_2weeks 내림차순 정렬)
async function loadRecent(
  supabase: ServerClient,
  admin: AdminClient,
  userId: string,
  steamId: string,
): Promise<RecentGame[]> {
  try {
    const { data: cache } = await supabase
      .from('taste_cache')
      .select('data, fetched_at')
      .eq('user_id', userId)
      .eq('platform', 'steam')
      .eq('data_type', 'recent_games')
      .maybeSingle();

    let raw;
    if (cache && Date.now() - new Date(cache.fetched_at).getTime() < RECENT_TTL_MS) {
      raw = cache.data;
    } else {
      raw = await getRecentlyPlayedGames(steamId);
      await admin.from('taste_cache').upsert(
        {
          user_id: userId,
          platform: 'steam',
          data_type: 'recent_games',
          data: raw,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform,data_type' },
      );
    }

    const games: RecentGame[] = raw?.response?.games || [];
    return [...games].sort((a, b) => b.playtime_2weeks - a.playtime_2weeks);
  } catch {
    return [];
  }
}

export async function loadGameTabData(): Promise<GameTabData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return DISCONNECTED;

  const { data: connection } = await supabase
    .from('platform_connections')
    .select('platform_user_id')
    .eq('user_id', user.id)
    .eq('platform', 'steam')
    .single();

  if (!connection?.platform_user_id) return DISCONNECTED;
  const steamId = connection.platform_user_id;
  const admin = createAdminClient();

  // 직렬 워터폴 제거: owned/recent/currently를 한 번에 병렬 착수
  const [owned, recentGames, currentlyPlaying] = await Promise.all([
    loadOwned(supabase, admin, user.id, steamId),
    loadRecent(supabase, admin, user.id, steamId),
    getCurrentlyPlaying(steamId).catch(() => null),
  ]);

  return {
    steamConnected: true,
    steamProfilePublic: currentlyPlaying?.isProfilePublic ?? null,
    ownedGames: owned.ownedGames,
    gameCount: owned.gameCount,
    playedCount: owned.playedCount,
    totalPlaytime: owned.totalPlaytime,
    recentGames,
    currentlyPlaying,
  };
}
