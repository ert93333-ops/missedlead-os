/** 인테이크 모델 호출 가능 여부와 쿼터 제한 사유만 확인한다. 키는 출력하지 않는다. */
import { GoogleGenAI } from "@google/genai";
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY is required");

const model = process.argv[2] ?? "gemini-2.5-flash";
try {
  const response = await new GoogleGenAI({ apiKey }).models.generateContent({ model, contents: "ping", config: { maxOutputTokens: 8 } });
  console.log("OK", model, (response.text ?? "").slice(0, 40));
} catch (error) {
  const detail = String((error as Error)?.message ?? error).replace(/[A-Za-z0-9_-]{25,}/g, "<redacted>");
  console.log("status", (error as { status?: number }).status, model);
  console.log(detail.slice(0, 1200));
}
