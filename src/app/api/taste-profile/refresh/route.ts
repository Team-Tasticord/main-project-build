// POST /api/taste-profile/refresh
// 본인의 음악/게임/영화 취향 스냅샷을 모아 taste_profiles에 upsert (친구 비교용).
// 48h 이내 갱신된 v2 프로필이면 작업 스킵 (friend 비교 페이지 진입 시에만 호출되므로 가드 필수).
// body: { force?: boolean }
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { refreshTasteProfileFor } from '@/lib/taste-profile/refresh';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let force = false;
    try {
      const body = await req.json();
      force = body?.force === true;
    } catch {
      // 바디 없음 — force=false
    }

    const status = await refreshTasteProfileFor(user.id, { force });
    return NextResponse.json({ status });
  } catch (err) {
    console.error('[taste-profile/refresh]', err);
    return NextResponse.json({ error: '갱신 실패' }, { status: 500 });
  }
}
