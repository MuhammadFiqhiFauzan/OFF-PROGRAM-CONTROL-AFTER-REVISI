/*
 * Tujuan: Type definitions untuk chatbot rule-based.
 * Caller: semua modul chatbot.
 * Dependensi: tidak ada (pure types).
 */

export interface ChatMessage {
  id: string;
  role: "user" | "bot";
  text: string;
  timestamp: number;
  links?: { label: string; href: string }[];
}

export interface FaqEntry {
  keywords: string[];
  question: string;
  answer: string;
  links?: { label: string; href: string }[];
  category: "opc" | "claim" | "payment" | "sales" | "form-kontrol" | "general" | "admin";
}

export interface DataCommand {
  patterns: RegExp[];
  description: string;
  handler: string;
}

export interface BotResponse {
  text: string;
  links?: { label: string; href: string }[];
}
