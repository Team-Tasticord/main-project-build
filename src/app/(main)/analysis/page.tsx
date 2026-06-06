'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import AiReportCard from '@/components/analysis/AiReportCard';
import TasteSummary from '@/components/analysis/TasteSummary';
import SimilarFriends from '@/components/analysis/SimilarFriends';
import WrappedSection from '@/components/analysis/WrappedSection';
import WrappedGamesSection from '@/components/analysis/WrappedGamesSection';
import WrappedMoviesSection from '@/components/analysis/WrappedMoviesSection';

export default function AnalysisPage() {
  const router = useRouter();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // 한 번만 auth.getUser() 를 호출하고 userId 를 자식들에게 prop 으로 내려준다.
  // 기존에는 페이지+3개 자식이 각자 getUser() 를 호출해 총 4번의 토큰 검증
  // 라운드트립이 발생했음 → 1번으로 축소.
  const [userId, setUserId] = useState<string | null>(null);

  // Wrapped 3개 섹션(음악·게임·영화)의 통합 로딩 상태
  //
  // 문제: 음악·게임은 Supabase 직접 조회로 빠른데, 영화는 /api/netflix/history 라는
  //       REST 라운드트립으로 느려서 영화만 늦게 콘텐츠로 바뀌어 보였음.
  // 해결: 세 섹션 모두의 내부 로딩이 끝날 때까지 forceLoading=true 로 스켈레톤 유지 →
  //       가장 늦은 섹션이 끝나는 순간 셋이 동시에 콘텐츠로 전환된다.
  const [musicLoading, setMusicLoading] = useState(true);
  const [gameLoading, setGameLoading] = useState(true);
  const [movieLoading, setMovieLoading] = useState(true);
  const wrappedLoading = musicLoading || gameLoading || movieLoading;

  useEffect(() => {
    async function fetchReport() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data } = await supabase
        .from('taste_reports')
        .select('*')
        .eq('user_id', user.id)
        .gt('expires_at', new Date().toISOString())
        .order('generated_at', { ascending: false })
        .limit(1)
        .single();

      setReport(data);
      setLoading(false);
    }
    fetchReport();
  }, []);

  return (
    <div className="max-w-3xl mx-auto p-8 animate-fade-up">
      <h2 className="text-2xl font-bold mb-8">취향 분석</h2>

      <WrappedSection userId={userId} forceLoading={wrappedLoading} onLoadingChange={setMusicLoading} />
      <WrappedGamesSection userId={userId} forceLoading={wrappedLoading} onLoadingChange={setGameLoading} />
      <WrappedMoviesSection userId={userId} forceLoading={wrappedLoading} onLoadingChange={setMovieLoading} />

      {loading ? (
        <div className="space-y-4">
          <div className="bg-zinc-900/50 border border-zinc-800/35 rounded-2xl p-6 animate-pulse">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-zinc-800" />
              <div className="space-y-2 flex-1">
                <div className="w-32 h-5 bg-zinc-800 rounded" />
                <div className="w-48 h-3 bg-zinc-800 rounded" />
              </div>
            </div>
          </div>
        </div>
      ) : report ? (
        <>
          <AiReportCard
            tags={report.tags || []}
            onClick={() => router.push('/analysis/report')}
          />

          {report.report_data?.top_artists?.length > 0 && (
            <>
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 mt-8">나의 취향 요약</h3>
              <TasteSummary items={
                [
                  ...(report.report_data.top_artists?.slice(0, 1).map((a: any) => ({
                    label: '가장 많이 들은 아티스트',
                    title: a.name,
                    imageUrl: a.image_url,
                  })) || []),
                  ...(report.report_data.top_games?.slice(0, 1).map((g: any) => ({
                    label: '가장 많이 플레이한 게임',
                    title: `${g.name} · ${g.playtime_hours}h`,
                    imageUrl: g.image_url,
                  })) || []),
                  ...(report.report_data.top_movies?.slice(0, 1).map((m: any) => ({
                    label: '최고 평점 영화',
                    title: `${m.name} · ${m.rating}`,
                    imageUrl: m.image_url,
                  })) || []),
                ]
              } />
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
