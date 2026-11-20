import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    subject: { type: Type.STRING, description: "Course or subject name" },
    task: { type: Type.STRING, description: "Short, specific assignment title" },
    dueDate: { type: Type.STRING, description: "Due date as YYYY-MM-DD in Asia/Kolkata" },
    dueTime: { type: Type.STRING, description: "24-hour HH:mm time in IST; use 23:59 if no time is stated" },
    source: { type: Type.STRING, description: "One of WhatsApp, Email, College Portal, Classroom, PDF" },
    rawText: { type: Type.STRING, description: "Exact original message text" },
    subtasks: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Two or three practical next steps" },
  },
  required: ["subject", "task", "dueDate", "dueTime", "source", "rawText", "subtasks"],
};

function getIndiaClock() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "long", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    day: values.weekday,
    time: `${values.hour}:${values.minute}:${values.second}`,
  };
}

export async function POST(request: Request) {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "YOUR_KEY_HERE") {
    return NextResponse.json({ error: "Add your Google Gemini API key to .env.local, then restart the dev server." }, { status: 503 });
  }

  try {
    const body = await request.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const source = typeof body.source === "string" ? body.source : "WhatsApp";
    if (!text) return NextResponse.json({ error: "Paste a message or extract some text from a PDF first." }, { status: 400 });
    if (text.length > 16000) return NextResponse.json({ error: "Keep each message under 16,000 characters." }, { status: 413 });

    const clock = getIndiaClock();
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Current exact India date: ${clock.date} (${clock.day}); current IST time: ${clock.time}; timezone: Asia/Kolkata. Treat these as the anchor for relative words. Interpret English and Hinglish naturally: kal means tomorrow or yesterday according to the message context; next Friday means the next upcoming Friday. Do not invent a deadline when none is present; choose the most plausible stated due date. Use 23:59 when no time is stated. Keep rawText exact. Create 2–3 useful subtasks. Source supplied by the student: ${source}.\n\nMESSAGE:\n${text}`,
      config: {
        responseMimeType: "application/json",
        responseSchema,
        systemInstruction: "You extract college assignment deadlines for Indian students. Return only the schema-conforming JSON object. Dates and times must be interpreted in Asia/Kolkata. Preserve the original message verbatim in rawText. Never include Markdown fences.",
        temperature: 0.1,
      },
    });

    const parsed = JSON.parse(response.text ?? "{}");
    const dueTime = typeof parsed.dueTime === "string" && parsed.dueTime ? parsed.dueTime : "23:59";
    const dateIsValid = /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate) && !Number.isNaN(Date.parse(`${parsed.dueDate}T00:00:00Z`));
    const timeIsValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime);
    if (!parsed.subject || !parsed.task || !dateIsValid || !timeIsValid || !Array.isArray(parsed.subtasks)) {
      throw new Error("Gemini returned an incomplete deadline. Try rephrasing the message.");
    }
    return NextResponse.json({ ...parsed, source, rawText: text, dueTime, subtasks: parsed.subtasks.slice(0, 3) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deadline extraction failed.";
    console.error("Deadline extraction error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
