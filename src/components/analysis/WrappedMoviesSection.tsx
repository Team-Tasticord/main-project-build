// /analysis 페이지의 "영화 카드" 섹션 (음악/게임 Section의 영화판)
// - Netflix 기록 없음: CSV 업로드 안내
// - 카드 미생성: 생성 버튼
// - 생성됨: 카드 보기 + 공유 + 다시 만들기
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Film, Share2, RefreshCw, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ui/ToastProvider';
import type { WrappedMoviesReport } from '@/lib/wrapped/movie-types';

// WrappedSection 와 동일한 통합 로딩 + userId prop 패턴 — AnalysisPage 의 주석 참고
interface WrappedMoviesSectionProps {
  userId: string | null;
  forceLoading?: boolean;
  onLoadingChange?: (loading: boolean) => void;
}

export default function WrappedMoviesSection({ userId, forceLoading, onLoadingChange }: WrappedMoviesSectionProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState<WrappedMoviesReport | null>(null);
  const [hasNetflix, setHasNetflix] = useState(false);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    if (!userId) return;
    async function load() {
      const supabase = createClient();

      // netflix_history는 앱 전역에서 admin API(/api/netflix/history)로만 읽음.
      // 브라우저 클라이언트 직접 조회는 RLS 때문에 0건으로 잡혀 hasNetflix가 항상 false였음.
      // 단, 여기서는 "기록이 있냐 없냐"만 필요하므로 ?count_only=true 모드로
      // 전체 페이로드를 받지 않고 head 카운트만 받는다 — 가장 느린 호출을 가볍게.
      const [{ data: existing }, netflixRes] = await Promise.all([
        supabase.from('wrapped_movies_reports').select('*').eq('user_id', userId).maybeSingle(),
        fetch('/api/netflix/history?count_only=true'),
      ]);

      let netflixCount = 0;
      try {
        if (netflixRes.ok) {
          const nf = await netflixRes.json();
          netflixCount = nf.totalCount ?? 0;
        }
      } catch {
        netflixCount = 0;
      }

      setReport(existing as WrappedMoviesReport | null);
      setHasNetflix(netflixCount > 0);
      setLoading(false);
    }
    load();
  }, [userId]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/wrapped-movies/generate', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? '생성에 실패했어요');
        return;
      }
      setReport(json);
      toast.success('영화 카드가 만들어졌어요!');
    } catch {
      toast.error('네트워크 오류로 생성에 실패했어요');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyLink = async () => {
    if (!userId) return;
    const url = `${window.location.origin}/wrapped-movies/${userId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('공유 링크가 복사됐어요');
    } catch {
      toast.error('복사 실패 — 링크를 직접 선택해주세요');
    }
  };

  if (loading || forceLoading) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800/35 rounded-2xl p-6 animate-pulse h-32 mb-6" />
    );
  }

  // Netflix 기록 없음
  if (!hasNetflix) {
    return (
      <div className="rounded-2xl p-6 mb-6 bg-gradient-to-br from-red-500/15 to-rose-500/10 border border-red-500/20">
        <div className="flex items-start gap-3 mb-3">
          <Film className="w-5 h-5 text-red-400 mt-0.5" />
          <div>
            <div className="font-semibold mb-1">영화 카드</div>
            <div className="text-sm text-zinc-400 leading-relaxed">
              Netflix 시청 기록 CSV를 업로드하면 최근 본 작품·장르 분포를 카드로 만들어 공유할 수 있어요.
            </div>
          </div>
        </div>
        <button
          onClick={() => router.push('/profile')}
          className="text-sm font-semibold text-red-300 hover:text-red-200 transition"
        >
          프로필에서 Netflix CSV 업로드하기 →
        </button>
      </div>
    );
  }

  // 카드 미생성
  if (!report) {
    return (
      <div className="rounded-2xl p-6 mb-6 bg-gradient-to-br from-red-500/15 to-rose-500/10 border border-red-500/20">
        <div className="flex items-start gap-3 mb-4">
          <Film className="w-5 h-5 text-red-400 mt-0.5" />
          <div>
            <div className="font-semibold mb-1">영화 카드 만들기</div>
            <div className="text-sm text-zinc-400 leading-relaxed">
              업로드한 Netflix 시청 기록으로 최근 본 작품·장르 분석 카드를 만들어드려요.
            </div>
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full py-3 rounded-xl bg-white text-black font-semibold text-sm disabled:opacity-50 hover:bg-zinc-100 transition"
        >
          {generating ? '만드는 중…' : '영화 카드 만들기'}
        </button>
      </div>
    );
  }

  // 생성됨
  const generatedAt = new Date(report.generated_at);

  return (
    <div className="rounded-2xl p-6 mb-6 bg-gradient-to-br from-red-500/15 to-rose-500/10 border border-red-500/20">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="font-semibold mb-1">내 영화 카드</div>
          <div className="text-xs text-zinc-500">
            {generatedAt.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} 생성
          </div>
        </div>
        <Film className="w-5 h-5 text-red-400" />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => userId && router.push(`/wrapped-movies/${userId}`)}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white text-black font-semibold text-sm hover:bg-zinc-100 transition"
        >
          <ExternalLink className="w-4 h-4" />
          카드 보기
        </button>
        <button
          onClick={handleCopyLink}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-zinc-800 text-white font-semibold text-sm hover:bg-zinc-700 transition"
        >
          <Share2 className="w-4 h-4" />
          링크 복사
        </button>
        <button
          onClick={handleGenerate}
          disabled={generating}
          aria-label="다시 만들기"
          title="다시 만들기"
          className="px-3 py-2.5 rounded-xl font-semibold text-white transition disabled:opacity-50 bg-zinc-800 hover:bg-zinc-700"
        >
          <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}
