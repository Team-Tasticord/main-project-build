'use client';

// 친구 상세 페이지의 "취향 비교(Wrapped)" 섹션
// 데이터 출처: GET /api/friends/[userId]/compare → CompareResult
// 시각화: design_handoff_tasticord_wrapped 의 토큰/애니메이션을 React 로 포팅
//
// 데이터 한계 메모
// - taste_profiles 는 게임/영화 제목만 저장 → 게임은 Steam 커버 대신 타이포 포스터 폴백을 사용
// - 음악 장르는 freeform 텍스트 → 한국어/영문 alias 로 10개 표준 키에 매핑, 매칭 실패 시 'other'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CompareResult, AxisCompare, MusicTrack } from '@/lib/compare/compare';
import './TasteWrapped.css';

interface Props {
  friendId: string;
  friendName: string;
  friendAvatarUrl?: string | null;
  meName: string;
  meAvatarUrl?: string | null;
}

// ──────────────────────────────────────────────────────────────
// 장르 매핑 — freeform 텍스트 → 10개 표준 키
// ──────────────────────────────────────────────────────────────
type GenreKey =
  | 'indie' | 'kpop' | 'ballad' | 'hiphop' | 'rnb'
  | 'rock'  | 'edm'  | 'jazz'   | 'classical' | 'lofi'
  | 'other';

interface GenreMeta {
  label: string;
  c1: string;
  c2: string;
  anim: GenreKey;
}

// 매칭 순서 중요 — 더 구체적인 키(lofi)가 더 일반적인 키(rock 의 alt 등)보다 앞에 와야 안전
const GENRE_ALIASES: Array<[Exclude<GenreKey, 'other'>, string[]]> = [
  ['lofi',      ['lo-fi', 'lofi', '로파이', 'chill', '칠', 'ambient', '앰비언트']],
  ['kpop',      ['k-pop', 'kpop', 'k pop', '케이팝', '가요', 'korean pop']],
  ['hiphop',    ['hip hop', 'hip-hop', 'hiphop', 'rap', '힙합', '랩', 'trap', '트랩']],
  ['rnb',       ['r&b', 'rnb', 'r-n-b', 'rhythm and blues', 'soul', '소울', '알앤비', 'neo-soul']],
  ['edm',       ['edm', 'electronic', '일렉트로닉', 'dance', '댄스', 'house', 'techno', '테크노', 'trance', 'dnb', '드럼앤베이스']],
  ['classical', ['classical', '클래식', 'orchestra', '오케스트라', 'symphony', 'opera', '오페라']],
  ['jazz',      ['jazz', '재즈', 'bossa', '보사노바', 'swing', 'bebop']],
  ['ballad',    ['ballad', '발라드']],
  ['rock',      ['rock', 'metal', '메탈', 'punk', '펑크', 'alternative', '얼터너티브', '록', 'grunge']],
  ['indie',     ['indie', '인디']],
];

const GENRE_META: Record<GenreKey, GenreMeta> = {
  indie:     { label: '인디',       c1: '#2f5746', c2: '#1d3a2c', anim: 'indie' },
  kpop:      { label: 'K-Pop',      c1: '#ff3d80', c2: '#7c2dbf', anim: 'kpop' },
  ballad:    { label: '발라드',     c1: '#5a2a3a', c2: '#1f0d18', anim: 'ballad' },
  hiphop:    { label: '힙합',       c1: '#2a2418', c2: '#0e0c08', anim: 'hiphop' },
  rnb:       { label: 'R&B',        c1: '#3a2470', c2: '#160a36', anim: 'rnb' },
  rock:      { label: '록',         c1: '#4a0d12', c2: '#170406', anim: 'rock' },
  edm:       { label: '일렉트로닉', c1: '#0a2150', c2: '#070b22', anim: 'edm' },
  jazz:      { label: '재즈',       c1: '#3a2510', c2: '#160c04', anim: 'jazz' },
  classical: { label: '클래식',     c1: '#1f2a4a', c2: '#0a0f24', anim: 'classical' },
  lofi:      { label: 'Lo-fi',      c1: '#2a3d3d', c2: '#0f1a1a', anim: 'lofi' },
  other:     { label: '기타',       c1: '#3a3a52', c2: '#1a1a24', anim: 'lofi' },
};

function matchGenreKey(genre: string): GenreKey {
  const g = genre.toLowerCase().trim();
  if (!g) return 'other';
  for (const [key, aliases] of GENRE_ALIASES) {
    if (aliases.some((a) => g.includes(a))) return key;
  }
  return 'other';
}

// ──────────────────────────────────────────────────────────────
// 타이포 포스터용 색상 팔레트 / 태그 — 제목 해시로 결정
// ──────────────────────────────────────────────────────────────
const POSTER_PALETTES: Array<[string, string]> = [
  ['#4d5a3a', '#222a18'],
  ['#ff5c8a', '#7a1a3d'],
  ['#ffd84d', '#b8730a'],
  ['#2a3d6b', '#0a1426'],
  ['#e8b5b5', '#a55c5c'],
  ['#7a1a1a', '#2a0808'],
  ['#7c4dff', '#2a1844'],
  ['#ff9bba', '#9c3a64'],
  ['#a07cff', '#3a1a8c'],
  ['#2f3d52', '#0e1622'],
  ['#1a5a4a', '#0a2a22'],
  ['#5a2a3a', '#1f0d18'],
];

const GAME_TAGS = ['ACTION', 'RPG', 'INDIE', 'ADVENTURE', 'STRATEGY'];
const MOVIE_TAGS = ['DRAMA', 'FILM', 'VARIETY', 'MUSIC', 'LIVE'];

function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function paletteFor(title: string): [string, string] {
  return POSTER_PALETTES[strHash(title) % POSTER_PALETTES.length];
}
function gameTagFor(title: string): string {
  return GAME_TAGS[strHash(title) % GAME_TAGS.length];
}
function movieTagFor(title: string): string {
  return MOVIE_TAGS[strHash(title) % MOVIE_TAGS.length];
}

// ──────────────────────────────────────────────────────────────
// 장르 카드 (음악)
// ──────────────────────────────────────────────────────────────
function GenreCard({ keyName, label }: { keyName: GenreKey; label: string }) {
  const meta = GENRE_META[keyName];
  const style: CSSProperties = {
    // CSS 변수로 그라데이션 컬러 주입
    ['--tw-c1' as string]: meta.c1,
    ['--tw-c2' as string]: meta.c2,
  };
  return (
    <div className="tw-gcard" style={style}>
      <GenreAnim type={meta.anim} seedKey={label} />
      <h3>{label}</h3>
    </div>
  );
}

// 결정론적 시드 PRNG (mulberry32) — Math.random 대체
// React 순수성 규칙: 렌더 중에는 impure 함수 호출 금지 → 시드 기반으로 안정화
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 각 장르별 애니메이션 장식 (declarative — 시드 기반으로 값 안정화)
function GenreAnim({ type, seedKey }: { type: GenreKey; seedKey: string }) {
  const baseSeed = strHash(seedKey + type);

  // ⚠️ Hook 규칙: 분기보다 먼저 모든 useMemo 호출
  const lights = useMemo(() => {
    const rng = mulberry32(baseSeed + 1);
    const beams = Array.from({ length: 12 }, (_, i) => ({
      left: (i / 11) * 110 - 5,
      height: 70 + rng() * 60,
      r: -14 + rng() * 28,
      delay: rng() * 2.4,
      opacity: 0.25 + rng() * 0.55,
    }));
    const sparks = Array.from({ length: 7 }, () => ({
      left: rng() * 92 + 4,
      top: rng() * 78 + 6,
      delay: rng() * 2.8,
      scale: 0.5 + rng() * 0.8,
    }));
    return { beams, sparks };
  }, [baseSeed]);

  const candles = useMemo(() => {
    const rng = mulberry32(baseSeed + 2);
    return Array.from({ length: 6 }, (_, i) => ({
      left: 10 + i * 15 + rng() * 6,
      tx: -15 + rng() * 30,
      delay: rng() * 5,
      duration: 4 + rng() * 2,
    }));
  }, [baseSeed]);

  const eqBars = useMemo(() => {
    const rng = mulberry32(baseSeed + 3);
    return Array.from({ length: 12 }, () => ({
      delay: -rng(),
      duration: 0.8 + rng() * 0.6,
    }));
  }, [baseSeed]);

  const strings = useMemo(() => {
    const rng = mulberry32(baseSeed + 4);
    return [28, 44, 60, 76].map(() => ({
      delay: -rng() * 0.2,
      duration: 0.12 + rng() * 0.18,
    }));
  }, [baseSeed]);

  const smoke = useMemo(() => {
    const rng = mulberry32(baseSeed + 5);
    return Array.from({ length: 5 }, (_, i) => ({
      left: 15 + i * 16 + rng() * 6,
      tx: -20 + rng() * 60,
      delay: rng() * 7,
      duration: 6 + rng() * 3,
    }));
  }, [baseSeed]);

  const notes = useMemo(() => {
    const rng = mulberry32(baseSeed + 6);
    const glyphs = ['♪', '♫', '♩', '♬'];
    return Array.from({ length: 7 }, (_, i) => ({
      glyph: glyphs[i % glyphs.length],
      left: rng() * 88 + 4,
      fontSize: 14 + rng() * 10,
      rr: -25 + rng() * 50,
      delay: rng() * 6,
      duration: 5 + rng() * 3,
    }));
  }, [baseSeed]);

  const rain = useMemo(() => {
    const rng = mulberry32(baseSeed + 7);
    return Array.from({ length: 28 }, () => ({
      left: rng() * 100,
      delay: -rng() * 1.4,
      duration: 1 + rng() * 0.6,
      opacity: 0.3 + rng() * 0.6,
    }));
  }, [baseSeed]);

  if (type === 'indie') return <div className="tw-anim tw-anim-vinyl" />;

  if (type === 'kpop') {
    return (
      <div className="tw-anim tw-anim-lights">
        {lights.beams.map((b, i) => (
          <span
            key={`b${i}`}
            className="tw-beam"
            style={{
              left: `${b.left}%`,
              top: '-6px',
              height: `${b.height}px`,
              opacity: b.opacity,
              animationDelay: `${b.delay.toFixed(2)}s`,
              ['--tw-r' as string]: `${b.r}deg`,
            } as CSSProperties}
          />
        ))}
        {lights.sparks.map((s, i) => (
          <i
            key={`s${i}`}
            className="tw-spark"
            style={{
              left: `${s.left}%`,
              top: `${s.top}%`,
              animationDelay: `${s.delay.toFixed(2)}s`,
              transform: `scale(${s.scale.toFixed(2)})`,
            }}
          />
        ))}
      </div>
    );
  }

  if (type === 'ballad') {
    return (
      <div className="tw-anim tw-anim-candle">
        {candles.map((c, i) => (
          <i
            key={i}
            className="tw-flame"
            style={{
              left: `${c.left}%`,
              animationDelay: `${c.delay.toFixed(2)}s`,
              animationDuration: `${c.duration}s`,
              ['--tw-tx' as string]: `${c.tx}px`,
            } as CSSProperties}
          />
        ))}
      </div>
    );
  }

  if (type === 'hiphop') {
    return (
      <div className="tw-anim tw-anim-equalizer">
        <div className="tw-eq">
          {eqBars.map((b, i) => (
            <i
              key={i}
              style={{ animationDelay: `${b.delay.toFixed(2)}s`, animationDuration: `${b.duration}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (type === 'rnb') {
    return (
      <div className="tw-anim tw-anim-wave">
        <svg viewBox="0 0 400 100" preserveAspectRatio="none">
          <path className="tw-l1" d="M0,55 Q40,20 80,55 T160,55 T240,55 T320,55 T400,55 T480,55" />
          <path className="tw-l2" d="M0,60 Q50,90 100,60 T200,60 T300,60 T400,60 T500,60" />
        </svg>
      </div>
    );
  }

  if (type === 'rock') {
    return (
      <div className="tw-anim tw-anim-strings">
        {strings.map((s, i) => (
          <i
            key={i}
            className="tw-str"
            style={{
              top: `${[28, 44, 60, 76][i]}%`,
              animationDelay: `${s.delay.toFixed(2)}s`,
              animationDuration: `${s.duration}s`,
            }}
          />
        ))}
      </div>
    );
  }

  if (type === 'edm') {
    return (
      <div className="tw-anim tw-anim-laser">
        {[0, 0.8, 1.6].map((delay, i) => (
          <i key={i} className="tw-ring" style={{ animationDelay: `${delay}s` }} />
        ))}
      </div>
    );
  }

  if (type === 'jazz') {
    return (
      <div className="tw-anim tw-anim-smoke">
        {smoke.map((s, i) => (
          <i
            key={i}
            className="tw-puff"
            style={{
              left: `${s.left}%`,
              animationDelay: `${s.delay.toFixed(2)}s`,
              animationDuration: `${s.duration}s`,
              ['--tw-tx' as string]: `${s.tx}px`,
            } as CSSProperties}
          />
        ))}
      </div>
    );
  }

  if (type === 'classical') {
    return (
      <div className="tw-anim tw-anim-notes">
        {notes.map((n, i) => (
          <i
            key={i}
            className="tw-note"
            style={{
              left: `${n.left}%`,
              fontSize: `${n.fontSize}px`,
              animationDelay: `${n.delay.toFixed(2)}s`,
              animationDuration: `${n.duration}s`,
              ['--tw-rr' as string]: `${n.rr}deg`,
            } as CSSProperties}
          >
            {n.glyph}
          </i>
        ))}
      </div>
    );
  }

  // lofi 또는 other (기본 비)
  return (
    <div className="tw-anim tw-anim-rain">
      {rain.map((r, i) => (
        <i
          key={i}
          className="tw-drop"
          style={{
            left: `${r.left}%`,
            animationDelay: `${r.delay.toFixed(2)}s`,
            animationDuration: `${r.duration}s`,
            opacity: r.opacity.toFixed(2),
          }}
        />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 게임 / 영화 포스터
//   이미지 URL 이 있고 로드에 성공하면 실제 커버 / 포스터를 렌더하고,
//   없거나 onError 발생 시 타이포 포스터로 폴백한다.
// ──────────────────────────────────────────────────────────────
function GamePoster({ title, imageUrl }: { title: string; imageUrl?: string }) {
  const [broken, setBroken] = useState(false);

  if (imageUrl && !broken) {
    return (
      <div className="tw-gcover">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
        <div className="tw-scrim">
          <div className="tw-gtitle-cover">{title}</div>
        </div>
      </div>
    );
  }

  const [c1, c2] = paletteFor(title);
  const style: CSSProperties = {
    ['--tw-c1' as string]: c1,
    ['--tw-c2' as string]: c2,
  };
  return (
    <div className="tw-gposter" style={style}>
      <div className="tw-gtag">{gameTagFor(title)}</div>
      <div className="tw-gtitle">{title}</div>
    </div>
  );
}

function MoviePoster({ title, imageUrl }: { title: string; imageUrl?: string }) {
  const [broken, setBroken] = useState(false);

  if (imageUrl && !broken) {
    return (
      <div className="tw-mcover">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
        <div className="tw-scrim">
          <div className="tw-mtitle-cover">{title}</div>
        </div>
      </div>
    );
  }

  const [c1, c2] = paletteFor(title);
  const style: CSSProperties = {
    ['--tw-c1' as string]: c1,
    ['--tw-c2' as string]: c2,
  };
  return (
    <div className="tw-mposter" style={style}>
      <div className="tw-mtag">{movieTagFor(title)}</div>
      <div className="tw-mtitle">{title}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 아바타
// ──────────────────────────────────────────────────────────────
function Avatar({
  side,
  name,
  avatarUrl,
}: {
  side: 'me' | 'them';
  name: string;
  avatarUrl?: string | null;
}) {
  const initial = name.slice(0, 1) || (side === 'me' ? '나' : '친');
  return (
    <div className={`tw-avatar ${side === 'me' ? 'tw-me' : 'tw-them'}`}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} />
      ) : (
        initial
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Hero
// ──────────────────────────────────────────────────────────────
function Hero({
  overall,
  meName,
  meAvatarUrl,
  friendName,
  friendAvatarUrl,
}: {
  overall: number;
  meName: string;
  meAvatarUrl?: string | null;
  friendName: string;
  friendAvatarUrl?: string | null;
}) {
  // overall 점수대에 따라 헤드라인 문구를 바꾸되, 디자인의 "사이" 액센트 위치는 유지
  let line1 = '서로 새로운 걸';
  let line2pre = '알려줄 ';
  let accent = '사이';
  if (overall >= 70) {
    line1 = '거의 쌍둥이 같은';
    line2pre = '취향 ';
    accent = '동지';
  } else if (overall >= 40) {
    line1 = '겹치는 구석이';
    line2pre = '꽤 많은 ';
    accent = '사이';
  } else if (overall === 0) {
    line1 = '완전히 다른';
    line2pre = '세계를 사는 ';
    accent = '사이';
  }

  return (
    <section className="tw-hero">
      <div>
        <div className="tw-hero-eyebrow">취향 일치도</div>
        <h1>
          {line1}
          <br />
          {line2pre}
          <span className="tw-accent">{accent}</span>
        </h1>
      </div>
      <div className="tw-hero-right">
        <div className="tw-avatars">
          <Avatar side="me" name={meName} avatarUrl={meAvatarUrl} />
          <Avatar side="them" name={friendName} avatarUrl={friendAvatarUrl} />
        </div>
        <div className="tw-score-block">
          <div className="tw-score-num">{overall}%</div>
          <div className="tw-score-label">MATCH</div>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
// 섹션 헤더 (음악/게임/영화 공통)
// ──────────────────────────────────────────────────────────────
function SectionHead({
  axisType,
  title,
  pct,
}: {
  axisType: 'music' | 'games' | 'movies';
  title: string;
  pct: number;
}) {
  const stroke = axisType === 'music' ? '#1ed760' : axisType === 'games' ? '#3ec6ff' : '#ff5c6c';
  return (
    <>
      <div className="tw-section-head">
        <div className="tw-section-title">
          <div className="tw-ico">
            {axisType === 'music' && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            )}
            {axisType === 'games' && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="12" rx="4" />
                <path d="M7 12h4M9 10v4" />
                <circle cx="16" cy="12" r="1.2" fill={stroke} />
                <circle cx="18" cy="14" r="1.2" fill={stroke} />
              </svg>
            )}
            {axisType === 'movies' && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
              </svg>
            )}
          </div>
          <h2>{title}</h2>
        </div>
        <div className="tw-pct">
          {pct}
          <span className="tw-suffix">%</span>
        </div>
      </div>
      <div className="tw-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// 각 섹션
// ──────────────────────────────────────────────────────────────
function TrackCard({ track }: { track: MusicTrack }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="tw-track">
      {track.image && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={track.image}
          alt={track.name}
          className="tw-track-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="tw-track-cover" />
      )}
      <div className="tw-track-info">
        <div className="tw-track-name">{track.name}</div>
        <div className="tw-track-artist">{track.artist}</div>
      </div>
    </div>
  );
}

function MusicSection({
  axis,
  friendName,
  friendTopTracks,
}: {
  axis: AxisCompare;
  friendName: string;
  friendTopTracks?: MusicTrack[];
}) {
  // commonGenres → 표준 키로 매핑해서 large card 로 노출
  // 매칭 실패한(=other) 장르도 살리되 별도 키로 표시
  const cards = useMemo(() => {
    return axis.commonGenres.slice(0, 6).map((g) => ({
      key: matchGenreKey(g),
      label: g, // 원본 표기 유지
    }));
  }, [axis.commonGenres]);

  const tracks = friendTopTracks?.slice(0, 3) ?? [];

  return (
    <section className="tw-section tw-music">
      <SectionHead axisType="music" title="음악" pct={axis.available ? axis.score : 0} />

      {!axis.available ? (
        <div className="tw-unavailable">둘 중 한 명의 음악 데이터가 없어 비교할 수 없어요.</div>
      ) : (
        <>
          {cards.length > 0 ? (
            <>
              <div className="tw-label">
                공통 장르 <span className="tw-count">{cards.length}</span>
              </div>
              <div className="tw-genre-row">
                {cards.map((c, i) => (
                  <GenreCard key={`${c.key}-${i}`} keyName={c.key} label={c.label} />
                ))}
              </div>
            </>
          ) : (
            <div className="tw-empty">겹치는 장르가 없어요. 정반대 취향!</div>
          )}

          {axis.commonItems.length > 0 && (
            <>
              <div className="tw-label">
                공통 아티스트 <span className="tw-count">{axis.commonItems.length}</span>
              </div>
              <div className="tw-chips">
                {axis.commonItems.slice(0, 12).map((a) => (
                  <span key={a} className="tw-chip">{a}</span>
                ))}
              </div>
            </>
          )}

          {tracks.length > 0 && (
            <>
              <div className="tw-label">
                {friendName}님이 최근 가장 많이 들은 곡 <span className="tw-count">{tracks.length}</span>
              </div>
              <div className="tw-tracks">
                {tracks.map((t, i) => (
                  <TrackCard key={`${t.name}-${i}`} track={t} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function GamesSection({ axis, friendName }: { axis: AxisCompare; friendName: string }) {
  return (
    <section className="tw-section tw-games">
      <SectionHead axisType="games" title="게임" pct={axis.available ? axis.score : 0} />

      {!axis.available ? (
        <div className="tw-unavailable">둘 중 한 명의 게임 데이터가 없어 비교할 수 없어요.</div>
      ) : (
        <>
          {axis.commonItems.length > 0 && (
            <>
              <div className="tw-label">
                공통 게임 <span className="tw-count">{axis.commonItems.length}</span>
              </div>
              <div className="tw-game-row">
                {axis.commonItems.slice(0, 10).map((t) => (
                  <GamePoster key={t} title={t} imageUrl={axis.itemImages?.[t]} />
                ))}
              </div>
            </>
          )}

          {axis.commonGenres.length > 0 && (
            <>
              <div className="tw-label">
                공통 장르 <span className="tw-count">{axis.commonGenres.length}</span>
              </div>
              <div className="tw-chips">
                {axis.commonGenres.map((g) => (
                  <span key={g} className="tw-chip">{g}</span>
                ))}
              </div>
            </>
          )}

          {axis.newFromFriend.length > 0 && (
            <>
              <div className="tw-label">
                {friendName}님이 좋아하는 게임 <span className="tw-count">{axis.newFromFriend.length}</span>
              </div>
              <div className="tw-game-row tw-them">
                {axis.newFromFriend.slice(0, 16).map((t) => (
                  <GamePoster key={t} title={t} imageUrl={axis.itemImages?.[t]} />
                ))}
              </div>
            </>
          )}

          {axis.commonItems.length === 0 &&
            axis.commonGenres.length === 0 &&
            axis.newFromFriend.length === 0 && (
              <div className="tw-empty">겹치는 게임도, 새로 추천할 게임도 없어요.</div>
            )}
        </>
      )}
    </section>
  );
}

function MoviesSection({ axis, friendName }: { axis: AxisCompare; friendName: string }) {
  return (
    <section className="tw-section tw-movies">
      <SectionHead axisType="movies" title="영화 · 시리즈" pct={axis.available ? axis.score : 0} />

      {!axis.available ? (
        <div className="tw-unavailable">둘 중 한 명의 영화/시리즈 데이터가 없어 비교할 수 없어요.</div>
      ) : (
        <>
          {axis.commonItems.length > 0 && (
            <>
              <div className="tw-label">
                공통 작품 <span className="tw-count">{axis.commonItems.length}</span>
              </div>
              <div className="tw-movie-row">
                {axis.commonItems.slice(0, 8).map((t) => (
                  <MoviePoster key={t} title={t} imageUrl={axis.itemImages?.[t]} />
                ))}
              </div>
            </>
          )}

          {axis.commonGenres.length > 0 && (
            <>
              <div className="tw-label">
                공통 장르 <span className="tw-count">{axis.commonGenres.length}</span>
              </div>
              <div className="tw-chips">
                {axis.commonGenres.map((g) => (
                  <span key={g} className="tw-chip">{g}</span>
                ))}
              </div>
            </>
          )}

          {axis.newFromFriend.length > 0 && (
            <>
              <div className="tw-label">
                {friendName}님이 좋아하는 작품 <span className="tw-count">{axis.newFromFriend.length}</span>
              </div>
              <div className="tw-movie-row tw-them">
                {axis.newFromFriend.slice(0, 16).map((t) => (
                  <MoviePoster key={t} title={t} imageUrl={axis.itemImages?.[t]} />
                ))}
              </div>
            </>
          )}

          {axis.commonItems.length === 0 &&
            axis.commonGenres.length === 0 &&
            axis.newFromFriend.length === 0 && (
              <div className="tw-empty">겹치는 작품도, 새로 추천할 작품도 없어요.</div>
            )}
        </>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
// 최상위
// ──────────────────────────────────────────────────────────────
export default function TasteWrapped({
  friendId,
  friendName,
  friendAvatarUrl,
  meName,
  meAvatarUrl,
}: Props) {
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrMsg(null);
    try {
      const res = await fetch(`/api/friends/${friendId}/compare`);
      const json = await res.json();
      if (!res.ok) {
        setErrMsg(json.error ?? '비교 정보를 불러오지 못했어요');
        setResult(null);
        return;
      }
      setResult(json as CompareResult);
    } catch {
      setErrMsg('네트워크 오류로 불러오지 못했어요');
    } finally {
      setLoading(false);
    }
  }, [friendId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="tw-root">
        <div className="tw-section animate-pulse" style={{ height: 180 }} />
        <div className="tw-section animate-pulse" style={{ height: 280 }} />
        <div className="tw-section animate-pulse" style={{ height: 280 }} />
      </div>
    );
  }

  if (errMsg || !result) {
    return (
      <div className="tw-root">
        <div className="tw-section" style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--tw-ink-2)', fontSize: 14 }}>{errMsg ?? '비교 정보가 없어요'}</p>
          <button
            onClick={load}
            style={{
              marginTop: 12,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 12,
              background: 'rgba(255,255,255,.05)',
              border: '1px solid var(--tw-line)',
              color: 'var(--tw-ink-0)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <RefreshCw style={{ width: 14, height: 14 }} />
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tw-root">
      <Hero
        overall={result.overall}
        meName={meName}
        meAvatarUrl={meAvatarUrl}
        friendName={friendName}
        friendAvatarUrl={friendAvatarUrl}
      />
      <MusicSection
        axis={result.music}
        friendName={friendName}
        friendTopTracks={result.friendTopTracks}
      />
      <GamesSection axis={result.games} friendName={friendName} />
      <MoviesSection axis={result.movies} friendName={friendName} />
    </div>
  );
}
