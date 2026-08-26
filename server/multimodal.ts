import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'

const analysisSchema = z.object({
  observations: z.array(z.string().max(240)).max(8),
  possibleCauses: z.array(z.object({
    label: z.string().max(160),
    confidence: z.number().min(0).max(0.85),
    supportingEvidence: z.array(z.string().max(240)).max(6),
  })).max(5),
  missingEvidence: z.array(z.string().max(240)).max(8),
  safetyConcern: z.boolean(),
  safetyReason: z.string().max(300),
  provider: z.enum(['openai', 'gemini']).optional(),
})

const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['observations', 'possibleCauses', 'missingEvidence', 'safetyConcern', 'safetyReason'],
  properties: {
    observations: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 240 } },
    possibleCauses: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'confidence', 'supportingEvidence'],
        properties: {
          label: { type: 'string', maxLength: 160 },
          confidence: { type: 'number', minimum: 0, maximum: 0.85 },
          supportingEvidence: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 240 } },
        },
      },
    },
    missingEvidence: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 240 } },
    safetyConcern: { type: 'boolean' },
    safetyReason: { type: 'string', maxLength: 300 },
  },
} as const

export type MultimodalAnalysis = z.infer<typeof analysisSchema>

const reviewerPrompt = (customerSummary: string) => `You are a conservative pre-visit evidence reviewer for licensed plumbing and HVAC contractors. Customer summary: ${customerSummary}
Describe only visible facts. Rank possibilities, never diagnose conclusively, cap confidence at 0.85, identify missing evidence, and flag possible gas, fire, electrical, sewage, or active-flood hazards. Return JSON only with observations, possibleCauses[{label,confidence,supportingEvidence}], missingEvidence, safetyConcern, safetyReason.`

export function createMultimodalAnalyzer(apiKey: string) {
  const client = new OpenAI({ apiKey })

  return async function analyzeEvidence(buffer: Buffer, mediaType: string, customerSummary: string): Promise<MultimodalAnalysis> {
    if (!mediaType.startsWith('image/')) throw new Error('video_analysis_not_enabled')
    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: reviewerPrompt(customerSummary),
          },
          {
            type: 'input_image',
            image_url: `data:${mediaType};base64,${buffer.toString('base64')}`,
            detail: 'low',
          },
        ],
      }],
    })
    const parsed = JSON.parse(response.output_text.replace(/^```json\s*|\s*```$/g, '')) as unknown
    return analysisSchema.parse({ ...parsed as object, provider: 'openai' })
  }
}

export function createGeminiAnalyzer(apiKey: string, model = 'gemini-2.5-flash') {
  const client = new GoogleGenAI({ apiKey })

  return async function analyzeEvidence(buffer: Buffer, mediaType: string, customerSummary: string): Promise<MultimodalAnalysis> {
    if (!mediaType.startsWith('image/')) throw new Error('video_analysis_not_enabled')
    const request = () => client.models.generateContent({
        model,
        contents: [{
          role: 'user',
          parts: [
            { text: reviewerPrompt(customerSummary) },
            { inlineData: { mimeType: mediaType, data: buffer.toString('base64') } },
          ],
        }],
        config: { responseMimeType: 'application/json', responseJsonSchema: analysisJsonSchema },
      })
    let response
    try {
      response = await request()
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0
      if (status !== 429) throw error
      const message = error instanceof Error ? error.message : ''
      const retrySeconds = Math.min(15, Math.max(2, Number(message.match(/retry in ([0-9.]+)s/i)?.[1] ?? 2)))
      await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000))
      response = await request()
    }
    if (!response.text) throw new Error('empty_gemini_response')
    const parsed = JSON.parse(response.text) as unknown
    return analysisSchema.parse({ ...parsed as object, provider: 'gemini' })
  }
}

export function createFallbackAnalyzer(primary: MultimodalAnalyzer | undefined, fallback: MultimodalAnalyzer | undefined): MultimodalAnalyzer | undefined {
  if (!primary) return fallback
  if (!fallback) return primary
  return async (buffer, mediaType, summary) => {
    try {
      return await primary(buffer, mediaType, summary)
    } catch {
      return fallback(buffer, mediaType, summary)
    }
  }
}

export type MultimodalAnalyzer = ReturnType<typeof createMultimodalAnalyzer>
