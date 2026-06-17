'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/stores/useAppStore';
import { createClient } from '@/lib/supabase/client';
import StatusDot from '@/components/ui/StatusDot';
import NetflixUpload from '@/components/NetflixUpload';
import type { PlatformConnection } from '@/types';
import { FaSpotify, FaSteam } from 'react-icons/fa';
import { SiApplemusic } from 'react-icons/si';
import { Pencil, Check, X, Link2, Copy } from 'lucide-react';

// react-icons의 공식 브랜드 로고 사용
const allPlatforms = [
  { key: 'spotify', name: 'Spotify', Icon: FaSpotify, bgColor: 'bg-green-600', fullSupport: true },
  { key: 'apple_music', name: 'Apple Music', Icon: SiApplemusic, bgColor: 'bg-pink-600', fullSupport: true },
  { key: 'steam', name: 'Steam', Icon: FaSteam, bgColor: 'bg-zinc-800', fullSupport: true },
];

export default function ProfilePage() {
  const { currentUser, signOut } = useAuth();
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [friendCount, setFriendCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 회원 탈퇴
  const handleDeleteAccount = async () => {
    if (!currentUser) return;

    // 1단계: 일반 확인
    const ok = confirm(
      '정말 회원 탈퇴를 진행하시겠습니까?\n\n' +
      '연동된 플랫폼, 친구 관계, 활동 기록, 취향 레포트 등\n' +
      '모든 데이터가 영구적으로 삭제되며 복구할 수 없습니다.'
    );
    if (!ok) return;

    // 2단계: 닉네임 직접 입력 (오작동 방지용 더블 체크)
    const input = prompt(`확인을 위해 닉네임 "${currentUser.nickname}"을(를) 정확히 입력해주세요`);
    if (input === null) return; // 취소 클릭
    if (input !== currentUser.nickname) {
      alert('닉네임이 일치하지 않아 취소되었습니다');
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch('/api/auth/delete-account', { method: 'POST' });
      if (res.ok) {
        alert('회원 탈퇴가 완료되었습니다. 그동안 이용해주셔서 감사합니다.');
        window.location.href = '/auth/login';
      } else {
        alert('회원 탈퇴에 실패했습니다. 잠시 후 다시 시도해주세요.');
        setDeleting(false);
      }
    } catch {
      alert('회원 탈퇴에 실패했습니다. 잠시 후 다시 시도해주세요.');
      setDeleting(false);
    }
  };

  // 닉네임 인라인 편집 (카카오에서 닉네임을 못 받아왔거나 바꾸고 싶을 때)
  const [editingNick, setEditingNick] = useState(false);
  const [nickValue, setNickValue] = useState('');
  const [savingNick, setSavingNick] = useState(false);

  // 초대 링크 복사
  const [inviteCopied, setInviteCopied] = useState(false);
  const handleCopyInvite = async () => {
    if (!currentUser) return;
    const url = `${window.location.origin}/auth/login?ref=${currentUser.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      // 권한 거부 등
      alert('복사 실패 — 직접 선택해 복사해주세요:\n' + url);
    }
  };

  const startEditNick = () => {
    setNickValue(currentUser?.nickname ?? '');
    setEditingNick(true);
  };
  const cancelEditNick = () => {
    setEditingNick(false);
    setNickValue('');
  };
  const saveNick = async () => {
    const trimmed = nickValue.trim();
    if (trimmed.length === 0) {
      alert('닉네임을 입력하세요');
      return;
    }
    if (trimmed === currentUser?.nickname) {
      setEditingNick(false);
      return;
    }
    setSavingNick(true);
    try {
      const res = await fetch('/api/profile/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error ?? '닉네임 변경 실패');
        return;
      }
      if (currentUser) {
        setCurrentUser({ ...currentUser, nickname: trimmed });
      }
      setEditingNick(false);
    } catch {
      alert('네트워크 오류로 변경 실패');
    } finally {
      setSavingNick(false);
    }
  };

  const handleConnect = (platformKey: string) => {
    if (['spotify', 'steam'].includes(platformKey)) {
      const routes: Record<string, string> = {
        spotify: '/api/auth/spotify',
        steam: '/api/auth/steam',
      };
      window.location.href = routes[platformKey];
    } else {
      alert('준비 중입니다');
    }
  };

  // 연동 해제
  const handleDisconnect = async (platformKey: string, platformName: string) => {
    if (!confirm(`${platformName} 연동을 해제하시겠습니까?`)) return;

    setDisconnecting(platformKey);
    try {
      const res = await fetch('/api/platform/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platformKey }),
      });

      if (res.ok) {
        // 연동 목록에서 제거
        setConnections(prev => prev.filter(c => c.platform !== platformKey));
      } else {
        alert('연동 해제에 실패했습니다');
      }
    } catch {
      alert('연동 해제에 실패했습니다');
    } finally {
      setDisconnecting(null);
    }
  };

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: conns } = await supabase
        .from('platform_connections')
        .select('*')
        .eq('user_id', user.id);
      setConnections((conns || []) as PlatformConnection[]);

      const { count } = await supabase
        .from('friendships')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'accepted'); // P-001: pending 요청은 친구 수에서 제외
      setFriendCount(count || 0);

      setLoading(false);
    }
    fetchData();
  }, []);

  const connectedPlatforms = connections.map(c => c.platform as string);
  const connectedCount = connectedPlatforms.filter(p => p !== 'kakao').length;

  return (
    <div className="max-w-3xl mx-auto p-8 animate-fade-up">
      <h2 className="text-2xl font-bold mb-8">프로필</h2>
      <div className="text-center mb-8">
        {currentUser?.avatar_url ? (
          <img src={currentUser.avatar_url} alt={currentUser.nickname} className="w-24 h-24 rounded-full mx-auto mb-4 object-cover" />
        ) : (
          <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-yellow-400 to-orange-500 mx-auto mb-4 flex items-center justify-center text-3xl font-bold text-black">
            {currentUser?.nickname?.slice(0, 1) || '나'}
          </div>
        )}
        {editingNick ? (
          <div className="flex items-center gap-2 justify-center">
            <input
              value={nickValue}
              onChange={(e) => setNickValue(e.target.value)}
              maxLength={20}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveNick();
                if (e.key === 'Escape') cancelEditNick();
              }}
              disabled={savingNick}
              className="px-3 py-1.5 text-base font-bold rounded-lg bg-zinc-800 border border-zinc-700 outline-none focus:border-zinc-500 text-center"
            />
            <button
              onClick={saveNick}
              disabled={savingNick}
              aria-label="저장"
              className="p-1.5 rounded-full bg-white text-black hover:bg-zinc-100 disabled:opacity-50 transition"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={cancelEditNick}
              disabled={savingNick}
              aria-label="취소"
              className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 justify-center">
            <div className="text-xl font-bold">{currentUser?.nickname || '내 이름'}</div>
            <button
              onClick={startEditNick}
              aria-label="닉네임 편집"
              className="p-1 rounded-full text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="text-sm text-zinc-500 mt-1">카카오톡으로 로그인됨</div>
        <div className="flex justify-center gap-8 mt-5">
          <div className="text-center"><div className="text-xl font-bold">{connectedCount}</div><div className="text-xs text-zinc-500 mt-0.5">연동 플랫폼</div></div>
          <div className="text-center"><div className="text-xl font-bold">{friendCount}</div><div className="text-xs text-zinc-500 mt-0.5">카톡 친구</div></div>
        </div>
      </div>
      <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">연동된 플랫폼</h3>
      <div className="space-y-2">
        {allPlatforms.map((p) => {
          const isConnected = connectedPlatforms.includes(p.key);
          return (
            <div
              key={p.key}
              onClick={() => !isConnected && handleConnect(p.key)}
              className={`bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/35 rounded-xl p-4 flex items-center gap-4 ${!isConnected ? 'opacity-50 cursor-pointer hover:opacity-70 transition' : ''}`}
            >
              <div className={`w-10 h-10 rounded-lg ${p.bgColor} flex items-center justify-center flex-shrink-0`}>
                <p.Icon className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">{p.name}</div>
                <div className="text-xs text-zinc-500">
                  {isConnected ? (p.fullSupport ? '연동됨' : '제한적 연동') : '미연동'}
                </div>
              </div>
              {isConnected ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDisconnect(p.key, p.name);
                  }}
                  disabled={disconnecting === p.key}
                  className="text-xs text-zinc-500 hover:text-red-400 transition px-3 py-1 rounded-lg hover:bg-red-900/20"
                >
                  {disconnecting === p.key ? '해제 중...' : '연동 해제'}
                </button>
              ) : (
                <span className="text-xs text-zinc-600">연동하기</span>
              )}
            </div>
          );
        })}
      </div>
      {/* 친구 초대 링크 */}
      <div className="mt-8">
        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">친구 초대</h3>
        <div className="bg-gradient-to-br from-purple-500/15 to-pink-500/10 border border-purple-500/20 rounded-2xl p-5">
          <div className="flex items-start gap-3 mb-4">
            <Link2 className="w-5 h-5 text-purple-400 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold mb-1">내 초대 링크</div>
              <div className="text-xs text-zinc-400 leading-relaxed">
                이 링크로 가입하면 자동으로 친구 요청이 전송돼요. 카톡에 공유해 보세요.
              </div>
            </div>
          </div>
          <button
            onClick={handleCopyInvite}
            disabled={!currentUser}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 transition"
          >
            {inviteCopied ? (
              <>
                <Check className="w-4 h-4" />
                복사됐어요
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                링크 복사
              </>
            )}
          </button>
        </div>
      </div>

      {/* Netflix 시청 기록 업로드 */}
      <div className="mt-8">
        <NetflixUpload />
      </div>

      <button onClick={signOut} className="w-full mt-8 py-3 text-sm text-zinc-500 hover:text-red-400 transition border border-zinc-800 rounded-xl hover:border-red-900/50">로그아웃</button>

      {/* 회원 탈퇴: 위험한 작업이므로 더 어둡고 작게 표시 */}
      <button
        onClick={handleDeleteAccount}
        disabled={deleting}
        className="w-full mt-3 py-3 text-xs text-zinc-600 hover:text-red-500 transition border border-zinc-900 rounded-xl hover:border-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {deleting ? '탈퇴 처리 중...' : '회원 탈퇴'}
      </button>
    </div>
  );
}
