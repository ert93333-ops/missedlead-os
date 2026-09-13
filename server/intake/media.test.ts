/**
 * media.ts 정제 파이프라인 테스트.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { sanitizeMediaBuffer } from "./media.js";

const runFile = promisify(execFile);
const probeSchema = z.object({
  chapters: z.array(z.unknown()),
  streams: z.array(z.object({ codec_type: z.string() })),
});

describe.each([
  { contentType: "video/mp4", extension: "mp4", codec: "libx264" },
  { contentType: "video/webm", extension: "webm", codec: "libvpx-vp9" },
])("$contentType sanitization", ({ contentType, extension, codec }) => {
  let directory: string | undefined;
  let source: Buffer | undefined;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "wecover-media-chapters-"));
    const metadata = join(directory, "chapters.txt");
    const input = join(directory, `input.${extension}`);
    await writeFile(metadata, [
      ";FFMETADATA1", "[CHAPTER]", "TIMEBASE=1/1000", "START=0", "END=1000",
      "title=synthetic-private-chapter", "",
    ].join("\n"));
    await runFile("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-f", "lavfi", "-i", "color=c=blue:s=96x96:d=1:r=5", "-i", metadata,
      "-map", "0:v:0", "-map_metadata", "1", "-map_chapters", "1",
      "-an", "-c:v", codec, "-threads", "1", "-pix_fmt", "yuv420p", input,
    ], { timeout: 30_000, windowsHide: true });
    const probe = await runFile("ffprobe", [
      "-v", "error", "-show_chapters", "-show_entries", "stream=codec_type", "-of", "json", input,
    ], { timeout: 10_000, windowsHide: true });
    expect(probeSchema.parse(JSON.parse(probe.stdout)).chapters).toHaveLength(1);
    source = await readFile(input);
  }, 60_000);

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("removes chapter data while preserving the playable video stream", async () => {
    if (!directory || !source) throw new Error("Media fixture was not created");
    const output = join(directory, `sanitized.${extension}`);

    const sanitized = await sanitizeMediaBuffer(source, contentType);
    await writeFile(output, sanitized);

    const probe = await runFile("ffprobe", [
      "-v", "error", "-show_chapters", "-show_entries", "stream=codec_type", "-of", "json", output,
    ], { timeout: 10_000, windowsHide: true });
    const result = probeSchema.parse(JSON.parse(probe.stdout));
    expect(result.chapters).toEqual([]);
    expect(result.streams).toEqual([{ codec_type: "video" }]);
    expect(probe.stderr).toBe("");
  }, 60_000);
});
