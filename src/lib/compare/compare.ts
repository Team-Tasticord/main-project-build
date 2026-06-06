// 두 사용자의 taste_profiles 스냅샷을 받아 축별 유사도를 계산 (순수 함수, 네트워크 없음)
// 유사도 = 자카드 계수(Jaccard): |교집합| / |합집합| × 100
// 이름은 정규화(trim+lowercase)해서 표기 흔들림을 흡수하되, 표시는 원본을 유지.
//
// 이미지 맵 (itemImages):
//   각 축의 items 에 대응되는 이미지 URL(Steam 커버 / Netflix 포스터)을 함께 반환한다.
//   key 는 commonItems / newFromFriend 에 들어가는 display 표기 그대로.
//   refresh 단계에서 normKey → URL 형태로 미리 만들어진 dict 을 입력으로 받는다.

export interface MusicTrack {
  name: string;
  artist: string;
  image?: string;
}

export interface TasteProfileData {
  music: { artists: string[]; genres: string[]; topTracks?: MusicTrack[] };
  // images: 정규화 키(normKey) → 표시용 이미지 URL
  games: { games: string[]; genres: string[]; images?: Record<string, string> };
  movies: { titles: string[]; genres: string[]; images?: Record<string, string> };
}

export interface AxisCompare {
  available: boolean; // 양쪽 모두 이 축에 데이터가 있어야 true
  score: number; // 0~100
  // 항목별 세부 (표시용 — 원본 표기 유지)
  itemsLabel: string; // "아티스트" | "게임" | "작품"
  commonItems: string[];
  commonGenres: string[];
  // 친구한테는 있는데 나한테 없는 것 (추천 후보)
  newFromFriend: string[];
  // 표시 이름 → 이미지 URL (있을 때만)
  itemImages?: Record<string, string>;
}

export interface CompareResult {
  overall: number; // 0~100 (사용 가능한 축들의 평균)
  music: AxisCompare;
  games: AxisCompare;
  movies: AxisCompare;
  // 친구가 최근에 가장 많이 들은 곡 (Spotify Top Tracks short_term)
  friendTopTracks?: MusicTrack[];
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

// 정규화 키 → 원본 표기 (먼저 등장한 표기 유지)
function toMap(items: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const it of items) {
    const k = norm(it);
    if (k && !m.has(k)) m.set(k, it.trim());
  }
  return m;
}

function jaccard(aKeys: Set<string>, bKeys: Set<string>): number {
  if (aKeys.size === 0 && bKeys.size === 0) return 0;
  let inter = 0;
  for (const k of aKeys) if (bKeys.has(k)) inter += 1;
  const union = aKeys.size + bKeys.size - inter;
  return union === 0 ? 0 : Math.round((inter / union) * 100);
}

// 한 축(아티스트/게임/작품 + 장르) 비교
function compareAxis(
  itemsLabel: string,
  mineItems: string[],
  friendItems: string[],
  mineGenres: string[],
  friendGenres: string[],
  itemWeight: number, // 아이템 vs 장르 가중치 (0~1). 나머지는 장르.
  mineImages?: Record<string, string>, // normKey → URL
  friendImages?: Record<string, string>
): AxisCompare {
  const mineHas = mineItems.length > 0 || mineGenres.length > 0;
  const friendHas = friendItems.length > 0 || friendGenres.length > 0;
  if (!mineHas || !friendHas) {
    return {
      available: false,
      score: 0,
      itemsLabel,
      commonItems: [],
      commonGenres: [],
      newFromFriend: [],
    };
  }

  const mineItemMap = toMap(mineItems);
  const friendItemMap = toMap(friendItems);
  const mineGenreMap = toMap(mineGenres);
  const friendGenreMap = toMap(friendGenres);

  const itemKeysA = new Set(mineItemMap.keys());
  const itemKeysB = new Set(friendItemMap.keys());
  const genreKeysA = new Set(mineGenreMap.keys());
  const genreKeysB = new Set(friendGenreMap.keys());

  const itemSim = jaccard(itemKeysA, itemKeysB);
  const genreSim = jaccard(genreKeysA, genreKeysB);

  // 한쪽 축만 데이터가 있으면 그쪽 100% 가중
  let score: number;
  const hasItems = itemKeysA.size > 0 && itemKeysB.size > 0;
  const hasGenres = genreKeysA.size > 0 && genreKeysB.size > 0;
  if (hasItems && hasGenres) score = Math.round(itemSim * itemWeight + genreSim * (1 - itemWeight));
  else if (hasItems) score = itemSim;
  else if (hasGenres) score = genreSim;
  else score = 0;

  const commonItems = [...itemKeysA]
    .filter((k) => itemKeysB.has(k))
    .map((k) => friendItemMap.get(k) ?? k);
  const commonGenres = [...genreKeysA]
    .filter((k) => genreKeysB.has(k))
    .map((k) => friendGenreMap.get(k) ?? k);
  const newFromFriend = [...itemKeysB]
    .filter((k) => !itemKeysA.has(k))
    .map((k) => friendItemMap.get(k) ?? k)
    .slice(0, 16);

  // itemImages 빌드: commonItems / newFromFriend 의 표시 이름 → URL
  // 우선순위: friend 의 이미지 > mine 의 이미지 (commonItems 의 display 가 friend 측이므로)
  let itemImages: Record<string, string> | undefined;
  if (mineImages || friendImages) {
    itemImages = {};
    for (const k of itemKeysA) {
      if (!itemKeysB.has(k)) continue;
      const display = friendItemMap.get(k) ?? k;
      const url = friendImages?.[k] ?? mineImages?.[k];
      if (url) itemImages[display] = url;
    }
    for (const k of itemKeysB) {
      if (itemKeysA.has(k)) continue;
      const display = friendItemMap.get(k) ?? k;
      const url = friendImages?.[k];
      if (url) itemImages[display] = url;
    }
    if (Object.keys(itemImages).length === 0) itemImages = undefined;
  }

  return {
    available: true,
    score,
    itemsLabel,
    commonItems,
    commonGenres,
    newFromFriend,
    itemImages,
  };
}

export function compareTasteProfiles(
  mine: TasteProfileData,
  friend: TasteProfileData
): CompareResult {
  const music = compareAxis(
    '아티스트',
    mine.music.artists,
    friend.music.artists,
    mine.music.genres,
    friend.music.genres,
    0.6
  );
  const games = compareAxis(
    '게임',
    mine.games.games,
    friend.games.games,
    mine.games.genres,
    friend.games.genres,
    0.6,
    mine.games.images,
    friend.games.images
  );
  const movies = compareAxis(
    '작품',
    mine.movies.titles,
    friend.movies.titles,
    mine.movies.genres,
    friend.movies.genres,
    0.5,
    mine.movies.images,
    friend.movies.images
  );

  const axes = [music, games, movies].filter((a) => a.available);
  const overall =
    axes.length > 0 ? Math.round(axes.reduce((s, a) => s + a.score, 0) / axes.length) : 0;

  const friendTopTracks = friend.music.topTracks?.slice(0, 3);

  return { overall, music, games, movies, friendTopTracks };
}
