/**
 * assessmentToken HMAC 서명/검증. analyze 결과와 confirm 요청을 묶는 위변조 방지 토큰.
 * 만료·서명·소유자 불일치는 InvalidAssessmentTokenError.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { signedAssessmentSchema, signedTranslationSchema, type SignedAssessment, type SignedTranslation } from "./types.js";

export class InvalidAssessmentTokenError extends Error {
  readonly name = "InvalidAssessmentTokenError";
  constructor(readonly reason: "malformed" | "signature" | "expired" | "owner") {
    super("assessment token is invalid");
  }
}

const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");

export class AssessmentTokenSigner {
  constructor(private readonly secret: string) {
    if (Buffer.byteLength(secret, "utf8") < 32) throw new InvalidAssessmentTokenError("malformed");
  }

  sign(value: SignedAssessment): string {
    return this.signValue(value);
  }

  signTranslation(value: SignedTranslation): string {
    return this.signValue(value);
  }

  private signValue(value: SignedAssessment | SignedTranslation): string {
    const payload = encode(JSON.stringify(value));
    const signature = createHmac("sha256", this.secret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  verify(token: string, actorId: string, now: Date): SignedAssessment {
    const parsed = signedAssessmentSchema.safeParse(this.verifyValue(token));
    if (!parsed.success) throw new InvalidAssessmentTokenError("malformed");
    this.verifyClaims(parsed.data.actorId, parsed.data.expiresAt, actorId, now);
    return parsed.data;
  }

  verifyTranslation(token: string, actorId: string, now: Date): SignedTranslation {
    const parsed = signedTranslationSchema.safeParse(this.verifyValue(token));
    if (!parsed.success) throw new InvalidAssessmentTokenError("malformed");
    this.verifyClaims(parsed.data.actorId, parsed.data.expiresAt, actorId, now);
    return parsed.data;
  }

  private verifyValue(token: string): unknown {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) throw new InvalidAssessmentTokenError("malformed");
    const expected = createHmac("sha256", this.secret).update(payload).digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(signature, "base64url");
    } catch {
      throw new InvalidAssessmentTokenError("malformed");
    }
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new InvalidAssessmentTokenError("signature");
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new InvalidAssessmentTokenError("malformed");
    }
    return parsedJson;
  }

  private verifyClaims(tokenActorId: string, expiresAt: string, actorId: string, now: Date): void {
    if (tokenActorId !== actorId) throw new InvalidAssessmentTokenError("owner");
    if (new Date(expiresAt).getTime() <= now.getTime()) throw new InvalidAssessmentTokenError("expired");
  }
}
