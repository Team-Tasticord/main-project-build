'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ChevronLeft,
  Music,
  Search,
  Play,
  Pause,
  Plus,
  Trash2,
  Copy,
  MessageCircle,
  Camera,
  UserPlus,
  X,
  ChevronDown,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import Avatar from '@/components/ui/Avatar';
import type { Profile } from '@/types';

// ============================================
// 타입 정의
// ============================================
interface PlaylistDetail {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  cover_url: string | null;
}

interface MemberItem {
  id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  joined_at: string;
  profile: Profile | null;
}

interface SongItem {
  id: string;
  playlist_id: string;
  added_by: string;
  title: string;
  artist: string;
  album: string | null;
  image_url: string | null;
  spotify_uri: string | null;
  apple_music_id: string | null;
  duration_ms: number | null;
  preview_url: string | null;
  external_url: string | null;
  genre: string | null;
  links: Record<string, string> | null;
  added_at: string;
  added_by_profile: Profile | null;
}

interface SearchResult {
  trackId: number;
  title: string;
  artist: string;
  album: string | null;
  image_url: string | null;
  duration_ms: number | null;
  preview_url: string | null;
  external_url: string | null;
  genre: string | null;
}

// ============================================
// 유틸
// ============================================
const formatDuration = (ms: number | null) => {
  if (!ms) return '';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// 네이티브 앱 URI가 있으면 먼저 시도, 실패하면 웹 URL로 fallback
const openWithApp = (appUri: string | null | undefined, webUrl: string) => {
  if (appUri) {
    window.location.href = appUri;
    setTimeout(() => window.open(webUrl, '_blank'), 800);
  } else {
    window.open(webUrl, '_blank');
  }
};

// 곡의 각 플랫폼 링크를 조합 — Odesli 결과가 없으면 검색 URL fallback
const getPlatformLinks = (song: SongItem) => {
  const links = song.links || {};
  const q = encodeURIComponent(`${song.title} ${song.artist}`);
  return {
    apple: links.apple_music_url || song.external_url || `https://music.apple.com/kr/search?term=${q}`,
    appleApp: links.apple_music_app,
    spotify: links.spotify_url || `https://open.spotify.com/search/${q}`,
    spotifyApp: links.spotify_app,
    youtube: links.youtube_url || `https://music.youtube.com/search?q=${q}`,
  };
};

const roleLabel = (role: string) => (role === 'owner' ? '방장' : role === 'editor' ? '편집자' : '뷰어');
const roleBadgeClass = (role: string) =>
  role === 'owner'
    ? 'bg-purple-600/20 text-purple-400'
    : role === 'editor'
    ? 'bg-blue-600/20 text-blue-400'
    : 'bg-zinc-700/20 text-zinc-400';

// ============================================
// 페이지
// ============================================
export default function PlaylistDetailPage() {
  const params = useParams();
  const router = useRouter();
  const playlistId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [myRole, setMyRole] = useState<'owner' | 'editor' | 'viewer'>('viewer');
  const [chatRoomId, setChatRoomId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{
    kind: 'forbidden' | 'not_found' | 'server' | 'network';
    message: string;
  } | null>(null);

  // 검색 상태
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [addingIds, setAddingIds] = useState<Set<number>>(new Set());

  // 삭제 모드
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(new Set());

  // 미리 듣기
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 멤버 초대 모달
  const [inviteOpen, setInviteOpen] = useState(false);
  const [friendList, setFriendList] = useState<Profile[]>([]);

  // 커버 업로드
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);

  // Spotify 연동 여부 + 내보내기 상태
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{
    webUrl: string;
    appUri: string;
    addedSongs: number;
    totalSongs: number;
    skipped: string[];
  } | null>(null);

  const canEdit = myRole === 'owner' || myRole === 'editor';
  const isOwner = myRole === 'owner';

  // --------------------------------------------
  // 플레이리스트 상세 로드
  // --------------------------------------------
  const loadPlaylist = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/playlists/${playlistId}`);
      if (!res.ok) {
        if (res.status === 403) {
          setLoadError({ kind: 'forbidden', message: '권한이 없습니다' });
        } else if (res.status === 404) {
          setLoadError({ kind: 'not_found', message: '플레이리스트를 찾을 수 없습니다' });
        } else {
          setLoadError({ kind: 'server', message: '플레이리스트를 불러오지 못했습니다' });
        }
        return;
      }
      const json = await res.json();
      setPlaylist(json.playlist);
      setMembers(json.members || []);
      setSongs(json.songs || []);
      setMyRole(json.myRole);
      setChatRoomId(json.chatRoomId);
      setUserId(json.userId);
    } catch {
      setLoadError({ kind: 'network', message: '네트워크 오류가 발생했습니다' });
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    loadPlaylist();
  }, [loadPlaylist]);

  // Spotify 연동 여부 확인 (내보내기 버튼 표시용)
  useEffect(() => {
    async function checkSpotify() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('platform_connections')
        .select('platform')
        .eq('user_id', user.id)
        .eq('platform', 'spotify')
        .maybeSingle();
      setSpotifyConnected(!!data);
    }
    checkSpotify();
  }, [supabase]);

  // --------------------------------------------
  // Spotify로 내보내기
  // --------------------------------------------
  const handleExportSpotify = async () => {
    if (!confirm('이 플레이리스트를 Spotify로 내보내시겠습니까?\n각 곡을 Spotify에서 검색해서 새 플레이리스트로 만듭니다.')) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/playlists/${playlistId}/export-spotify`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || '내보내기 실패');
        return;
      }

      setExportResult(data);
      // 앱 딥링크로 바로 열기 시도
      if (data.appUri) {
        window.location.href = data.appUri;
      }
    } catch {
      alert('내보내기 중 오류가 발생했습니다');
    } finally {
      setExporting(false);
    }
  };

  // 페이지 벗어날 때 미리 듣기 정리
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  // --------------------------------------------
  // 곡 검색 (iTunes)
  // --------------------------------------------
  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/playlists/${playlistId}/songs/search?q=${encodeURIComponent(query.trim())}`
      );
      const json = await res.json();
      setSearchResults(json.results || []);
    } finally {
      setSearching(false);
    }
  };

  // --------------------------------------------
  // 곡 추가 — 전체 재로드 대신 반환된 곡을 로컬 state에 prepend
  // --------------------------------------------
  const handleAddSong = async (result: SearchResult) => {
    if (addingIds.has(result.trackId)) return;
    setAddingIds((prev) => new Set(prev).add(result.trackId));
    try {
      const res = await fetch(`/api/playlists/${playlistId}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: result.title,
          artist: result.artist,
          album: result.album,
          image_url: result.image_url,
          duration_ms: result.duration_ms,
          preview_url: result.preview_url,
          external_url: result.external_url,
          genre: result.genre,
        }),
      });
      if (res.ok) {
        const inserted = await res.json();
        // 서버는 playlist_songs 행 + { links, linksStatus }를 반환.
        // 현재 사용자를 added_by_profile에 붙여서 UI에서 곧바로 표시 가능하게 함.
        const myProfile =
          members.find((m) => m.user_id === userId)?.profile ?? null;
        const newSong: SongItem = {
          id: inserted.id,
          playlist_id: inserted.playlist_id,
          added_by: inserted.added_by,
          title: inserted.title,
          artist: inserted.artist,
          album: inserted.album ?? null,
          image_url: inserted.image_url ?? null,
          spotify_uri: inserted.spotify_uri ?? null,
          apple_music_id: inserted.apple_music_id ?? null,
          duration_ms: inserted.duration_ms ?? null,
          preview_url: inserted.preview_url ?? null,
          external_url: inserted.external_url ?? null,
          genre: inserted.genre ?? null,
          links: inserted.links ?? null,
          added_at: inserted.added_at ?? new Date().toISOString(),
          added_by_profile: myProfile,
        };
        setSongs((prev) => [newSong, ...prev]);
      }
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev);
        next.delete(result.trackId);
        return next;
      });
    }
  };

  // --------------------------------------------
  // 곡 삭제
  // --------------------------------------------
  const toggleSelectSong = (songId: string) => {
    setSelectedSongIds((prev) => {
      const next = new Set(prev);
      if (next.has(songId)) next.delete(songId);
      else next.add(songId);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedSongIds.size === 0) return;
    if (!confirm(`선택한 ${selectedSongIds.size}곡을 삭제할까요?`)) return;

    const ids = Array.from(selectedSongIds);
    const results = await Promise.all(
      ids.map(async (sid) => {
        try {
          const res = await fetch(`/api/playlists/${playlistId}/songs/${sid}`, { method: 'DELETE' });
          return { sid, ok: res.ok };
        } catch {
          return { sid, ok: false };
        }
      }),
    );

    // 성공한 것만 로컬 state에서 제거 (전체 재로드 대신 부분 업데이트)
    const deletedIds = new Set(results.filter((r) => r.ok).map((r) => r.sid));
    if (deletedIds.size > 0) {
      setSongs((prev) => prev.filter((s) => !deletedIds.has(s.id)));
    }
    setSelectedSongIds(new Set());
    setDeleteMode(false);

    const failed = results.length - deletedIds.size;
    if (failed > 0) {
      alert(`${failed}곡은 삭제하지 못했습니다`);
    }
  };

  // --------------------------------------------
  // 곡 목록 복사
  // --------------------------------------------
  const handleCopyList = async () => {
    const text = songs.map((s, i) => `${i + 1}. ${s.title} - ${s.artist}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      alert('곡 목록이 복사되었습니다');
    } catch {
      alert('복사에 실패했습니다');
    }
  };

  // --------------------------------------------
  // 미리 듣기 토글
  // --------------------------------------------
  const togglePreview = (songId: string, url: string | null) => {
    if (!url) return;
    if (playingId === songId) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(url);
    audio.volume = 0.5;
    audio.onended = () => setPlayingId(null);
    audio.play().catch(() => setPlayingId(null));
    audioRef.current = audio;
    setPlayingId(songId);
  };

  // --------------------------------------------
  // 커버 이미지 업로드
  // --------------------------------------------
  const handleCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/playlists/${playlistId}/cover`, {
        method: 'POST',
        body: fd,
      });
      if (res.ok) {
        await loadPlaylist();
      }
    } finally {
      setUploadingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  // --------------------------------------------
  // 친구 초대
  // --------------------------------------------
  const openInviteModal = async () => {
    if (!userId) return;
    setInviteOpen(true);
    const { data } = await supabase
      .from('friendships')
      .select('friend:profiles!friendships_friend_id_fkey(*)')
      .eq('user_id', userId)
      .eq('status', 'accepted'); // P-001: accepted 친구만 초대 대상

    const existingIds = new Set(members.map((m) => m.user_id));
    const available: Profile[] = ((data || []) as unknown as Array<{ friend: Profile }>)
      .map((d) => d.friend)
      .filter((f): f is Profile => !!f && !existingIds.has(f.id));

    setFriendList(available);
  };

  const handleInviteFriend = async (friendId: string) => {
    const res = await fetch(`/api/playlists/${playlistId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: friendId }),
    });
    if (res.ok) {
      setFriendList((prev) => prev.filter((f) => f.id !== friendId));
      await loadPlaylist();
    }
  };

  // --------------------------------------------
  // 역할 변경 / 멤버 추방
  // --------------------------------------------
  const handleRoleChange = async (memberId: string, role: 'editor' | 'viewer') => {
    const res = await fetch(`/api/playlists/${playlistId}/members`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, role }),
    });
    if (res.ok) await loadPlaylist();
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm('이 멤버를 추방할까요?')) return;
    const res = await fetch(`/api/playlists/${playlistId}/members?memberId=${memberId}`, {
      method: 'DELETE',
    });
    if (res.ok) await loadPlaylist();
  };

  // --------------------------------------------
  // 렌더
  // --------------------------------------------
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6 sm:p-8 animate-fade-up">
        <div className="h-32 bg-zinc-900/50 border border-zinc-800/35 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-8 animate-fade-up">
        <button
          onClick={() => router.push('/messages?tab=playlists')}
          className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-200 transition mb-4"
        >
          <ChevronLeft className="w-4 h-4" />
          플레이리스트 목록
        </button>
        <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/35 rounded-2xl p-8 text-center">
          <Music className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <h2 className="text-lg font-bold mb-2">{loadError.message}</h2>
          <p className="text-sm text-zinc-500 mb-6">
            {loadError.kind === 'forbidden'
              ? '이 플레이리스트에 접근할 수 있는 권한이 없습니다.'
              : loadError.kind === 'not_found'
              ? '삭제되었거나 존재하지 않는 플레이리스트입니다.'
              : loadError.kind === 'network'
              ? '네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
              : '잠시 후 다시 시도해 주세요.'}
          </p>
          <div className="flex items-center justify-center gap-2">
            {(loadError.kind === 'server' || loadError.kind === 'network') && (
              <button
                onClick={() => {
                  setLoading(true);
                  loadPlaylist();
                }}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-semibold transition"
              >
                다시 시도
              </button>
            )}
            <button
              onClick={() => router.push('/messages?tab=playlists')}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-semibold transition"
            >
              목록으로
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!playlist) return null;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-8 animate-fade-up">
      {/* 뒤로 가기 */}
      <button
        onClick={() => router.push('/messages?tab=playlists')}
        className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-200 transition mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        플레이리스트 목록
      </button>

      {/* 헤더 카드 */}
      <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/35 rounded-2xl p-4 sm:p-6 mb-6">
        <div className="flex items-center gap-4">
          {/* 커버 이미지 */}
          <div className="relative flex-shrink-0">
            {playlist.cover_url ? (
              <div
                className={`w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-cover bg-center bg-zinc-800 ${
                  canEdit ? 'cursor-pointer' : ''
                }`}
                style={{ backgroundImage: `url('${playlist.cover_url}')` }}
                onClick={() => canEdit && coverInputRef.current?.click()}
              >
                {canEdit && (
                  <div className="w-full h-full rounded-xl opacity-0 hover:opacity-100 bg-black/60 transition flex items-center justify-center">
                    <Camera className="w-5 h-5 text-white" />
                  </div>
                )}
              </div>
            ) : (
              <div
                className={`w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-gradient-to-br from-purple-600/30 to-pink-600/30 flex items-center justify-center ${
                  canEdit ? 'cursor-pointer hover:from-purple-600/50 hover:to-pink-600/50 transition' : ''
                }`}
                onClick={() => canEdit && coverInputRef.current?.click()}
              >
                {canEdit ? (
                  <Camera className="w-5 h-5 text-zinc-200" />
                ) : (
                  <Music className="w-6 h-6 text-zinc-200" />
                )}
              </div>
            )}
            {canEdit && (
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleCoverChange}
                disabled={uploadingCover}
              />
            )}
          </div>

          {/* 이름 + 통계 */}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold truncate">{playlist.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap text-xs sm:text-sm text-zinc-500">
              <span>멤버 {members.length}명</span>
              <span>·</span>
              <span>{songs.length}곡</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${roleBadgeClass(myRole)}`}>
                {roleLabel(myRole)}
              </span>
            </div>
          </div>
        </div>

        {/* 채팅방 바로가기 */}
        {chatRoomId && (
          <button
            onClick={() => router.push(`/messages/${chatRoomId}`)}
            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition"
          >
            <MessageCircle className="w-4 h-4" />
            채팅방으로 이동
          </button>
        )}
      </div>

      {/* 곡 검색 섹션 (편집 권한이 있는 경우에만) */}
      {canEdit && (
        <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/35 rounded-2xl p-4 sm:p-6 mb-6">
          <h2 className="text-sm font-bold mb-3">곡 추가</h2>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="곡 제목이나 아티스트를 검색하세요"
                className="w-full pl-9 pr-3 py-2 bg-zinc-800 border border-zinc-700/50 rounded-lg text-sm outline-none focus:border-zinc-600 transition"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition"
            >
              {searching ? '검색 중' : '검색'}
            </button>
          </div>

          {/* 검색 결과 */}
          {searchResults.length > 0 && (
            <div className="mt-4 space-y-2">
              {/* 첫 번째 결과는 크게 */}
              <div>
                <div className="text-[11px] font-bold text-purple-400 uppercase tracking-wider mb-2">
                  가장 정확한 결과
                </div>
                <SearchResultRow
                  result={searchResults[0]}
                  large
                  onAdd={handleAddSong}
                  adding={addingIds.has(searchResults[0].trackId)}
                />
              </div>
              {searchResults.length > 1 && (
                <div className="space-y-1 pt-2">
                  {searchResults.slice(1).map((r) => (
                    <SearchResultRow
                      key={r.trackId}
                      result={r}
                      onAdd={handleAddSong}
                      adding={addingIds.has(r.trackId)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 곡 목록 */}
      <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/35 rounded-2xl p-4 sm:p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold">곡 목록 · {songs.length}곡</h2>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {songs.length > 0 && (
              <button
                onClick={() => {
                  if (!spotifyConnected) {
                    if (confirm('Spotify 연동이 필요합니다. 연동 페이지로 이동하시겠습니까?')) {
                      window.location.href = '/api/auth/spotify';
                    }
                    return;
                  }
                  handleExportSpotify();
                }}
                disabled={exporting}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#1DB954]/10 border border-[#1DB954]/20 text-[#1DB954] hover:bg-[#1DB954]/20 transition disabled:opacity-50"
                title={spotifyConnected ? 'Spotify에 새 플레이리스트로 생성' : 'Spotify 연동 후 사용 가능'}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
                {exporting ? '내보내는 중...' : 'Spotify로 내보내기'}
              </button>
            )}
            {songs.length > 0 && (
              <button
                onClick={handleCopyList}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs transition"
              >
                <Copy className="w-3.5 h-3.5" />
                곡 목록 복사
              </button>
            )}
            {canEdit && songs.length > 0 && (
              <button
                onClick={() => {
                  setDeleteMode((v) => !v);
                  setSelectedSongIds(new Set());
                }}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition ${
                  deleteMode
                    ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                    : 'bg-zinc-800 hover:bg-zinc-700'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleteMode ? '취소' : '삭제'}
              </button>
            )}
          </div>
        </div>

        {/* 삭제 모드 액션바 */}
        {deleteMode && selectedSongIds.size > 0 && (
          <div className="flex items-center justify-between mb-3 px-3 py-2 bg-red-600/10 border border-red-600/30 rounded-lg">
            <span className="text-sm text-red-400">{selectedSongIds.size}곡 선택됨</span>
            <button
              onClick={handleDeleteSelected}
              className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded-md text-xs font-semibold transition"
            >
              삭제
            </button>
          </div>
        )}

        {/* 곡 목록 */}
        {songs.length === 0 ? (
          <div className="py-10 text-center">
            <Music className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">아직 곡이 없습니다</p>
            {canEdit && <p className="text-zinc-600 text-xs mt-1">위에서 곡을 검색해 추가해 보세요</p>}
          </div>
        ) : (
          <div className="space-y-1">
            {songs.map((song, idx) => {
              const platforms = getPlatformLinks(song);
              const isPlaying = playingId === song.id;
              const isSelected = selectedSongIds.has(song.id);
              return (
                <div
                  key={song.id}
                  className={`flex items-center gap-3 p-2 rounded-lg transition ${
                    isSelected ? 'bg-red-600/10' : 'hover:bg-zinc-800/50'
                  }`}
                >
                  {/* 번호/체크박스 or 미리듣기 버튼 */}
                  <div className="w-8 flex-shrink-0 flex items-center justify-center">
                    {deleteMode ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectSong(song.id)}
                        className="w-4 h-4 accent-red-500 cursor-pointer"
                      />
                    ) : (
                      <button
                        onClick={() => togglePreview(song.id, song.preview_url)}
                        disabled={!song.preview_url}
                        className={`w-7 h-7 rounded-full flex items-center justify-center transition ${
                          song.preview_url
                            ? 'bg-zinc-800 hover:bg-purple-600 text-zinc-200'
                            : 'bg-zinc-800/50 text-zinc-600 cursor-not-allowed'
                        }`}
                        title={song.preview_url ? '미리 듣기' : '미리 듣기 없음'}
                      >
                        {isPlaying ? (
                          <Pause className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* 순번 (삭제모드 아닐 때 간단 표시) */}
                  {!deleteMode && (
                    <div className="w-6 text-xs text-zinc-500 text-right flex-shrink-0">{idx + 1}</div>
                  )}

                  {/* 앨범아트 */}
                  {song.image_url ? (
                    <div
                      className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-cover bg-center bg-zinc-800 flex-shrink-0"
                      style={{ backgroundImage: `url('${song.image_url}')` }}
                    />
                  ) : (
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-zinc-800 flex-shrink-0 flex items-center justify-center">
                      <Music className="w-4 h-4 text-zinc-500" />
                    </div>
                  )}

                  {/* 제목 / 아티스트 */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{song.title}</div>
                    <div className="text-xs text-zinc-500 truncate">
                      {song.artist}
                      {song.album ? ` · ${song.album}` : ''}
                    </div>
                  </div>

                  {/* 재생 시간 (모바일 숨김) */}
                  <div className="hidden sm:block text-xs text-zinc-500 flex-shrink-0">
                    {formatDuration(song.duration_ms)}
                  </div>

                  {/* 플랫폼 링크 */}
                  {!deleteMode && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => openWithApp(platforms.appleApp || null, platforms.apple)}
                        className="w-7 h-7 rounded-full flex items-center justify-center bg-zinc-800 hover:bg-pink-500/20 hover:text-pink-400 transition text-zinc-400"
                        title="Apple Music"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 00-1.877-.726 10.496 10.496 0 00-1.564-.15c-.04-.003-.083-.01-.124-.013H5.991c-.152.01-.303.017-.455.026-.747.043-1.49.123-2.193.4-1.336.53-2.3 1.452-2.865 2.78-.192.448-.292.925-.363 1.408-.056.392-.088.785-.1 1.18-.002.04-.01.08-.013.12v12.122c.01.153.016.303.027.455.044.742.126 1.482.4 2.18.526 1.336 1.447 2.3 2.775 2.865.448.192.926.292 1.41.363.39.056.783.088 1.177.1.04.002.08.01.12.013h12.122c.152-.01.302-.017.455-.026.74-.044 1.482-.124 2.18-.4 1.337-.527 2.303-1.448 2.867-2.776.193-.448.293-.926.365-1.41.057-.392.09-.785.098-1.18.004-.04.01-.08.014-.12V6.124zm-9.143.063c.08.006.158.015.236.023.7.074 1.388.18 2.047.43.76.288 1.44.695 2.015 1.275.586.595 1.028 1.3 1.3 2.1.22.65.333 1.32.4 1.997.006.08.014.158.02.236v8.264c-.005.077-.014.155-.02.232-.068.676-.18 1.348-.4 1.997-.273.8-.715 1.505-1.3 2.1-.575.58-1.255.987-2.015 1.275-.66.25-1.347.357-2.047.43-.078.008-.157.017-.236.023H9.148c-.08-.006-.157-.015-.236-.023-.7-.074-1.388-.18-2.047-.43-.76-.288-1.44-.695-2.015-1.275-.586-.595-1.028-1.3-1.3-2.1-.22-.65-.333-1.32-.4-1.997-.008-.08-.016-.158-.022-.237v-8.26c.006-.08.014-.158.02-.236.068-.676.18-1.348.4-1.997.273-.8.715-1.505 1.3-2.1.575-.58 1.255-.987 2.015-1.275.66-.25 1.347-.356 2.047-.43.08-.008.158-.017.236-.023h5.703z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => openWithApp(platforms.spotifyApp || null, platforms.spotify)}
                        className="w-7 h-7 rounded-full flex items-center justify-center bg-zinc-800 hover:bg-green-500/20 hover:text-green-400 transition text-zinc-400"
                        title="Spotify"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => window.open(platforms.youtube, '_blank')}
                        className="w-7 h-7 rounded-full flex items-center justify-center bg-zinc-800 hover:bg-red-500/20 hover:text-red-400 transition text-zinc-400"
                        title="YouTube Music"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm0 19.104c-3.924 0-7.104-3.18-7.104-7.104S8.076 4.896 12 4.896s7.104 3.18 7.104 7.104-3.18 7.104-7.104 7.104zm0-13.332c-3.432 0-6.228 2.796-6.228 6.228 0 3.432 2.796 6.228 6.228 6.228 3.432 0 6.228-2.796 6.228-6.228 0-3.432-2.796-6.228-6.228-6.228zM9.684 15.54V8.46L15.84 12l-6.156 3.54z" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 멤버 섹션 */}
      <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/35 rounded-2xl p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold">멤버 · {members.length}명</h2>
          {isOwner && (
            <button
              onClick={openInviteModal}
              className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-xs font-semibold transition"
            >
              <UserPlus className="w-3.5 h-3.5" />
              친구 초대
            </button>
          )}
        </div>

        <div className="space-y-2">
          {members.map((m) => {
            const isSelf = m.user_id === userId;
            return (
              <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-800/50 transition">
                <Avatar
                  name={m.profile?.nickname || '?'}
                  imageUrl={m.profile?.avatar_url}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">
                    {m.profile?.nickname || '알 수 없음'}
                    {isSelf && <span className="ml-1 text-[11px] text-zinc-500">(나)</span>}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${roleBadgeClass(m.role)}`}>
                  {roleLabel(m.role)}
                </span>
                {/* 방장만 보이는 역할 드롭다운 + 추방 버튼 (본인 제외, 방장 제외) */}
                {isOwner && !isSelf && m.role !== 'owner' && (
                  <>
                    <div className="relative">
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.user_id, e.target.value as 'editor' | 'viewer')}
                        className="appearance-none bg-zinc-800 hover:bg-zinc-700 text-xs rounded-md pl-2 pr-6 py-1 outline-none cursor-pointer transition"
                      >
                        <option value="editor">편집자</option>
                        <option value="viewer">뷰어</option>
                      </select>
                      <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400" />
                    </div>
                    <button
                      onClick={() => handleRemoveMember(m.user_id)}
                      className="w-7 h-7 rounded-md flex items-center justify-center bg-zinc-800 hover:bg-red-600/30 hover:text-red-400 text-zinc-400 transition"
                      title="추방"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 친구 초대 모달 */}
      {inviteOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setInviteOpen(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <h3 className="font-bold">친구 초대</h3>
              <button
                onClick={() => setInviteOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {friendList.length === 0 ? (
                <div className="py-10 text-center text-sm text-zinc-500">
                  초대할 수 있는 친구가 없습니다
                </div>
              ) : (
                <div className="space-y-1">
                  {friendList.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => handleInviteFriend(f.id)}
                      className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-800/70 transition text-left"
                    >
                      <Avatar name={f.nickname} imageUrl={f.avatar_url} size="sm" />
                      <div className="flex-1 min-w-0 text-sm font-semibold truncate">{f.nickname}</div>
                      <Plus className="w-4 h-4 text-zinc-400" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Spotify 내보내기 결과 모달 */}
      {exportResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800/50 rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <div className="text-center mb-4">
              <div className="w-12 h-12 rounded-full bg-[#1DB954]/20 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-[#1DB954]" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
              </div>
              <h3 className="font-semibold text-zinc-200 text-lg">Spotify에 추가 완료</h3>
              <p className="text-sm text-zinc-400 mt-1">
                {exportResult.addedSongs}/{exportResult.totalSongs}곡 추가됨
              </p>
            </div>

            {exportResult.skipped.length > 0 && (
              <div className="bg-zinc-800/50 rounded-xl p-3 mb-4 max-h-32 overflow-y-auto">
                <p className="text-xs text-zinc-500 mb-1">Spotify에서 찾을 수 없는 곡 ({exportResult.skipped.length}개):</p>
                {exportResult.skipped.slice(0, 5).map((s, i) => (
                  <p key={i} className="text-xs text-zinc-600 truncate">{s}</p>
                ))}
                {exportResult.skipped.length > 5 && (
                  <p className="text-xs text-zinc-600">...외 {exportResult.skipped.length - 5}개</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <a
                href={exportResult.appUri}
                className="block w-full py-2.5 bg-[#1DB954] hover:bg-[#1ed760] text-black text-sm font-semibold rounded-xl text-center transition"
              >
                Spotify 앱에서 열기
              </a>
              <a
                href={exportResult.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium rounded-xl text-center transition"
              >
                웹에서 열기
              </a>
              <button
                onClick={() => setExportResult(null)}
                className="w-full py-2 text-zinc-500 hover:text-zinc-300 text-sm transition"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// 검색 결과 행 (페이지 하위 컴포넌트)
// ============================================
function SearchResultRow({
  result,
  large,
  onAdd,
  adding,
}: {
  result: SearchResult;
  large?: boolean;
  onAdd: (r: SearchResult) => void;
  adding: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg transition ${
        large ? 'p-3 bg-zinc-800/50' : 'p-2 hover:bg-zinc-800/50'
      }`}
    >
      {result.image_url ? (
        <div
          className={`${large ? 'w-14 h-14' : 'w-10 h-10'} rounded-lg bg-cover bg-center bg-zinc-800 flex-shrink-0`}
          style={{ backgroundImage: `url('${result.image_url}')` }}
        />
      ) : (
        <div
          className={`${
            large ? 'w-14 h-14' : 'w-10 h-10'
          } rounded-lg bg-zinc-800 flex-shrink-0 flex items-center justify-center`}
        >
          <Music className="w-4 h-4 text-zinc-500" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className={`${large ? 'text-sm' : 'text-sm'} font-semibold truncate`}>{result.title}</div>
        <div className="text-xs text-zinc-500 truncate">
          {result.artist}
          {result.album ? ` · ${result.album}` : ''}
        </div>
      </div>
      <button
        onClick={() => onAdd(result)}
        disabled={adding}
        className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-md text-xs font-semibold transition flex-shrink-0"
      >
        {adding ? (
          '추가 중'
        ) : (
          <>
            <Plus className="w-3.5 h-3.5" />
            추가
          </>
        )}
      </button>
    </div>
  );
}
