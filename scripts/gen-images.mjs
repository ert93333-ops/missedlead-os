/**
 * 생성 이미지 에셋: OpenAI images API → 실패 시 Gemini 이미지 모델 순으로 시도.
 * 출력: public/img/*.png — 코드의 인라인 SVG 자리에 <img>로 참조한다.
 * 실행: node scripts/gen-images.mjs
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";

config({ path: [".env.local", ".env"], quiet: true, override: true });
const openaiKey = process.env.OPENAI_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

const brand = "Utility blue (#1D53D6) and warm amber (#F2C14E) accents on a clean neutral warm-gray palette, modern flat illustration style, trustworthy home-services brand, no text, no words, no letters";

const assets = [
  {
    file: "public/img/login-hero.png", w: 1024, h: 768,
    prompt: `Wide welcoming illustration for a home-repair app login screen: a charming two-story American suburban craftsman house in Charlotte North Carolina with a blue front door, a friendly repair van parked in the driveway, subtle wrench and safety-shield motifs floating as small badges, a large water droplet accent. ${brand}.`,
  },
  {
    file: "public/img/intake-scan.png", w: 1024, h: 576,
    prompt: `Photorealistic close-up photograph of a brushed stainless steel kitchen sink drain strainer with fresh water droplets beading on the metal, cool soft daylight, shallow depth of field, muted gray-blue tones, high detail, no text.`,
  },
  {
    file: "public/img/empty-state.png", w: 640, h: 512,
    prompt: `Minimal spot illustration of an open blue toolbox with a wrench, a screwdriver and a single water droplet, floating on an empty light warm-gray background with generous whitespace, soft shadows, flat modern style, no text.`,
  },
];

async function viaOpenAI(prompt) {
  if (!openaiKey) return null;
  for (const model of ["gpt-image-1", "dall-e-3"]) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024", ...(model === "gpt-image-1" ? {} : { response_format: "b64_json" }) }),
    });
    if (!res.ok) { console.log(`openai ${model}: ${res.status} ${(await res.text()).slice(0, 140)}`); continue; }
    const data = await res.json();
    const item = data.data?.[0];
    if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
    if (item?.url) { const img = await fetch(item.url); if (img.ok) return Buffer.from(await img.arrayBuffer()); }
  }
  return null;
}

async function viaGemini(prompt) {
  if (!geminiKey) return null;
  for (const model of ["gemini-2.5-flash-image-preview", "gemini-2.5-flash-image", "gemini-2.0-flash-exp-image-generation"]) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"] } }),
    });
    if (!res.ok) { console.log(`gemini ${model}: ${res.status} ${(await res.text()).slice(0, 140)}`); continue; }
    const data = await res.json();
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (part) return Buffer.from(part.inlineData.data, "base64");
    console.log(`gemini ${model}: no image part`);
  }
  return null;
}

async function viaPollinations(prompt, width, height) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&model=flux&seed=42`;
  const res = await fetch(url);
  if (!res.ok) { console.log(`pollinations: ${res.status}`); return null; }
  return Buffer.from(await res.arrayBuffer());
}

mkdirSync("public/img", { recursive: true });
let failures = 0;
for (const asset of assets) {
  const image = (await viaOpenAI(asset.prompt)) ?? (await viaGemini(asset.prompt)) ?? (await viaPollinations(asset.prompt, asset.w ?? 1024, asset.h ?? 640));
  if (!image) { console.error(`FAILED ${asset.file}`); failures++; continue; }
  writeFileSync(asset.file, image);
  console.log(`wrote ${asset.file} (${Math.round(image.length / 1024)} KB)`);
}
process.exitCode = failures ? 1 : 0;
