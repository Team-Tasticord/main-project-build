// GET /api/friends/[userId]/compare
// 본인 + 대상(친구) taste_profiles 2개를 읽어 축별 유사도를 계산해 반환.
// 인증 필수. RLS("Users can read friend taste profiles")가 본인+친구로 제한하므로
// authenticated client로 조회 → 친구 아닌 사용자 프로필은 자연히 안 보임.
//
// 친구 데이터 자동 갱신:
//   친구가 한 번도 비교 페이지에 안 들어왔다면 친구의 images / topTracks 가 비어있을 수 있음.
//   여기서 admin 권한으로 friend 의 taste_profile 을 강제 갱신해 누구 시점에서 봐도 이미지가 보이게 함.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { compareTasteProfiles, type TasteProfileData } from '@/lib/compare/compare';
import { refreshTasteProfileFor, needsRefresh } from '@/lib/taste-profile/refresh';

const EMPTY: TasteProfileData = {
  music: { artists: [], genres: [], topTracks: [] },
  games: { games: [], genres: [], images: {} },
  movies: { titles: [], genres: [], images: {} },
};

interface RouteContext {
  params: Promise<{ userId: string }>;
}

async function fetchProfiles(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]) {
  return supabase
    .from('taste_profiles')
    .select('user_id, updated_at, music, games, movies')
    .in('user_id', ids);
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const { userId: friendId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (friendId === user.id) {
      return NextResponse.json({ error: '자기 자신과는 비교할 수 없어요' }, { status: 400 });
    }

    // 첫 조회
    const firstFetch = await fetchProfiles(supabase, [user.id, friendId]);
    if (firstFetch.error) {
      console.error('[friends/compare] 조회 실패', firstFetch.error);
      return NextResponse.json({ error: '조회 실패' }, { status: 500 });
    }
    let rows = firstFetch.data;

    // 친구 행이 stale / v2 아님 → admin 권한으로 강제 갱신
    const byId = new Map((rows ?? []).map((r) => [r.user_id, r]));
    const friendRow = byId.get(friendId);
    const friendCheck = needsRefresh(friendRow);
    if (friendCheck.needs) {
      await refreshTasteProfileFor(friendId, { force: friendCheck.force });
      // 갱신 후 재조회
      const refetch = await fetchProfiles(supabase, [user.id, friendId]);
      if (!refetch.error) rows = refetch.data;
    }

    const byId2 = new Map((rows ?? []).map((r) => [r.user_id, r]));
    const mineRow = byId2.get(user.id);
    const friendRow2 = byId2.get(friendId);

    if (!mineRow) {
      return NextResponse.json(
        {
          error: '내 취향 데이터가 아직 준비되지 않았어요. 잠시 후 다시 시도해주세요.',
          code: 'MINE_MISSING',
        },
        { status: 409 }
      );
    }
    if (!friendRow2) {
      return NextResponse.json(
        {
          error: '이 친구의 취향 데이터가 아직 없어요. 친구가 앱을 한 번 켜면 생성돼요.',
          code: 'FRIEND_MISSING',
        },
        { status: 409 }
      );
    }

    const mine: TasteProfileData = {
      music: { ...EMPTY.music, ...(mineRow.music ?? {}) },
      games: { ...EMPTY.games, ...(mineRow.games ?? {}) },
      movies: { ...EMPTY.movies, ...(mineRow.movies ?? {}) },
    };
    const friend: TasteProfileData = {
      music: { ...EMPTY.music, ...(friendRow2.music ?? {}) },
      games: { ...EMPTY.games, ...(friendRow2.games ?? {}) },
      movies: { ...EMPTY.movies, ...(friendRow2.movies ?? {}) },
    };

    const result = compareTasteProfiles(mine, friend);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[friends/compare]', err);
    return NextResponse.json({ error: '비교 실패' }, { status: 500 });
  }
}
