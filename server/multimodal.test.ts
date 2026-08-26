import { describe, expect, it, vi } from 'vitest'
import { createFallbackAnalyzer, type MultimodalAnalyzer } from './multimodal'

const result = {
  observations: ['Visible moisture'],
  possibleCauses: [],
  missingEvidence: [],
  safetyConcern: false,
  safetyReason: '',
  provider: 'gemini' as const,
}

describe('multimodal provider fallback', () => {
  it('uses the fallback when the primary provider has no quota', async () => {
    const primary = vi.fn<MultimodalAnalyzer>().mockRejectedValue(new Error('insufficient_quota'))
    const fallback = vi.fn<MultimodalAnalyzer>().mockResolvedValue(result)
    const analyzer = createFallbackAnalyzer(primary, fallback)

    await expect(analyzer!(Buffer.from('image'), 'image/png', 'leak')).resolves.toEqual(result)
    expect(primary).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('does not call fallback when primary succeeds', async () => {
    const primary = vi.fn<MultimodalAnalyzer>().mockResolvedValue({ ...result, provider: 'openai' })
    const fallback = vi.fn<MultimodalAnalyzer>()
    const analyzer = createFallbackAnalyzer(primary, fallback)

    await expect(analyzer!(Buffer.from('image'), 'image/png', 'leak')).resolves.toMatchObject({ provider: 'openai' })
    expect(fallback).not.toHaveBeenCalled()
  })
})
