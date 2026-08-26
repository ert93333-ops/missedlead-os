import { readFile } from 'node:fs/promises'
import dotenv from 'dotenv'
import { createGeminiAnalyzer } from '../server/multimodal'

dotenv.config({ path: '.env.local' })
const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')

const image = await readFile('src/assets/hero.png')
const analysis = await createGeminiAnalyzer(apiKey)(image, 'image/png', 'Test image used only to verify the multimodal evidence pipeline')
if (!Array.isArray(analysis.observations) || typeof analysis.safetyConcern !== 'boolean') {
  throw new Error('Gemini returned an invalid analysis')
}
console.log(`GEMINI_SMOKE_OK observations=${analysis.observations.length} causes=${analysis.possibleCauses.length} safety=${analysis.safetyConcern}`)
