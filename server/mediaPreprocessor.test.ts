import { writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { prepareMediaForAnalysis } from './mediaPreprocessor'

describe('media preprocessor', () => {
  it('passes supported images through unchanged', async () => {
    const bytes = Buffer.from('image')
    await expect(prepareMediaForAnalysis(bytes, 'image/jpeg')).resolves.toEqual({
      bytes, mediaType: 'image/jpeg', source: 'original_image',
    })
  })

  it('extracts a bounded video contact sheet without invoking a shell', async () => {
    const run = vi.fn(async (command: string, args: string[]) => {
      expect(command).toBe('ffmpeg')
      expect(args).toContain('fps=1/4,scale=640:-2:force_original_aspect_ratio=decrease,tile=3x1')
      await writeFile(args.at(-1)!, Buffer.from('jpeg-contact-sheet'))
    })
    const prepared = await prepareMediaForAnalysis(Buffer.from('video'), 'video/mp4', { run })
    expect(prepared).toMatchObject({ mediaType: 'image/jpeg', source: 'video_contact_sheet' })
    expect(prepared.bytes.toString()).toBe('jpeg-contact-sheet')
    expect(run).toHaveBeenCalledOnce()
  })

  it('fails closed for empty or unextractable videos', async () => {
    await expect(prepareMediaForAnalysis(Buffer.alloc(0), 'video/mp4')).rejects.toThrow('video_evidence_empty')
    await expect(prepareMediaForAnalysis(Buffer.from('bad'), 'video/mp4', {
      run: async () => { throw new Error('decoder failed') },
    })).rejects.toThrow('video_frame_extraction_failed')
  })
})
