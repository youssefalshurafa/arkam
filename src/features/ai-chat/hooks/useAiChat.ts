'use client';

import { useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

export type AiChatMessage = { role: 'user' | 'model' | 'error'; text: string };

// Natural-language "ask your ledger a question" chat. The route is stateless — this hook holds
// the opaque conversation history the server hands back each turn and resends it with the next
// message; the history's actual shape is a Gemini-SDK detail this client never inspects.
export function useAiChat() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const [messages, setMessages] = useState<AiChatMessage[]>([]);
 const [isSending, setIsSending] = useState(false);
 const [history, setHistory] = useState<unknown[]>([]);
 const abortControllerRef = useRef<AbortController | null>(null);

 // Returns the model's reply text on success (so a voice-initiated question can be read back
 // aloud by the caller), or null on failure or user-initiated stop().
 async function sendMessage(text: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed || isSending) return null;
  setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
  setIsSending(true);
  const controller = new AbortController();
  abortControllerRef.current = controller;
  try {
   const response = await fetch('/api/ai/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language, message: trimmed, history }),
    signal: controller.signal,
   });
   const data = (await response.json().catch(() => null)) as { text?: string; history?: unknown[]; error?: string; detail?: string } | null;
   if (!response.ok || !data?.text) {
    // `detail` is temporary — the server route includes it while a live bug is being tracked
    // down, so it shows up here instead of requiring server-log access. Remove alongside it.
    const errorText = data?.detail ? `${t('ai_chat_error')} (${data.detail})` : t('ai_chat_error');
    setMessages((prev) => [...prev, { role: 'error', text: errorText }]);
    return null;
   }
   setMessages((prev) => [...prev, { role: 'model', text: data.text as string }]);
   setHistory(data.history ?? []);
   return data.text as string;
  } catch (error) {
   // A user-initiated stop() aborts the fetch — that's not a failure, so no error bubble.
   if (error instanceof DOMException && error.name === 'AbortError') return null;
   setMessages((prev) => [...prev, { role: 'error', text: t('ai_chat_error') }]);
   return null;
  } finally {
   setIsSending(false);
   abortControllerRef.current = null;
  }
 }

 function stop() {
  abortControllerRef.current?.abort();
 }

 function reset() {
  abortControllerRef.current?.abort();
  setMessages([]);
  setHistory([]);
 }

 return { messages, isSending, sendMessage, stop, reset };
}
