/**
 * 역할 스킨 토큰(고객/공급자/운영자 팔레트·타이포·밀도). 웹 styles.css의 모바일 포트.
 * styles/palette 프록시가 여기 토큰을 읽어 역할 전환 시 전 화면이 따라간다.
 */
// Role skins — mobile port of the web design system in src/styles.css.
// Same named palette: primer/graphite/utility/hivis/steel/signal.
export type SkinRole = 'customer' | 'provider' | 'operator';

export const font = {
  display: 'BarlowCondensed_700Bold',
  displaySemi: 'BarlowCondensed_600SemiBold',
  body: 'IBMPlexSans_400Regular',
  bodySemi: 'IBMPlexSans_600SemiBold',
  bodyBold: 'IBMPlexSans_700Bold',
  mono: 'IBMPlexMono_400Regular',
  monoMed: 'IBMPlexMono_500Medium',
} as const;

export type SkinTokens = {
  readonly background: string;
  readonly surface: string;
  readonly line: string;
  readonly text: string;
  readonly muted: string;
  readonly faint: string;
  readonly accent: string;
  readonly accentDeep: string;
  readonly accentSoft: string;
  readonly onAccent: string;
  readonly ok: string;
  readonly okSoft: string;
  readonly warn: string;
  readonly warnSoft: string;
  readonly danger: string;
  readonly dangerSoft: string;
  readonly gridLine: string;
  readonly shadow: string;
  readonly dark: boolean;
  readonly radius: number;
  readonly radiusSm: number;
  readonly pad: number;
  readonly controlMin: number;
  readonly inputMin: number;
  readonly iconMin: number;
  readonly actionFont: number;
  readonly actionWeight: '600' | '700';
};

const base = {
  customer: {
    background: '#F4F2EB',
    surface: '#FFFFFF',
    line: '#DDD9CC',
    text: '#22262B',
    muted: '#5B6270',
    faint: '#8A8F96',
    accent: '#1D53D6',
    accentDeep: '#15409F',
    accentSoft: '#E4EAF9',
    onAccent: '#FFFFFF',
    ok: '#147A4C',
    okSoft: '#DFEEE4',
    warn: '#8A5C0D',
    warnSoft: '#FAF0D7',
    danger: '#BE3A32',
    dangerSoft: '#F9E4E1',
    gridLine: 'rgba(34, 38, 43, 0.05)',
    shadow: '#1E242C',
    dark: false,
    radius: 16,
    radiusSm: 10,
    pad: 20,
    controlMin: 48,
    inputMin: 50,
    iconMin: 42,
    actionFont: 15,
    actionWeight: '600',
  },
  provider: {
    background: '#171A1E',
    surface: '#20252B',
    line: '#39414A',
    text: '#EEF1F4',
    muted: '#9BA7B2',
    faint: '#6E7A86',
    accent: '#F5A524',
    accentDeep: '#E08900',
    accentSoft: 'rgba(245, 165, 36, 0.16)',
    onAccent: '#1D1606',
    ok: '#4FC284',
    okSoft: 'rgba(79, 194, 132, 0.16)',
    warn: '#F2C14E',
    warnSoft: 'rgba(242, 193, 78, 0.15)',
    danger: '#F2705F',
    dangerSoft: 'rgba(242, 112, 95, 0.16)',
    gridLine: 'rgba(255, 255, 255, 0.045)',
    shadow: '#000000',
    dark: true,
    radius: 12,
    radiusSm: 8,
    pad: 20,
    controlMin: 50,
    inputMin: 52,
    iconMin: 46,
    actionFont: 16,
    actionWeight: '700',
  },
  operator: {
    background: '#E9ECEF',
    surface: '#FFFFFF',
    line: '#D3D9E0',
    text: '#22282F',
    muted: '#556270',
    faint: '#7A8794',
    accent: '#33526B',
    accentDeep: '#26405A',
    accentSoft: '#E2E8EE',
    onAccent: '#FFFFFF',
    ok: '#0E7A50',
    okSoft: '#DCEEE4',
    warn: '#86600B',
    warnSoft: '#F5EBD0',
    danger: '#A93028',
    dangerSoft: '#F7E1DE',
    gridLine: 'rgba(35, 42, 49, 0.05)',
    shadow: '#18202A',
    dark: false,
    radius: 6,
    radiusSm: 4,
    pad: 16,
    controlMin: 40,
    inputMin: 44,
    iconMin: 38,
    actionFont: 14,
    actionWeight: '600',
  },
} satisfies Record<SkinRole, SkinTokens>;

export const skin: Record<SkinRole, SkinTokens> = base;

let activeRole: SkinRole = 'customer';
export function setSkinRole(role: SkinRole) { activeRole = role; }
export function activeTokens(): SkinTokens { return skin[activeRole]; }
export function activeRoleName(): SkinRole { return activeRole; }
