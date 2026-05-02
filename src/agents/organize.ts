import { ai } from "../lib/gemini";
import { Type } from "@google/genai";
import { Memory } from "../types";

export const organizeMemory = async (memory: Partial<Memory>): Promise<string[]> => {
  const prompt = `
    Based on the following summary and title, generate 3-5 relevant tags for categorization.
    Title: ${memory.title}
    Summary: ${memory.summary}
    Domain: ${memory.domain}
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          tags: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["tags"]
      }
    }
  });

  const data = JSON.parse(response.text || "{}");
  return data.tags || [];
};
