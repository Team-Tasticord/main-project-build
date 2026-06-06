// taste_profiles 스냅샷 갱신 — admin 권한으로 임의 user_id 에 대해 실행 가능.
// 두 곳에서 호출:
//   1) POST /api/taste-profile/refresh        ← 본인 (페이지 진입 시)
//   2) GET  /api/friends/[userId]/compare     ← 친구 (본인이 비교 페이지 열 때, 친구 데이터가 stale 이면)
//
// 친구 분 갱신을 본인이 트리거하는 이유: RLS 정책상 본인만 본인 행을 갱신할 수 있는데,
// 친구가 한 번도 비교 페이지를 안 들어왔으면 친구 데이터의 images / topTracks 가 영영 비어있음.
// admin client 로 친구의 platform_connections 토큰을 위임 사용해 갱신한다.
import { createAdminClient } from '@/lib/supabase/admin';
import { getTopArtists, getTopTracks, refreshAccessToken } from '@/lib/api/spotify';
import { getOwnedGames } from '@/lib/api/steam';
import { toMovieGenreMix, type NetflixRow } from '@/lib/wrapped/movie-aggregate';

export const TASTE_PROFILE_TTL_MS = 48 * 60 * 60 * 1000; // 48h

export type RefreshStatus = 'updated' | 'fresh' | 'skipped';

export interface MusicTrack {
  name: string;
  artist: string;
  image?: string;
}

// admin 권한으로 임의 사용자의 Spotify access_token 을 확보 (만료 시 refresh + DB 업데이트)
async function getValidSpotifyTokenAdmin(
  userId: string
): Promise<{ accessToken: string } | null> {
  const admin = createAdminClient();
  const { data: conn } = await admin
    .from('platform_connections')
    .select('access_token, refresh_token, token_expires_at')
    .eq('user_id', userId)
    .eq('platform', 'spotify')
    .maybeSingle();
  if (!conn?.access_token || !conn?.refresh_token) return null;

  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (Date.now() < expiresAt - 60_000) {
    return { accessToken: conn.access_token };
  }

  try {
    const refreshed = await refreshAccessToken(conn.refresh_token);
    if (!refreshed.access_token || !refreshed.expires_in) return null;
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await admin
      .from('platform_connections')
      .update({
        access_token: refreshed.access_token,
        token_expires_at: newExpiresAt,
      })
      .eq('user_id', userId)
      .eq('platform', 'spotify');
    return { accessToken: refreshed.access_token };
  } catch (e) {
    console.error(`[refreshTasteProfile:${userId}] spotify token refresh 실패`, e);
    return null;
  }
}

// v2 마이그레이션 체크: games.images 가 존재해야 v2
function isV2(row: { games?: unknown; music?: unknown } | null | undefined): boolean {
  if (!row) return false;
  const games = row.games as { images?: Record<string, string> } | undefined;
  const music = row.music as { topTracks?: unknown[] } | undefined;
  return games?.images !== undefined && Array.isArray(music?.topTracks);
}

export async function refreshTasteProfileFor(
  userId: string,
  options: { force?: boolean } = {}
): Promise<RefreshStatus> {
  const admin = createAdminClient();

  // TTL 가드: v2 이고 48h 안이면 스킵 (force=true 면 무시)
  if (!options.force) {
    const { data: existing } = await admin
      .from('taste_profiles')
      .select('updated_at, games, music')
      .eq('user_id', userId)
      .maybeSingle();
    if (existing?.updated_at && isV2(existing)) {
      const age = Date.now() - new Date(existing.updated_at).getTime();
      if (age < TASTE_PROFILE_TTL_MS) return 'fresh';
    }
  }

  // 연동 상태 + 기존 wrapped 데이터 + Netflix 병렬 조회
  const [
    { data: connections },
    { data: wrapped },
    { data: wrappedGames },
    { data: netflixRows },
  ] = await Promise.all([
    admin
      .from('platform_connections')
      .select('platform, platform_user_id')
      .eq('user_id', userId),
    admin.from('wrapped_reports').select('top_genres').eq('user_id', userId).maybeSingle(),
    admin
      .from('wrapped_games_reports')
      .select('genre_mix')
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('netflix_history')
      .select('title, date_watched, poster_url, metadata')
      .eq('user_id', userId)
      .order('date_watched', { ascending: false }),
  ]);

  const platforms = new Set((connections ?? []).map((c) => c.platform));
  const steamConn = (connections ?? []).find((c) => c.platform === 'steam');

  // ── 음악 (Top Artists + Top Tracks short_term) ────────────
  let musicArtists: string[] = [];
  let musicTopTracks: MusicTrack[] = [];
  if (platforms.has('spotify')) {
    try {
      const token = await getValidSpotifyTokenAdmin(userId);
      if (token) {
        const [artistsRes, tracksRes] = await Promise.all([
          getTopArtists(token.accessToken, 'medium_term', 20).catch(() => null),
          getTopTracks(token.accessToken, 'short_term', 10).catch(() => null),
        ]);
        musicArtists = (artistsRes?.items ?? [])
          .map((a: { name?: string }) => a.name)
          .filter(Boolean) as string[];
        type SpotifyTrack = {
          name: string;
          artists: Array<{ name: string }>;
          album?: { images?: Array<{ url: string }> };
        };
        musicTopTracks = ((tracksRes?.items ?? []) as SpotifyTrack[])
          .map((t) => ({
            name: t.name,
            artist: (t.artists ?? []).map((a) => a.name).join(', '),
            image: t.album?.images?.[0]?.url,
          }))
          .filter((t) => t.name)
          .slice(0, 10);
      }
    } catch (e) {
      console.error(`[refreshTasteProfile:${userId}] spotify 실패`, e);
    }
  }
  const topGenres = (wrapped?.top_genres ?? []) as Array<{ name: string }>;
  const musicGenres = topGenres.map((g) => g.name).filter(Boolean);

  // ── 게임 ──────────────────────────────────────────────
  let gameNames: string[] = [];
  const gameImages: Record<string, string> = {};
  if (steamConn?.platform_user_id) {
    try {
      const owned = await getOwnedGames(steamConn.platform_user_id);
      const games: Array<{ appid: number; name: string; playtime_forever: number }> =
        owned?.response?.games ?? [];
      const topGames = games
        .filter((g) => g.playtime_forever > 0)
        .sort((a, b) => b.playtime_forever - a.playtime_forever)
        .slice(0, 20)
        .filter((g) => g.name);
      gameNames = topGames.map((g) => g.name);
      for (const g of topGames) {
        const key = g.name.trim().toLowerCase();
        if (key && g.appid) {
          gameImages[key] = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_600x900.jpg`;
        }
      }
    } catch (e) {
      console.error(`[refreshTasteProfile:${userId}] steam 실패`, e);
    }
  }
  const genreMix = (wrappedGames?.genre_mix ?? []) as Array<{ name: string }>;
  const gameGenres = genreMix.map((g) => g.name).filter(Boolean);

  // ── 영화 ──────────────────────────────────────────────
  const nfRows = (netflixRows ?? []) as NetflixRow[];
  const movieTitles = nfRows.slice(0, 30).map((r) => r.title).filter(Boolean);
  const movieGenres = toMovieGenreMix(nfRows, 8).map((g) => g.name);
  const movieImages: Record<string, string> = {};
  for (const r of nfRows.slice(0, 30)) {
    if (!r.title || !r.poster_url) continue;
    const key = r.title.trim().toLowerCase();
    if (key && !movieImages[key]) movieImages[key] = r.poster_url;
  }

  const payload = {
    user_id: userId,
    music: { artists: musicArtists, genres: musicGenres, topTracks: musicTopTracks },
    games: { games: gameNames, genres: gameGenres, images: gameImages },
    movies: { titles: movieTitles, genres: movieGenres, images: movieImages },
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from('taste_profiles')
    .upsert(payload, { onConflict: 'user_id' });
  if (error) {
    console.error(`[refreshTasteProfile:${userId}] upsert 실패`, error);
    return 'skipped';
  }
  return 'updated';
}

// 친구 행이 stale 이거나 v2 아니면 갱신 필요 여부 판정 (헬퍼)
export function needsRefresh(
  row: { updated_at?: string | null; games?: unknown; music?: unknown } | null | undefined
): { needs: boolean; force: boolean } {
  if (!row) return { needs: true, force: true };
  const v2 = isV2(row);
  if (!v2) return { needs: true, force: true };
  const age = row.updated_at ? Date.now() - new Date(row.updated_at).getTime() : Infinity;
  if (age > TASTE_PROFILE_TTL_MS) return { needs: true, force: false };
  return { needs: false, force: false };
}
