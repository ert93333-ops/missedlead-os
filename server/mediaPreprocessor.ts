import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type PreparedMedia = {
  bytes: Buffer
  mediaType: string
  source: 'original_image' | 'video_contact_sheet'
}

type CommandRunner = (command: string, args: string[]) => Promise<void>

const defaultRunner: CommandRunner = async (command, args) => {
  await execFileAsync(command, args, { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 })
}

export async function prepareMediaForAnalysis(
  bytes: Buffer,
  mediaType: string,
  options: { ffmpegPath?: string; run?: CommandRunner } = {},
): Promise<PreparedMedia> {
  if (!mediaType.startsWith('video/')) return { bytes, mediaType, source: 'original_image' }
  if (bytes.length === 0) throw new Error('video_evidence_empty')

  const directory = await mkdtemp(join(tmpdir(), 'missedlead-video-'))
  const extension = mediaType === 'video/webm' ? '.webm' : extname(mediaType) || '.mp4'
  const inputPath = join(directory, `input${extension}`)
  const outputPath = join(directory, 'contact-sheet.jpg')
  try {
    await writeFile(inputPath, bytes)
    await (options.run ?? defaultRunner)(options.ffmpegPath ?? 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', inputPath,
      '-vf', 'fps=1/4,scale=640:-2:force_original_aspect_ratio=decrease,tile=3x1',
      '-frames:v', '1', '-q:v', '3', '-y', outputPath,
    ])
    const contactSheet = await readFile(outputPath)
    if (contactSheet.length === 0) throw new Error('video_frame_extraction_empty')
    return { bytes: contactSheet, mediaType: 'image/jpeg', source: 'video_contact_sheet' }
  } catch (error) {
    throw new Error('video_frame_extraction_failed', { cause: error })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
