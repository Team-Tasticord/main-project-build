'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

// (main) 인증 영역 전체의 라우트 에러 경계.
// 페이지/자식 렌더 중 throw가 나도 라우트가 죽지 않고 graceful 카드 + 다시 시도(reset).
export default function MainError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[main/error]', error);
  }, [error]);

  return (
    <div className="max-w-3xl mx-auto p-8 animate-fade-up">
      <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/35 rounded-2xl p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-400" />
        </div>
        <h2 className="text-lg font-bold mb-2">오류가 발생했어요</h2>
        <p className="text-sm text-zinc-500 mb-6">
          잠시 후 다시 시도해 주세요. 문제가 계속되면 새로고침해 주세요.
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-sm font-semibold transition"
        >
          <RotateCcw className="w-4 h-4" />
          다시 시도
        </button>
      </div>
    </div>
  );
}
