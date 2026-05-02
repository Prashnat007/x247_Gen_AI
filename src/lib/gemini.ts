import type { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is not set. AI features will be disabled.");
}

let aiPromise: Promise<GoogleGenAI> | null = null;

export async function getAI(): Promise<GoogleGenAI> {
  if (!aiPromise) {
    aiPromise = import("@google/genai").then(
      (m) => new m.GoogleGenAI({ apiKey: apiKey || "" }),
    );
  }
  return aiPromise;
}

export const ai = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    return new Proxy(() => {}, {
      get(_t2, p2) {
        return async (...args: unknown[]) => {
          const client = await getAI();
          const ns = (client as any)[prop as string];
          const fn = ns?.[p2 as string];
          if (typeof fn !== "function") {
            throw new TypeError(
              `@google/genai: ai.${String(prop)}.${String(p2)} is not a function`,
            );
          }
          return fn.apply(ns, args);
        };
      },
    });
  },
});
