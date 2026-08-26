import { readFile } from 'node:fs/promises'
import dotenv from 'dotenv'
import { createFallbackAnalyzer, createGeminiAnalyzer, createMultimodalAnalyzer } from '../server/multimodal'

dotenv.config({ path: '.env.local', quiet: true })
const openai = process.env.OPENAI_API_KEY ? createMultimodalAnalyzer(process.env.OPENAI_API_KEY) : undefined
const gemini = process.env.GEMINI_API_KEY ? createGeminiAnalyzer(process.env.GEMINI_API_KEY) : undefined
const analyzer = createFallbackAnalyzer(openai, gemini)
if (!analyzer) throw new Error('No multimodal provider configured')
const image = await readFile('src/assets/hero.png')
const result = await analyzer(image, 'image/png', 'Test image used only to verify provider fallback')
console.log(`FALLBACK_SMOKE_OK provider=${result.provider} observations=${result.observations.length}`)
