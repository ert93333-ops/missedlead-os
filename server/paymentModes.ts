import { verify } from "node:crypto";
import { z } from "zod";

export type PaymentMode = "disabled" | "drain" | "enabled";

const hashRecord = z.record(z.string().min(1), z.string().min(1)).refine(
  (value) => Object.keys(value).length > 0,
  "at least one capability hash is required",
);

const bindingSchema = z.object({
  environmentHash: z.string().min(1),
  projectHash: z.string().min(1),
  gitSha: z.string().min(1),
  migrationHead: z.string().min(1),
  capabilityHashes: hashRecord,
}).strict();

const receiptSchema = bindingSchema.extend({
  mode: z.literal("enabled"),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  keyId: z.string().min(1),
  signature: z.string().min(1),
}).strict();

export type PaymentApprovalBinding = z.infer<typeof bindingSchema>;
export type PaymentApprovalReceipt = z.infer<typeof receiptSchema>;

export interface PaymentApprovalValidation {
  receipt: unknown;
  expectedBinding: PaymentApprovalBinding;
  verifySignature: (receipt: PaymentApprovalReceipt) => boolean;
  now?: Date;
}

const canonicalReceiptPayload = (receipt: PaymentApprovalReceipt) => JSON.stringify({
  mode: receipt.mode,
  environmentHash: receipt.environmentHash,
  projectHash: receipt.projectHash,
  gitSha: receipt.gitSha,
  migrationHead: receipt.migrationHead,
  capabilityHashes: Object.fromEntries(Object.entries(receipt.capabilityHashes).sort(([left], [right]) => left.localeCompare(right))),
  issuedAt: receipt.issuedAt,
  expiresAt: receipt.expiresAt,
  keyId: receipt.keyId,
});

export function verifyPaymentApprovalSignature(receipt: PaymentApprovalReceipt, publicKey: string): boolean {
  try {
    return verify(null, Buffer.from(canonicalReceiptPayload(receipt)), publicKey, Buffer.from(receipt.signature, "base64"));
  } catch {
    return false;
  }
}

const bindingsMatch = (receipt: PaymentApprovalReceipt, expected: PaymentApprovalBinding) =>
  receipt.environmentHash === expected.environmentHash
  && receipt.projectHash === expected.projectHash
  && receipt.gitSha === expected.gitSha
  && receipt.migrationHead === expected.migrationHead
  && JSON.stringify(Object.entries(receipt.capabilityHashes).sort()) === JSON.stringify(Object.entries(expected.capabilityHashes).sort());

export function parsePaymentMode(rawMode: unknown, approval?: PaymentApprovalValidation): PaymentMode {
  if (rawMode === "drain") return "drain";
  if (rawMode !== "enabled" || !approval) return "disabled";

  const receipt = receiptSchema.safeParse(approval.receipt);
  const expected = bindingSchema.safeParse(approval.expectedBinding);
  if (!receipt.success || !expected.success || !bindingsMatch(receipt.data, expected.data)) return "disabled";

  const now = (approval.now ?? new Date()).getTime();
  const issuedAt = Date.parse(receipt.data.issuedAt);
  const expiresAt = Date.parse(receipt.data.expiresAt);
  if (issuedAt > now || expiresAt <= now) return "disabled";

  try {
    return approval.verifySignature(receipt.data) ? "enabled" : "disabled";
  } catch {
    return "disabled";
  }
}

export function paymentApprovalFromEnvironment(env: NodeJS.ProcessEnv, now = new Date()): PaymentApprovalValidation | undefined {
  const receiptText = env.PAYMENTS_APPROVAL_RECEIPT;
  const publicKey = env.PAYMENTS_APPROVAL_PUBLIC_KEY;
  const capabilityHashesText = env.PAYMENTS_CAPABILITY_HASHES;
  if (!receiptText || !publicKey || !capabilityHashesText) return undefined;

  try {
    const receipt: unknown = JSON.parse(receiptText);
    const capabilityHashes: unknown = JSON.parse(capabilityHashesText);
    const expectedBinding = bindingSchema.parse({
      environmentHash: env.PAYMENTS_ENVIRONMENT_HASH,
      projectHash: env.PAYMENTS_PROJECT_HASH,
      gitSha: env.GIT_SHA,
      migrationHead: env.MIGRATION_HEAD,
      capabilityHashes,
    });
    return { receipt, expectedBinding, now, verifySignature: (value) => verifyPaymentApprovalSignature(value, publicKey) };
  } catch {
    return undefined;
  }
}
