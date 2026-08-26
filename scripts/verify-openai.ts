import { readFile } from 'node:fs/promises'
import dotenv from 'dotenv'
import { createMultimodalAnalyzer } from '../server/multimodal'

dotenv.config({ path: '.env.local' })
const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')

const image = await readFile('src/assets/hero.png')
const analysis = await createMultimodalAnalyzer(apiKey)(image, 'image/png', 'Test image used only to verify the multimodal evidence pipeline')

if (!Array.isArray(analysis.observations) || typeof analysis.safetyConcern !== 'boolean') {
  throw new Error('Multimodal provider returned an invalid analysis')
}
console.log(`MULTIMODAL_SMOKE_OK observations=${analysis.observations.length} causes=${analysis.possibleCauses.length} safety=${analysis.safetyConcern}`)
