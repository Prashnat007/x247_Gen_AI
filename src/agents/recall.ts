import { ai } from "../lib/gemini";
import { Memory } from "../types";

export const recallKnowledge = async (query: string, memories: Memory[]): Promise<string> => {
  const context = memories.map(m => `
    Title: ${m.title}
    Summary: ${m.summary}
    Key Points: ${m.key_points.join(", ")}
    Tags: ${m.tags.join(", ")}
  `).join("\n---\n");

  const prompt = `
    You are RecallAgent, an expert at retrieving and synthesizing information from a user's Second Brain.
    
    User Query: ${query}
    
    Relevant Memories:
    ${context}
    
    Instructions:
    - Answer the user's question based ONLY on the provided memories.
    - If the answer is not in the memories, politely say you don't recall that specific information.
    - Be concise and helpful.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt
  });

  return response.text || "I'm sorry, I couldn't find any relevant information in your memories.";
};
