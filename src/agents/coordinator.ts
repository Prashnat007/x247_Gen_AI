import { ai } from "../lib/gemini";
import { Type, FunctionDeclaration } from "@google/genai";
import { captureContent } from "./capture";
import { taskAgent } from "./task";
import { calendarAgent } from "./calendar";
import { recallKnowledge } from "./recall";
import { Memory } from "../types";

// Tool Definitions
const tools: { functionDeclarations: FunctionDeclaration[] }[] = [
  {
    functionDeclarations: [
      {
        name: "capture_content",
        description: "Capture and summarize content from a URL or text.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            content: { type: Type.STRING, description: "The URL or text to capture." },
            type: { type: Type.STRING, enum: ["youtube", "web", "pdf", "note"] }
          },
          required: ["content", "type"]
        }
      },
      {
        name: "create_task",
        description: "Create a new task in the task manager.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            priority: { type: Type.STRING, enum: ["low", "medium", "high"] },
            due_date: { type: Type.STRING }
          },
          required: ["title"]
        }
      },
      {
        name: "schedule_event",
        description: "Schedule a study session or event on the calendar.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            date: { type: Type.STRING },
            time: { type: Type.STRING },
            duration: { type: Type.NUMBER }
          },
          required: ["title", "date"]
        }
      },
      {
        name: "recall_knowledge",
        description: "Search and answer questions from saved memories.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: { type: Type.STRING }
          },
          required: ["query"]
        }
      }
    ]
  }
];

export const coordinateTask = async (
  message: string,
  userId: string,
  memories: Memory[],
  onProgress: (msg: string) => void
) => {
  const chat = ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: `You are the KnowledgeCoordinator for Recall X247. 
      You help users capture knowledge, manage tasks, and schedule sessions.
      You can perform MULTI-STEP workflows. If a user asks to capture something AND create a task, do both.
      Always use the provided tools.`,
      tools
    }
  });

  let response = await chat.sendMessage({ message });
  let finalOutput = "";

  // Handle Function Calls (Multi-step)
  while (response.functionCalls) {
    const toolResults: any[] = [];

    for (const call of response.functionCalls) {
      onProgress(`Executing: ${call.name}...`);
      
      let result;
      if (call.name === "capture_content") {
        result = await captureContent(call.args.content as string, call.args.type as any);
        const res = await fetch("/api/memories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...result, userId, created_at: new Date().toISOString() })
        });
        result = await res.json();
      } else if (call.name === "create_task") {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...call.args as any, userId, status: "todo" })
        });
        result = await res.json();
      } else if (call.name === "schedule_event") {
        const res = await fetch("/api/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...call.args as any, userId, gcal_event_id: `gcal_${Math.random().toString(36).substr(2, 9)}` })
        });
        result = await res.json();
      } else if (call.name === "recall_knowledge") {
        result = await recallKnowledge(call.args.query as string, memories);
      }

      toolResults.push({
        functionResponse: {
          name: call.name,
          response: { result }
        }
      });
    }

    response = await chat.sendMessage(toolResults as any);
  }

  return response.text;
};
