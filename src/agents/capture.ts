import { ai } from "../lib/gemini";
import { Type } from "@google/genai";
import { Memory } from "../types";

export const captureContent = async (content: string, type: Memory["source_type"]): Promise<Partial<Memory>> => {
  const prompt = `
    Analyze the following content and provide a structured summary.
    Content Type: ${type}
    Content: ${content}

    Extract:
    1. A concise title.
    2. A 2-3 sentence summary.
    3. 3-5 key takeaways.
    4. The general domain (e.g., Technology, Health, Business).
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          key_points: { type: Type.ARRAY, items: { type: Type.STRING } },
          domain: { type: Type.STRING }
        },
        required: ["title", "summary", "key_points", "domain"]
      }
    }
  });

  const data = JSON.parse(response.text || "{}");
  return {
    ...data,
    source_type: type,
    source_url: content.startsWith("http") ? content : undefined
  };
};
