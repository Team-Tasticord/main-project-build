'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Heart, Activity, MessageCircle, Users, User } from 'lucide-react';
import { useUnreadCount } from '@/hooks/useUnreadCount';

const navItems = [
  { href: '/', label: '홈', icon: Home },
  { href: '/my-taste', label: '내 취향', icon: Heart },
  { href: '/analysis', label: '분석', icon: Activity },
  { href: '/messages', label: '메시지', icon: MessageCircle },
  { href: '/friends', label: '친구', icon: Users },
  { href: '/profile', label: '프로필', icon: User },
];

export default function MobileNav() {
  const pathname = usePathname();
  const unreadCount = useUnreadCount();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-zinc-950/80 backdrop-blur-xl border-t border-zinc-800/50 z-50">
      <div className="flex justify-around">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
          const showBadge = href === '/messages' && unreadCount > 0;

          return (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-col items-center justify-center gap-1 px-3 py-2 min-h-[56px] min-w-[44px] text-xs transition ${
                isActive ? 'text-white' : 'text-zinc-500'
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.5} />
              {label}
              {showBadge && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-purple-600 text-[9px] font-bold flex items-center justify-center text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
