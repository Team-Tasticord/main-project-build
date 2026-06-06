import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// 회원 탈퇴 API
//
// 기본 정리: auth.users 한 행을 삭제하면 profiles 의 ON DELETE CASCADE 로
// 연결된 모든 관련 데이터(platform_connections, activities, friendships,
// taste_reports, taste_cache, chat_members, chat_messages, playlist_*,
// netflix_history 등)가 함께 삭제됩니다.
//
// 추가 정리: chat_rooms 테이블은 profiles 를 직접 참조하지 않으므로
// 멤버가 모두 빠진 빈 방이 DB 에 garbage 로 남습니다. 이를 명시적으로 정리합니다.
export async function POST() {
  try {
    // 1) 현재 로그인된 사용자 확인 (쿠키 기반)
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();

    // 2) 삭제 전: 사용자가 참여 중인 채팅방 ID 목록을 미리 수집
    //    (auth.users 삭제 후에는 chat_members 도 CASCADE 로 함께 사라져
    //     어느 방에 속해 있었는지 추적할 수 없게 되므로 미리 확보)
    const { data: memberRooms } = await admin
      .from('chat_members')
      .select('room_id')
      .eq('user_id', user.id);

    const roomIds = (memberRooms || []).map(r => r.room_id as string);

    // 3) auth.users 삭제 → CASCADE 로 profiles 및 연결된 거의 모든 데이터 정리
    const { error } = await admin.auth.admin.deleteUser(user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 4) 후처리: 멤버가 0명이 된 chat_rooms 정리
    //    (DM 1:1 채팅방의 경우 상대도 멤버에서 빠지진 않지만,
    //     양쪽이 다 탈퇴했거나 1인 방 등 멤버 0명 케이스만 삭제)
    if (roomIds.length > 0) {
      const { data: stillHasMembers } = await admin
        .from('chat_members')
        .select('room_id')
        .in('room_id', roomIds);

      const occupied = new Set((stillHasMembers || []).map(r => r.room_id as string));
      const emptyRoomIds = roomIds.filter(id => !occupied.has(id));

      if (emptyRoomIds.length > 0) {
        await admin.from('chat_rooms').delete().in('id', emptyRoomIds);
      }
    }

    // 5) 클라이언트 세션 쿠키 정리 (브라우저에 남은 토큰 무효화)
    await supabase.auth.signOut();

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: '회원 탈퇴에 실패했습니다' }, { status: 500 });
  }
}
