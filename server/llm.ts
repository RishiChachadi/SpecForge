// The ONLY place that talks to an AI provider. Everything else calls generateJson().
// The key arrives per request from the browser. Never store it, log it or return it.
import type { Request } from "express";
import type { ZodType } from "zod";
import { ApiError } from "./envelope.js";

export type Provider = "gemini" | "openrouter" | "anthropic";
export type LlmConfig = { provider: Provider; key: string; model: string };

export const DEFAULT_MODELS = { gemini: "gemini-3.8-flash", openrouter: "google/gemini-2.5-flash", anthropic: "claude-sonnet-5-5" } as const;

export function configFromRequest(req: Request): LlmConfig {
  const provider = String(req.header("x-llm-provider") ?? "").toLowerCase();
  const key = String(req.header("x-llm-key") ?? "").trim();
  const model = String(req.header("x-llm-model") ?? "").trim();
  if (!key) throw new ApiError(400, "MISSING_KEY", "Add your key in Settings.");
  if (provider !== "gemini" && provider !== "openrouter" && provider !== "anthropic") throw new ApiError(400, "BAD_PROVIDER", "Choose gemini, openrouter or anthropic in Settings.");
  return { provider, key, model: model || DEFAULT_MODELS[provider as Provider] };
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

async function callProvider(prompt: string, cfg: LlmConfig): Promise<string> {
  if (cfg.provider === "gemini") {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    
    if (!res.ok) {
      const errText = await res.text();
      console.error("\n=== GEMINI API REJECTION ===");
      console.error(errText); 
      console.error("============================\n");
      throw new ApiError(401, "BAD_KEY", "The API rejected the request. Check your VS Code terminal for the exact reason.");
    }
    
    const data: any = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }
  
  if (cfg.provider === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": cfg.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: cfg.model, max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) throw new ApiError(502, "PROVIDER_ERROR", `The AI provider failed (HTTP ${r.status}). Check the model name.`);
    const j: any = await r.json();
    return (j?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  }
  
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } }),
  });
  if (!r.ok) throw new ApiError(502, "PROVIDER_ERROR", `The AI provider failed (HTTP ${r.status}). Check the model name.`);
  const j: any = await r.json();
  return j?.choices?.[0]?.message?.content ?? "";
}

export async function generateJson<T>(prompt: string, schema: ZodType<T>, cfg: LlmConfig): Promise<T> {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = attempt === 0 ? "" : `\n\nYour previous answer was invalid: ${last}. Reply with valid JSON only.`;
    const raw = await callProvider(prompt + "\n\nReply with JSON only, no commentary." + suffix, cfg);
    try {
      const parsed = schema.safeParse(JSON.parse(stripFences(raw)));
      if (parsed.success) return parsed.data;
      last = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch {
      last = "not parseable JSON";
    }
  }
  throw new ApiError(502, "BAD_AI_OUTPUT", "The AI did not return valid JSON. Try again or pick another model.");
}