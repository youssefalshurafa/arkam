'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useStableSession } from '@/hooks/useStableSession';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useAiChat } from '@/features/ai-chat/hooks/useAiChat';
import { useSpeechToText } from '@/shared/hooks/useSpeechToText';

// Global "ask your ledger a question" launcher + slide-over panel. Self-contained (owns its own
// open/closed state) so it can be dropped into the page tree once and needs no prop-drilling
// through AppHeader. Gated on both the user's own opt-in toggle (aiSettings.enabled) and the
// admin-granted permission (session.user.aiEnabled) — same double gate as the other AI entry
// points, so a revoked user doesn't see a button that would just 403.
export default function AiChatPanel() {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);
 const { data: authSession } = useStableSession();
 const aiSettings = useSettingsStore((s) => s.aiSettings);
 const aiFeatureAccess = authSession?.user?.aiEnabled === true;
 const { messages, isSending, sendMessage, stop, reset } = useAiChat();
 const [isOpen, setIsOpen] = useState(false);
 const [input, setInput] = useState('');
 const listRef = useRef<HTMLDivElement | null>(null);

 useEffect(() => {
  listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
 }, [messages, isSending]);

 // Speech recognition (question by voice) and speech synthesis (answer read aloud, but only
 // for a question that was itself asked by voice — a typed question just gets a text reply).
 const speechLang = language === 'ar' ? 'ar-SA' : language === 'fr' ? 'fr-FR' : 'en-US';

 function speak(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = speechLang;
  window.speechSynthesis.speak(utterance);
 }

 useEffect(() => {
  return () => {
   if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  };
 }, []);

 async function handleSubmit(overrideText?: string, viaVoice = false) {
  const text = (overrideText ?? input).trim();
  if (!text) return;
  setInput('');
  const reply = await sendMessage(text);
  if (viaVoice && reply) speak(reply);
 }

 const { isSupported: isSpeechSupported, isListening, isUnsupportedEnv: isSpeechUnsupportedEnv, start: startListening, stop: stopListening } = useSpeechToText(speechLang, (transcript) => {
  if (!transcript) return;
  setInput(transcript);
  void handleSubmit(transcript, true);
 });

 if (!aiSettings.enabled || !aiFeatureAccess) return null;

 return (
  <>
   <button
    type="button"
    onClick={() => setIsOpen(true)}
    title={t('ai_chat_open')}
    aria-label={t('ai_chat_open')}
    className={`fixed bottom-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-blue-700 text-xl text-white shadow-lg transition hover:bg-blue-800 ${isRTL ? 'left-5' : 'right-5'}`}
   >
    ✨
   </button>

   {isOpen ? (
    <div
     className="fixed inset-0 z-50 flex justify-end bg-black/40"
     onClick={() => {
      window.speechSynthesis?.cancel();
      setIsOpen(false);
     }}
    >
     <div
      className={`flex h-full w-full max-w-sm flex-col bg-surface shadow-2xl ${isRTL ? 'order-first' : ''}`}
      onClick={(event) => event.stopPropagation()}
      dir={isRTL ? 'rtl' : 'ltr'}
     >
      <div className="flex items-center justify-between border-b border-border-strong px-4 py-3">
       <h3 className="text-sm font-semibold text-fg">{t('ai_chat_title')}</h3>
       <div className="flex items-center gap-1">
        <button
         type="button"
         onClick={() => reset()}
         title={t('ai_chat_reset')}
         aria-label={t('ai_chat_reset')}
         className="rounded p-1.5 text-fg-faint transition hover:bg-surface-hover hover:text-fg"
        >
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
         </svg>
        </button>
        <button
         type="button"
         onClick={() => {
          window.speechSynthesis?.cancel();
          setIsOpen(false);
         }}
         title={t('cancel')}
         aria-label={t('cancel')}
         className="rounded p-1.5 text-fg-faint transition hover:bg-surface-hover hover:text-fg"
        >
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
         </svg>
        </button>
       </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3">
       {messages.length === 0 ? <p className="text-sm text-fg-faint">{t('ai_chat_hint')}</p> : null}
       <div className="flex flex-col gap-3">
        {messages.map((msg, idx) => (
         <div
          key={idx}
          className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
           msg.role === 'user'
            ? `self-end bg-blue-700 text-white`
            : msg.role === 'error'
              ? 'self-start bg-bad-bg text-bad-text'
              : 'self-start bg-surface-2 text-fg'
          }`}
         >
          {msg.text}
         </div>
        ))}
        {isSending ? <div className="self-start rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-faint">{t('ai_chat_thinking')}</div> : null}
       </div>
      </div>

      <div className="border-t border-border-strong p-3">
       {isSpeechUnsupportedEnv ? <p className="mb-2 text-xs text-fg-faint">{t('ai_fill_voice_unsupported')}</p> : null}
       <div className="flex gap-2">
        <input
         type="text"
         value={input}
         onChange={(event) => setInput(event.target.value)}
         onKeyDown={(event) => {
          if (event.key === 'Enter') {
           event.preventDefault();
           void handleSubmit();
          }
         }}
         placeholder={t('ai_chat_placeholder')}
         disabled={isSending}
         className="min-w-0 flex-1 rounded border border-border-strong px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
        />
        {isSpeechSupported ? (
         <button
          type="button"
          title={isListening ? t('ai_fill_voice_listening') : t('ai_fill_voice_button')}
          aria-label={isListening ? t('ai_fill_voice_listening') : t('ai_fill_voice_button')}
          disabled={isSending}
          onClick={() => (isListening ? stopListening() : startListening())}
          className={`shrink-0 rounded border px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
           isListening ? 'animate-pulse border-red-500 bg-bad-bg text-bad-text' : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover'
          }`}
         >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
           <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
           <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
           <path d="M12 18v4M9 22h6" />
          </svg>
         </button>
        ) : null}
        {isSending ? (
         <button
          type="button"
          onClick={() => stop()}
          title={t('ai_stop')}
          aria-label={t('ai_stop')}
          className="shrink-0 rounded bg-bad-bg px-3 py-2 text-bad-text transition hover:opacity-80"
         >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
           <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
         </button>
        ) : (
         <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!input.trim()}
          className="shrink-0 rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
         >
          {t('ai_chat_send')}
         </button>
        )}
       </div>
      </div>
     </div>
    </div>
   ) : null}
  </>
 );
}
