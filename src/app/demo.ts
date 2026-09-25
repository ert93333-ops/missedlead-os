/**
 * 역할 테스트 버튼(데모 세션)의 오프라인 폴백 정책.
 * 데모 세션도 API를 먼저 호출하고, API 자체가 응답하지 못하거나 데모 토큰을
 * 거부할 때만 로컬 데모 화면으로 물러난다. 서버가 실제로 응답한 오류
 * (검증 실패, AI 제공자 장애 등)는 데모에서도 그대로 노출한다.
 */

/** auth.tsx의 demoSession()이 발급하는 시각 확인용 토큰 접두사. */
const DEMO_TOKEN_PREFIX = "demo.";

export const isDemoSession = (accessToken: string | null | undefined): boolean =>
  accessToken?.startsWith(DEMO_TOKEN_PREFIX) === true;

export class ApiFailure extends Error {
  status: number | undefined;
  /** JSON 본문을 가진 실제 API 응답인지(프록시·정적 호스트 오류와 구분). */
  structured: boolean;
  constructor(message: string, status?: number, structured = false) {
    super(message);
    this.name = "ApiFailure";
    this.status = status;
    this.structured = structured;
  }
}

/** JSON 본문이 없으면 API가 아닌 경로(프록시 오류, 정적 호스트)에서 온 응답으로 본다. */
export async function readApiBody<T>(response: Response): Promise<{ body: T; structured: boolean }> {
  try {
    return { body: await response.json() as T, structured: true };
  } catch {
    return { body: {} as T, structured: false };
  }
}

export function demoFallbackApplies(accessToken: string | null | undefined, error: unknown): boolean {
  if (!isDemoSession(accessToken)) return false;
  // 네트워크 실패나 타임아웃은 API에 닿지 못한 경우다.
  if (!(error instanceof ApiFailure)) return true;
  // 데모 토큰은 실제 세션이 아니므로 인증 거부는 백엔드 미연결과 같다.
  if (error.status === 401 || error.status === 403) return true;
  return !error.structured;
}

export const demoRequestId = (now = Date.now()) => `demo-request-${now}`;
export const isDemoRequestId = (requestId: string) => requestId.startsWith("demo-request-");
