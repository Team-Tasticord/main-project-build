'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Heart, Activity, MessageCircle, Users } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { useAuth } from '@/hooks/useAuth';
import { useUnreadCount } from '@/hooks/useUnreadCount';

const navItems = [
  { href: '/', label: '홈', icon: Home },
  { href: '/my-taste', label: '내 취향', icon: Heart },
  { href: '/analysis', label: '취향 분석', icon: Activity },
  { href: '/messages', label: '메시지', icon: MessageCircle },
  { href: '/friends', label: '친구', icon: Users },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { currentUser } = useAuth();
  const unreadTotal = useUnreadCount();

  return (
    <aside className="hidden md:flex w-[280px] border-r border-zinc-800/60 p-6 flex-col justify-between flex-shrink-0">
      <div>
        <Link href="/" className="text-3xl font-bold mb-12 block bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent px-2">
          Tasticord
        </Link>
        <nav className="space-y-1.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3.5 w-full px-4 py-3 rounded-xl text-[15px] transition-all ${
                  isActive
                    ? 'text-white font-semibold bg-zinc-800/60'
                    : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'
                }`}
              >
                <Icon className="w-[22px] h-[22px]" strokeWidth={isActive ? 2.2 : 1.8} />
                {label}
                {label === '메시지' && unreadTotal > 0 && (
                  <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-purple-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadTotal > 99 ? '99+' : unreadTotal}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
      <Link
        href="/profile"
        className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/35 rounded-xl p-3.5 flex items-center space-x-3 hover:bg-zinc-800/60 hover:border-zinc-700/50 transition-all"
      >
        <Avatar name={currentUser?.nickname || '나'} imageUrl={currentUser?.avatar_url} size="sm" />
        <div className="text-sm min-w-0">
          <p className="font-semibold truncate">{currentUser?.nickname || '내 프로필'}</p>
          <p className="text-xs text-zinc-500">프로필 보기</p>
        </div>
      </Link>
    </aside>
  );
}
