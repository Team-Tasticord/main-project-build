import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { loadGameTabData } from './_data/game-tab';
import MyTasteClient from './MyTasteClient';

// 서버 컴포넌트: 게임 탭 1차 데이터를 서버에서 fetch해 이미 채워진 채로 내려보낸다.
// 상호작용(탭/토글/음악·영화 lazy)은 MyTasteClient 클라이언트 섬으로 분리.
export default function MyTastePage() {
  return (
    <Suspense fallback={<MyTasteSkeleton />}>
      <GameTabLoader />
    </Suspense>
  );
}

async function GameTabLoader() {
  const initialGame = await loadGameTabData();
  return <MyTasteClient initialGame={initialGame} />;
}

// 셸은 즉시 스트리밍되고, 게임 탭 1차 데이터를 기다리는 동안 스켈레톤 표시
function MyTasteSkeleton() {
  return (
    <div className="max-w-3xl mx-auto p-8 animate-fade-up">
      <h2 className="text-2xl font-bold mb-6">내 취향</h2>
      <div className="flex gap-2 mb-8">
        <span className="px-4 py-2 rounded-full text-sm font-medium bg-white text-black">게임</span>
        <span className="px-4 py-2 rounded-full text-sm font-medium bg-zinc-900/50 border border-zinc-800/35 text-zinc-400">음악</span>
        <span className="px-4 py-2 rounded-full text-sm font-medium bg-zinc-900/50 border border-zinc-800/35 text-zinc-400">영화/드라마</span>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-zinc-900/50 border border-zinc-800/35 rounded-xl p-4 h-[92px] animate-pulse" />
        ))}
      </div>
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
      </div>
    </div>
  );
}
