/**
 * 브랜드 SVG 일러스트: 로그인 히어로 씬(집·공구·안전 배지), 빈 상태 스팟 일러스트,
 * 견적 카드의 프로 이니셜 아바타와 별점 렌더러. 외부 이미지 없이 인라인 SVG로 제공.
 */

export function HomeRepairScene({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 360 260" role="img" aria-label="A Charlotte home being repaired" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="18" y="196" width="324" height="8" rx="4" fill="#D8D2C2"/>
    <rect x="60" y="108" width="160" height="90" rx="6" fill="#FBFAF6" stroke="#173F35" strokeWidth="3"/>
    <path d="M48 112 140 44l92 68" stroke="#173F35" strokeWidth="3" fill="#F2C14E" strokeLinejoin="round"/>
    <rect x="124" y="150" width="34" height="48" rx="3" fill="#1D53D6"/>
    <circle cx="150" cy="174" r="2.4" fill="#FBFAF6"/>
    <rect x="76" y="128" width="34" height="30" rx="3" fill="#E4EAF9" stroke="#173F35" strokeWidth="3"/>
    <path d="M76 143h34M93 128v30" stroke="#173F35" strokeWidth="3"/>
    <rect x="170" y="128" width="34" height="30" rx="3" fill="#E4EAF9" stroke="#173F35" strokeWidth="3"/>
    <path d="M170 143h34M187 128v30" stroke="#173F35" strokeWidth="3"/>
    <path d="M238 158s22 22 22 37a22 22 0 1 1-44 0c0-15 22-37 22-37Z" fill="#BBD0F5" stroke="#173F35" strokeWidth="3" strokeLinejoin="round"/>
    <path d="M228 196a10 10 0 0 0 10 10" stroke="#173F35" strokeWidth="3" strokeLinecap="round"/>
    <g transform="translate(236 36)">
      <circle cx="44" cy="44" r="40" fill="#173F35"/>
      <path d="M56 30a14 14 0 0 0-19 19L19 67l9 9 18-18a14 14 0 0 0 19-19l-12 12-8-8 11-13Z" fill="#F2C14E"/>
    </g>
    <g transform="translate(30 30)">
      <path d="M22 2 8 8v10c0 9 6.4 15.6 14 18.4C29.6 33.6 36 27 36 18V8L22 2Z" fill="#FBFAF6" stroke="#173F35" strokeWidth="3" strokeLinejoin="round"/>
      <path d="m15.5 17.5 4.5 4.5 8.5-9" stroke="#0E7A50" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"/>
    </g>
    <path d="M310 96l4.6 9.4 10.4 1.5-7.5 7.3 1.8 10.3-9.3-4.9-9.3 4.9 1.8-10.3-7.5-7.3 10.4-1.5L310 96Z" fill="#F2C14E" stroke="#173F35" strokeWidth="2.6" strokeLinejoin="round"/>
    <circle cx="322" cy="170" r="7" fill="none" stroke="#173F35" strokeWidth="2.6"/>
    <path d="M322 163v-8M322 184v-7" stroke="#173F35" strokeWidth="2.6" strokeLinecap="round"/>
    <path d="M84 66c6-8 14-12 22-14M264 116c8 2 15 7 20 14" stroke="#B9B29E" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="1 7"/>
  </svg>;
}

export function ToolboxArt({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 120 96" role="img" aria-label="" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="14" y="34" width="92" height="48" rx="8" fill="var(--surface-2)" stroke="currentColor" strokeWidth="3"/>
    <path d="M14 50h92" stroke="currentColor" strokeWidth="3"/>
    <path d="M46 34v-8a6 6 0 0 1 6-6h16a6 6 0 0 1 6 6v8" stroke="currentColor" strokeWidth="3"/>
    <rect x="52" y="46" width="16" height="10" rx="3" fill="var(--accent-soft)" stroke="currentColor" strokeWidth="3"/>
    <path d="M30 66h14M76 66h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".5"/>
  </svg>;
}

export function ProviderAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
  return <span className={className ?? "pro-avatar"} aria-hidden="true">{initials}</span>;
}

export function Stars({ rating, className }: { rating?: number; className?: string }) {
  if (rating == null) return null;
  const full = Math.round(rating);
  return <span className={className ?? "stars"} role="img" aria-label={`Rated ${rating} out of 5`}>
    {[1, 2, 3, 4, 5].map((index) => <svg key={index} width="13" height="13" viewBox="0 0 24 24" fill={index <= full ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.7l-5.3 2.9 1-5.8-4.2-4.1 5.9-.9L12 3.5Z"/></svg>)}
  </span>;
}
