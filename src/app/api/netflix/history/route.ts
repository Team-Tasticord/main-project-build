import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// 넷플릭스 시청 기록 조회 API
// - 기본: 전체 작품 목록 (최신순) + 최근 한 달 시청 수
// - ?count_only=true: totalCount 만 반환 (가벼운 응답)
//   영화 Wrapped 섹션처럼 "기록이 있냐 없냐"만 확인할 때 사용 — 전체 SELECT * 회피
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const countOnly = searchParams.get('count_only') === 'true';

    const admin = createAdminClient();

    // count_only 모드: HEAD 카운트만 — 페이로드/직렬화/정렬 비용 모두 제거
    if (countOnly) {
      const { count } = await admin
        .from('netflix_history')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      return NextResponse.json({ totalCount: count ?? 0 });
    }

    // 일반 모드: 전체 시청 기록 (admin 클라이언트로 RLS 우회)
    const { data: history, error } = await admin
      .from('netflix_history')
      .select('*')
      .eq('user_id', user.id)
      .order('date_watched', { ascending: false });

    if (error) {
      console.error('Netflix history fetch error:', error);
    }

    if (!history || history.length === 0) {
      return NextResponse.json({ history: [], recentCount: 0, totalCount: 0 });
    }

    // 최근 한 달 시청 수 계산
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const recentCount = history.filter(
      h => h.date_watched && new Date(h.date_watched) >= oneMonthAgo
    ).length;

    return NextResponse.json({
      history,
      recentCount,
      totalCount: history.length,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}
