import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const runFile = promisify(execFile);

export class MediaSanitizationError extends Error {
  readonly name = "MediaSanitizationError";
  constructor(readonly contentType: string, options?: ErrorOptions) {
    super("media could not be sanitized", options);
  }
}

const extensionFor = (contentType: string): string => ({
  "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
  "audio/mpeg": ".mp3", "audio/webm": ".webm", "audio/mp4": ".m4a",
  "audio/wav": ".wav", "audio/x-wav": ".wav",
})[contentType] ?? ".bin";

export const sanitizeMediaBuffer = async (buffer: Buffer, contentType: string): Promise<Buffer> => {
  try {
    if (contentType === "image/jpeg") return await sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer();
    if (contentType === "image/png") return await sharp(buffer).rotate().png().toBuffer();
    if (contentType === "image/webp") return await sharp(buffer).rotate().webp({ quality: 90 }).toBuffer();
  } catch (error) {
    throw new MediaSanitizationError(contentType, { cause: error });
  }

  const directory = await mkdtemp(join(tmpdir(), "wecover-intake-"));
  const extension = extensionFor(contentType);
  const input = join(directory, `input${extension}`);
  const output = join(directory, `sanitized${extension}`);
  const isVideo = contentType.startsWith("video/");
  const mapping = isVideo ? ["-map", "0:v:0", "-map", "0:a:0?"] : ["-map", "0:a:0", "-vn"];
  try {
    await writeFile(input, buffer, { flag: "wx" });
    const probe = await runFile("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input], { timeout: 10_000, windowsHide: true });
    const durationSeconds = Number(probe.stdout.trim());
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 60) throw new MediaSanitizationError(contentType);
    await runFile("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", input, ...mapping, "-sn", "-dn", "-map_metadata", "-1", "-map_metadata:s:v", "-1", "-map_metadata:s:a", "-1", "-map_chapters", "-1", "-c", "copy", output], { timeout: 30_000, windowsHide: true });
    return await readFile(output);
  } catch (error) {
    throw new MediaSanitizationError(contentType, { cause: error });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
