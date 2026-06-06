// /analysis 페이지의 "게임 카드" 섹션 (음악 WrappedSection의 게임판)
// - Steam 미연동: 안내
// - 카드 미생성: 생성 버튼
// - 생성됨: 카드 보기 + 공유 + 다시 만들기
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Gamepad2, Share2, RefreshCw, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ui/ToastProvider';
import type { WrappedGamesReport } from '@/lib/wrapped/game-types';

// WrappedSection 와 동일한 통합 로딩 + userId prop 패턴 — AnalysisPage 의 주석 참고
interface WrappedGamesSectionProps {
  userId: string | null;
  forceLoading?: boolean;
  onLoadingChange?: (loading: boolean) => void;
}

export default function WrappedGamesSection({ userId, forceLoading, onLoadingChange }: WrappedGamesSectionProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState<WrappedGamesReport | null>(null);
  const [hasSteam, setHasSteam] = useState(false);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    if (!userId) return;
    async function load() {
      const supabase = createClient();

      const [{ data: existing }, { data: conn }] = await Promise.all([
        supabase.from('wrapped_games_reports').select('*').eq('user_id', userId).maybeSingle(),
        supabase
          .from('platform_connections')
          .select('id')
          .eq('user_id', userId)
          .eq('platform', 'steam')
          .maybeSingle(),
      ]);

      setReport(existing as WrappedGamesReport | null);
      setHasSteam(!!conn);
      setLoading(false);
    }
    load();
  }, [userId]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/wrapped-games/generate', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? '생성에 실패했어요');
        return;
      }
      setReport(json);
      toast.success('게임 카드가 만들어졌어요!');
    } catch {
      toast.error('네트워크 오류로 생성에 실패했어요');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyLink = async () => {
    if (!userId) return;
    const url = `${window.location.origin}/wrapped-games/${userId}`;
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

  // Steam 미연동
  if (!hasSteam) {
    return (
      <div className="rounded-2xl p-6 mb-6 bg-gradient-to-br from-cyan-500/15 to-blue-500/10 border border-cyan-500/20">
        <div className="flex items-start gap-3 mb-3">
          <Gamepad2 className="w-5 h-5 text-cyan-400 mt-0.5" />
          <div>
            <div className="font-semibold mb-1">게임 카드</div>
            <div className="text-sm text-zinc-400 leading-relaxed">
              Steam을 연동하면 최근 플레이/누적 시간/장르를 카드로 만들어 공유할 수 있어요.
            </div>
          </div>
        </div>
        <button
          onClick={() => router.push('/profile')}
          className="text-sm font-semibold text-cyan-300 hover:text-cyan-200 transition"
        >
          프로필에서 Steam 연동하기 →
        </button>
      </div>
    );
  }

  // 카드 미생성
  if (!report) {
    return (
      <div className="rounded-2xl p-6 mb-6 bg-gradient-to-br from-cyan-500/15 to-blue-500/10 border border-cyan-500/20">
        <div className="flex items-start gap-3 mb-4">
          <Gamepad2 className="w-5 h-5 text-cyan-400 mt-0.5" />
          <div>
            <div className="font-semibold mb-1">게임 카드 만들기</div>
            <div className="text-sm text-zinc-400 leading-relaxed">
              최근 2주 + 누적 플레이 데이터로 7장의 카드를 만들어드려요. 장르 집계로 인해 30초 정도 걸릴 수 있어요.
            </div>
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full py-3 rounded-xl bg-white text-black font-semibold text-sm disabled:opacity-50 hover:bg-zinc-100 transition"
        >
          {generating ? '만드는 중…' : '게임 카드 만들기'}
        </button>
      </div>
    );
  }

  // 생성됨
  const generatedAt = new Date(report.generated_at);

  return (
    <div className="rounded-2xl p-6 mb-6 bg-gradient-to-br from-cyan-500/15 to-blue-500/10 border border-cyan-500/20">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="font-semibold mb-1">내 게임 카드</div>
          <div className="text-xs text-zinc-500">
            {generatedAt.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} 생성
          </div>
        </div>
        <Gamepad2 className="w-5 h-5 text-cyan-400" />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => userId && router.push(`/wrapped-games/${userId}`)}
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
