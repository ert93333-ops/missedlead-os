import { publicMediaUrl } from './publicMedia.js';
import { createHash, randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Actor, Repository } from "../repository.js";
import { MediaSanitizationError, sanitizeMediaBuffer } from "./media.js";
import { AssessmentTokenSigner, InvalidAssessmentTokenError } from "./token.js";

const MAX_FILES = 10;
const MAX_FILE_BYTES = 25_000_000;
const MAX_TOTAL_BYTES = 50_000_000;
const SANITIZATION_TIMEOUT_MS = 30_000;
const BUCKET = "request-media-private";
const ACCEPTED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime",
  "audio/mpeg", "audio/webm", "audio/mp4", "audio/wav", "audio/x-wav",
]);

export type StoredIntakeMedia = {
  readonly id: string;
  readonly requestId: string;
  readonly ownerId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly objectPath: string;
  readonly sanitizationStatus: "sanitized";
  readonly exifRemovalStatus: "removed";
  readonly sourceRetention: "discarded_after_sanitization";
};

export type StoreIntakeMediaInput = Omit<StoredIntakeMedia, "sourceRetention"> & {
  readonly bytes: Buffer;
};

export type StoreIntakeMediaResult = {
  readonly record: StoredIntakeMedia;
  readonly created: boolean;
};

export interface IntakeMediaStore {
  assessmentId(requestId: string): Promise<string | null>;
  find(requestId: string, ownerId: string, checksums: readonly string[]): Promise<StoredIntakeMedia[]>;
  listSanitized(requestId: string): Promise<StoredIntakeMedia[]>;
  inventory(requestId: string): Promise<ReadonlyArray<{ ownerId: string; checksum: string }>>;
  signedReadUrl(objectPath: string, expiresInSeconds: number): Promise<string>;
  save(input: StoreIntakeMediaInput): Promise<StoreIntakeMediaResult>;
}

const dashboardSchema = z.object({
  requests: z.array(z.object({ id: z.string(), customerId: z.string() }).passthrough()),
}).passthrough();

const storedRowSchema = z.object({
  id: z.string(), request_id: z.string(), owner_id: z.string(), file_name: z.string(),
  content_type: z.string(), size_bytes: z.coerce.number(), checksum: z.string(), object_path: z.string(),
  upload_status: z.enum(["pending", "uploaded"]),
  sanitization_status: z.enum(["pending_scan", "sanitized", "rejected"]),
  exif_removal_status: z.enum(["pending", "removed", "failed"]),
});

const displayName = (name: string): string => {
  const cleaned = [...name.normalize("NFKC")]
    .map((character) => character === "/" || character === "\\" || character.codePointAt(0)! <= 31 || character.codePointAt(0) === 127 ? "_" : character)
    .join("").trim();
  return (cleaned || "attachment").slice(0, 120);
};

const extensionFor = (contentType: string): string => ({
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
  "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
  "audio/mpeg": ".mp3", "audio/webm": ".webm", "audio/mp4": ".m4a",
  "audio/wav": ".wav", "audio/x-wav": ".wav",
})[contentType] ?? ".bin";

const hasMagic = (bytes: Buffer, contentType: string): boolean => {
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (contentType === "video/webm") return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (contentType === "video/mp4" || contentType === "video/quicktime") return bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp";
  if (contentType === "audio/webm") return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (contentType === "audio/mp4") return bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp";
  if (contentType === "audio/wav" || contentType === "audio/x-wav") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
  if (contentType === "audio/mpeg") return bytes.length >= 3 && (bytes.toString("ascii", 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
  return false;
};

const asStored = (row: z.infer<typeof storedRowSchema>): StoredIntakeMedia => ({
  id: row.id, requestId: row.request_id, ownerId: row.owner_id, fileName: row.file_name,
  contentType: row.content_type, sizeBytes: row.size_bytes, checksum: row.checksum,
  objectPath: row.object_path, sanitizationStatus: "sanitized", exifRemovalStatus: "removed",
  sourceRetention: "discarded_after_sanitization",
});

export class SupabaseIntakeMediaStore implements IntakeMediaStore {
  private readonly client: SupabaseClient;
  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url.replace(/\/$/, ""), serviceRoleKey, { auth: { persistSession: false } });
  }

  async assessmentId(requestId: string) {
    const result = await this.client.from("service_requests").select("intake_assessment_id").eq("id", requestId).maybeSingle();
    if (result.error) throw result.error;
    return typeof result.data?.intake_assessment_id === "string" ? result.data.intake_assessment_id : null;
  }

  async find(requestId: string, ownerId: string, checksums: readonly string[]) {
    if (!checksums.length) return [];
    const result = await this.client.from("request_media").select("id,request_id,owner_id,file_name,content_type,size_bytes,checksum,object_path,upload_status,sanitization_status,exif_removal_status")
      .eq("request_id", requestId).eq("owner_id", ownerId).eq("upload_status", "uploaded")
      .eq("sanitization_status", "sanitized").eq("exif_removal_status", "removed").in("checksum", [...checksums]);
    if (result.error) throw result.error;
    return z.array(storedRowSchema).parse(result.data).map(asStored);
  }

  async listSanitized(requestId: string) {
    const result = await this.client.from("request_media")
      .select("id,request_id,owner_id,file_name,content_type,size_bytes,checksum,object_path,sanitized_object_path,upload_status,sanitization_status,exif_removal_status")
      .eq("request_id", requestId).eq("upload_status", "uploaded").eq("sanitization_status", "sanitized")
      .eq("exif_removal_status", "removed").not("sanitized_object_path", "is", null);
    if (result.error) throw result.error;
    return z.array(storedRowSchema.extend({ sanitized_object_path: z.string() })).parse(result.data)
      .map((row) => asStored({ ...row, object_path: row.sanitized_object_path }));
  }

  async signedReadUrl(objectPath: string, expiresInSeconds: number) {
    const result = await this.client.storage.from(BUCKET).createSignedUrl(objectPath, expiresInSeconds);
    if (result.error) throw result.error;
    return publicMediaUrl(result.data.signedUrl);
  }

  async inventory(requestId: string) {
    const result = await this.client.from("request_media").select("owner_id,checksum").eq("request_id", requestId);
    if (result.error) throw result.error;
    return z.array(z.object({ owner_id: z.string(), checksum: z.string() })).parse(result.data)
      .map((row) => ({ ownerId: row.owner_id, checksum: row.checksum }));
  }

  async save(input: StoreIntakeMediaInput) {
    const selected = "id,request_id,owner_id,file_name,content_type,size_bytes,checksum,object_path,upload_status,sanitization_status,exif_removal_status";
    const reserved = await this.client.rpc("reserve_intake_media", {
      p_id: input.id, p_request_id: input.requestId, p_owner_id: input.ownerId,
      p_file_name: input.fileName, p_content_type: input.contentType,
      p_size_bytes: input.sizeBytes, p_checksum: input.checksum, p_object_path: input.objectPath,
    });
    if (reserved.error) throw reserved.error;
    const row = storedRowSchema.parse(reserved.data);
    if (row.object_path !== input.objectPath || row.content_type !== input.contentType || row.size_bytes !== input.sizeBytes) {
      throw new Error("media_reservation_mismatch");
    }
    if (row.upload_status === "uploaded" && row.sanitization_status === "sanitized" && row.exif_removal_status === "removed") {
      return { record: asStored(row), created: false };
    }

    const upload = await this.client.storage.from(BUCKET).upload(row.object_path, input.bytes, {
      contentType: input.contentType, upsert: false, cacheControl: "3600",
    });
    if (upload.error) {
      const existingObject = await this.client.storage.from(BUCKET).download(row.object_path);
      if (existingObject.error) throw upload.error;
      const bytes = Buffer.from(await existingObject.data.arrayBuffer());
      if (createHash("sha256").update(bytes).digest("hex") !== input.checksum) throw upload.error;
    }

    const finalized = await this.client.from("request_media").update({
      upload_status: "uploaded", sanitization_status: "sanitized",
      exif_removal_status: "removed", sanitized_object_path: row.object_path,
    }).eq("id", row.id).eq("checksum", input.checksum).select(selected).single();
    if (finalized.error) throw finalized.error;
    return { record: asStored(storedRowSchema.parse(finalized.data)), created: true };
  }
}

export type InMemoryIntakeMediaRecord = Omit<StoredIntakeMedia, "sanitizationStatus" | "exifRemovalStatus"> & {
  readonly sanitizationStatus: "pending_scan" | "sanitized" | "rejected";
  readonly exifRemovalStatus: "pending" | "removed" | "failed";
  readonly uploaded: boolean;
};

export type InMemoryIntakeMediaFaults = {
  readonly afterReserve?: (input: StoreIntakeMediaInput) => void | Promise<void>;
  readonly afterUpload?: (input: StoreIntakeMediaInput) => void | Promise<void>;
  readonly beforeFinalize?: (input: StoreIntakeMediaInput) => void | Promise<void>;
};

export type InMemoryIntakeMediaInventory = {
  readonly records: InMemoryIntakeMediaRecord[];
  readonly objects: Set<string>;
};

const isSanitizedMemoryRecord = (record: InMemoryIntakeMediaRecord): record is InMemoryIntakeMediaRecord & StoredIntakeMedia =>
  record.uploaded && record.sanitizationStatus === "sanitized" && record.exifRemovalStatus === "removed";

export class InMemoryIntakeMediaStore implements IntakeMediaStore {
  readonly records: InMemoryIntakeMediaRecord[];
  readonly objects: Set<string>;
  constructor(
    private readonly assessments: Readonly<Record<string, string>> = {},
    seed: readonly InMemoryIntakeMediaRecord[] = [],
    private readonly faults: InMemoryIntakeMediaFaults = {},
    inventory?: InMemoryIntakeMediaInventory,
  ) {
    this.records = inventory?.records ?? [...seed];
    this.objects = inventory?.objects ?? new Set(seed.filter((record) => record.uploaded).map((record) => record.objectPath));
  }
  async assessmentId(requestId: string) { return this.assessments[requestId] ?? null; }
  async find(requestId: string, ownerId: string, checksums: readonly string[]) {
    const wanted = new Set(checksums);
    return this.records.filter(isSanitizedMemoryRecord).filter((record) => record.requestId === requestId && record.ownerId === ownerId && wanted.has(record.checksum));
  }
  async listSanitized(requestId: string) { return this.records.filter(isSanitizedMemoryRecord).filter((record) => record.requestId === requestId); }
  async signedReadUrl(objectPath: string, expiresInSeconds: number) {
    const record = this.records.find((item) => item.objectPath === objectPath);
    if (!record || !isSanitizedMemoryRecord(record)) throw new Error("sanitized_media_not_found");
    return `/api/test-private-media/${encodeURIComponent(record.id)}?expires=${expiresInSeconds}`;
  }
  async inventory(requestId: string) {
    return this.records.filter((record) => record.requestId === requestId)
      .map((record) => ({ ownerId: record.ownerId, checksum: record.checksum }));
  }
  async save(input: StoreIntakeMediaInput) {
    let reservation = this.records.find((record) =>
      record.requestId === input.requestId && record.ownerId === input.ownerId && record.checksum === input.checksum);
    if (reservation && isSanitizedMemoryRecord(reservation)) {
      const { uploaded: _uploaded, ...record } = reservation;
      const canonical: StoredIntakeMedia = { ...record, sanitizationStatus: "sanitized", exifRemovalStatus: "removed" };
      return { record: canonical, created: false };
    }
    if (!reservation) {
      const { bytes: _bytes, ...record } = input;
      reservation = {
        ...record, sourceRetention: "discarded_after_sanitization", uploaded: false,
        sanitizationStatus: "pending_scan", exifRemovalStatus: "pending",
      };
      this.records.push(reservation);
    }
    if (reservation.objectPath !== input.objectPath || reservation.contentType !== input.contentType || reservation.sizeBytes !== input.sizeBytes) {
      throw new Error("media_reservation_mismatch");
    }
    await this.faults.afterReserve?.(input);
    this.objects.add(reservation.objectPath);
    await this.faults.afterUpload?.(input);
    await this.faults.beforeFinalize?.(input);
    const index = this.records.findIndex((record) =>
      record.requestId === input.requestId && record.ownerId === input.ownerId && record.checksum === input.checksum);
    const finalized: InMemoryIntakeMediaRecord = {
      ...reservation, uploaded: true, sanitizationStatus: "sanitized", exifRemovalStatus: "removed",
    };
    this.records[index] = finalized;
    const { uploaded: _uploaded, ...stored } = finalized;
    const canonical: StoredIntakeMedia = { ...stored, sanitizationStatus: "sanitized", exifRemovalStatus: "removed" };
    return { record: canonical, created: true };
  }
}

const productionStore = (env: NodeJS.ProcessEnv): IntakeMediaStore => {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for intake media storage");
  return new SupabaseIntakeMediaStore(url, key);
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES, fields: 1, fieldSize: 20_000 },
  fileFilter: (_request, file, callback) => ACCEPTED_TYPES.has(file.mimetype) ? callback(null, true) : callback(new Error("unsupported_media_type")),
});

export type IntakeMediaRouteOptions = {
  readonly repository: Repository;
  readonly signingSecret: string | undefined;
  readonly now: () => Date;
  readonly store?: IntakeMediaStore;
  readonly sanitize?: (buffer: Buffer, contentType: string) => Promise<Buffer>;
  readonly sanitizationTimeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
};

const routeActor = (response: Response): Actor => response.locals.actor as Actor;
const parseUpload = (request: Request, response: Response, next: NextFunction): void => {
  upload.array("media", MAX_FILES)(request, response, (uploadError) => {
    if (uploadError instanceof multer.MulterError) {
      response.status(uploadError.code === "LIMIT_FILE_SIZE" || uploadError.code === "LIMIT_FILE_COUNT" ? 413 : 400).json({ error: "invalid_media_upload" });
      return;
    }
    if (uploadError) {
      response.status(400).json({ error: "invalid_media_upload" });
      return;
    }
    next();
  });
};

const withTimeout = async <T>(operation: Promise<T>, milliseconds: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new MediaSanitizationError("sanitization_timeout")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const registerIntakeMediaRoutes = (app: Express, options: IntakeMediaRouteOptions): void => {
  app.get("/api/requests/:requestId/intake-media", async (request, response) => {
    const actor = routeActor(response);
    const requestId = String(request.params.requestId);
    const accessToken = request.header("Authorization")?.slice(7) ?? "";
    const dashboard = dashboardSchema.safeParse(await options.repository.dashboard(actor, accessToken));
    if (!dashboard.success || !dashboard.data.requests.some((item) => item.id === requestId)) {
      return response.status(403).json({ error: "request_access_required" });
    }
    const store = options.store ?? productionStore(options.env ?? process.env);
    const records = await store.listSanitized(requestId);
    const media = await Promise.all(records.map(async (record) => ({
      id: record.id,
      fileName: record.fileName,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
      url: await store.signedReadUrl(record.objectPath, 60),
      expiresInSeconds: 60,
    })));
    return response.json({ media });
  });

  app.post("/api/requests/:requestId/intake-media", parseUpload, async (request, response) => {
      const actor = routeActor(response);
      if (actor.role !== "customer") return response.status(403).json({ error: "customer_required" });
      const files = (request.files ?? []) as Express.Multer.File[];
      const assessmentToken = typeof request.body?.assessmentToken === "string" ? request.body.assessmentToken : "";
      if (!files.length || !assessmentToken || !options.signingSecret) return response.status(400).json({ error: "invalid_media_upload" });
      if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) return response.status(413).json({ error: "media_total_too_large" });

      let signed;
      try {
        signed = new AssessmentTokenSigner(options.signingSecret).verify(assessmentToken, actor.id, options.now());
      } catch (error) {
        if (error instanceof InvalidAssessmentTokenError) return response.status(error.reason === "owner" ? 403 : 401).json({ error: "invalid_assessment_token" });
        throw error;
      }
      if (files.length !== signed.attachmentDigests.length || files.length !== signed.attachmentTypes.length || files.length !== signed.attachmentNames.length) {
        return response.status(409).json({ error: "media_context_changed" });
      }
      const requestId = String(request.params.requestId);
      const accessToken = request.header("Authorization")?.slice(7) ?? "";
      const dashboard = dashboardSchema.safeParse(await options.repository.dashboard(actor, accessToken));
      if (!dashboard.success || !dashboard.data.requests.some((item) => item.id === requestId && item.customerId === actor.id)) {
        return response.status(403).json({ error: "request_owner_required" });
      }
      const store = options.store ?? productionStore(options.env ?? process.env);
      if (await store.assessmentId(requestId) !== signed.assessmentId) return response.status(409).json({ error: "assessment_request_mismatch" });

      const sanitize = options.sanitize ?? sanitizeMediaBuffer;
      const sanitized: Array<{ file: Express.Multer.File; bytes: Buffer; checksum: string }> = [];
      try {
        for (const [index, file] of files.entries()) {
          if (!ACCEPTED_TYPES.has(file.mimetype) || !hasMagic(file.buffer, file.mimetype) || file.originalname !== signed.attachmentNames[index] || file.mimetype !== signed.attachmentTypes[index]) {
            return response.status(409).json({ error: "media_context_changed" });
          }
          const sourceChecksum = createHash("sha256").update(file.buffer).digest("hex");
          if (sourceChecksum !== signed.attachmentDigests[index]) return response.status(409).json({ error: "media_context_changed" });
          const bytes = await withTimeout(sanitize(file.buffer, file.mimetype), options.sanitizationTimeoutMs ?? SANITIZATION_TIMEOUT_MS);
          const checksum = createHash("sha256").update(bytes).digest("hex");
          if (!hasMagic(bytes, file.mimetype)) return response.status(422).json({ error: "media_sanitization_failed" });
          sanitized.push({ file, bytes, checksum });
        }
      } catch {
        return response.status(422).json({ error: "media_sanitization_failed" });
      }

      const existing = await store.find(requestId, actor.id, sanitized.map((item) => item.checksum));
      const existingByChecksum = new Map(existing.map((item) => [item.checksum, item]));
      const pendingChecksums = new Set(sanitized.filter((item) => !existingByChecksum.has(item.checksum)).map((item) => item.checksum));
      const inventoryKeys = new Set((await store.inventory(requestId)).map((record) => `${record.ownerId}:${record.checksum}`));
      sanitized.forEach((item) => inventoryKeys.add(`${actor.id}:${item.checksum}`));
      if (inventoryKeys.size > MAX_FILES) return response.status(409).json({ error: "media_limit_exceeded" });

      const saved: StoredIntakeMedia[] = [];
      try {
        for (const item of sanitized) {
          const prior = existingByChecksum.get(item.checksum);
          if (prior) { saved.push(prior); continue; }
          const id = randomUUID();
          const objectPath = `${actor.id}/${requestId}/intake/${item.checksum}${extensionFor(item.file.mimetype)}`;
          const result = await store.save({ id, requestId, ownerId: actor.id, fileName: displayName(item.file.originalname), contentType: item.file.mimetype, sizeBytes: item.bytes.length, checksum: item.checksum, objectPath, sanitizationStatus: "sanitized", exifRemovalStatus: "removed", bytes: item.bytes });
          const record = result.record;
          await store.signedReadUrl(record.objectPath, 60);
          existingByChecksum.set(item.checksum, record);
          saved.push(record);
        }
      } catch {
        return response.status(503).json({ error: "media_storage_failed" });
      }
    return response.status(pendingChecksums.size ? 201 : 200).json({ media: saved });
  });
};
