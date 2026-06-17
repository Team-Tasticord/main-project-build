// GET /api/feed/recommendations
// 본인 + 친구들의 추천 카드(activity_type='recommend') 시간순 반환
// 좋아요/댓글 카운트 + 본인이 좋아요했는지까지 함께
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface RecommendActivityRow {
  id: string;
  user_id: string;
  platform: string;
  activity_type: string;
  content_title: string;
  content_subtitle: string | null;
  content_image_url: string | null;
  content_external_url: string | null;
  content_metadata: Record<string, unknown>;
  created_at: string;
  profiles: { id: string; nickname: string; avatar_url: string | null } | null;
}

const PAGE_SIZE = 30;

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ items: [] });

    // 친구 ID 목록 + 본인
    const { data: friendships } = await supabase
      .from('friendships')
      .select('friend_id')
      .eq('user_id', user.id)
      .eq('status', 'accepted'); // P-001: pending 제외, accepted 친구만 노출

    const friendIds = (friendships ?? []).map((f) => f.friend_id);
    const visibleUserIds = [user.id, ...friendIds];

    // 추천 활동 조회 (프로필 join)
    const { data: activities } = await supabase
      .from('activities')
      .select(
        'id, user_id, platform, activity_type, content_title, content_subtitle, content_image_url, content_external_url, content_metadata, created_at, profiles:user_id (id, nickname, avatar_url)'
      )
      .eq('activity_type', 'recommend')
      .in('user_id', visibleUserIds)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (!activities || activities.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const rows = activities as unknown as RecommendActivityRow[];
    const activityIds = rows.map((r) => r.id);

    // 좋아요/댓글 카운트 한 번에 조회
    const [likesRes, commentsRes, myLikesRes] = await Promise.all([
      supabase.from('activity_likes').select('activity_id').in('activity_id', activityIds),
      supabase.from('activity_comments').select('activity_id').in('activity_id', activityIds),
      supabase
        .from('activity_likes')
        .select('activity_id')
        .in('activity_id', activityIds)
        .eq('user_id', user.id),
    ]);

    const likeCounts = new Map<string, number>();
    likesRes.data?.forEach((l) => likeCounts.set(l.activity_id, (likeCounts.get(l.activity_id) ?? 0) + 1));
    const commentCounts = new Map<string, number>();
    commentsRes.data?.forEach((c) =>
      commentCounts.set(c.activity_id, (commentCounts.get(c.activity_id) ?? 0) + 1)
    );
    const myLikedSet = new Set(myLikesRes.data?.map((l) => l.activity_id) ?? []);

    const items = rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      platform: r.platform,
      activity_type: r.activity_type,
      content_title: r.content_title,
      content_subtitle: r.content_subtitle,
      content_image_url: r.content_image_url,
      content_external_url: r.content_external_url,
      content_metadata: r.content_metadata,
      created_at: r.created_at,
      profile: r.profiles
        ? {
            id: r.profiles.id,
            nickname: r.profiles.nickname,
            avatar_url: r.profiles.avatar_url,
          }
        : null,
      likes_count: likeCounts.get(r.id) ?? 0,
      comments_count: commentCounts.get(r.id) ?? 0,
      is_liked: myLikedSet.has(r.id),
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[feed/recommendations]', err);
    return NextResponse.json({ items: [] });
  }
}
