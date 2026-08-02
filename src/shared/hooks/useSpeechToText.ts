'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// The Web Speech API has no official TS DOM lib types — declare the minimal shape this hook
// actually uses rather than pull in a types package for one small feature.
interface SpeechRecognitionAlternativeLike {
 transcript: string;
}
interface SpeechRecognitionResultLike {
 readonly length: number;
 readonly isFinal: boolean;
 [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
 readonly length: number;
 [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
 results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike {
 error: string;
 message?: string;
}
interface SpeechRecognitionLike {
 lang: string;
 continuous: boolean;
 interimResults: boolean;
 start: () => void;
 stop: () => void;
 onresult: ((event: SpeechRecognitionEventLike) => void) | null;
 onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
 onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
 if (typeof window === 'undefined') return null;
 const w = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
 return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// How long to wait, with no new speech detected, before auto-stopping and delivering the
// transcript — short enough to feel automatic, long enough not to cut off mid-sentence pauses.
const SILENCE_AUTOSTOP_MS = 1800;
// Grace period after start() for the user to begin speaking at all, before giving up. Generous
// on purpose — see the continuous:true note below for why the browser's own default is too short.
const NO_SPEECH_TIMEOUT_MS = 8000;

// Browser-native speech-to-text (Chrome/Edge/Safari; unsupported in Firefox — callers should
// hide the mic affordance entirely when `isSupported` is false rather than show a dead button).
// Stays listening until speech goes quiet for a bit (or the caller calls `stop()` early);
// `onResult` fires once per session with the full transcript, same shape as if typed.
export function useSpeechToText(lang: string, onResult: (text: string) => void) {
 const [isListening, setIsListening] = useState(false);
 const [isSupported] = useState(() => getSpeechRecognitionConstructor() != null);
 // 'network' fires immediately (no permission prompt, no listening window) on browsers whose
 // SpeechRecognition backend is a no-op — e.g. Brave, which ships without the Google API keys
 // Chromium normally uses for this, unlike Chrome/Edge. Surfaced so callers can explain the dead
 // mic button instead of leaving the user staring at silence.
 const [isUnsupportedEnv, setIsUnsupportedEnv] = useState(false);
 const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
 const onResultRef = useRef(onResult);
 useEffect(() => {
  onResultRef.current = onResult;
 }, [onResult]);

 const stop = useCallback(() => {
  recognitionRef.current?.stop();
 }, []);

 const start = useCallback(() => {
  const Ctor = getSpeechRecognitionConstructor();
  if (!Ctor) return;
  recognitionRef.current?.stop();
  setIsUnsupportedEnv(false);
  const recognition = new Ctor();
  recognition.lang = lang;
  // continuous: true — with `false`, desktop Chrome/Edge's silence-endpointing is much more
  // aggressive than mobile's and can end the session before the user starts speaking. We take
  // over ending the session ourselves (see silenceTimer below) instead of trusting the browser's
  // built-in endpointing, which is either too fast (continuous: false) or doesn't fire at all
  // until a long real silence (continuous: true with no manual timer).
  recognition.interimResults = true;
  recognition.continuous = true;
  let finalTranscript = '';
  let interimTranscript = '';
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleAutoStop = (delayMs: number) => {
   if (silenceTimer) clearTimeout(silenceTimer);
   silenceTimer = setTimeout(() => recognition.stop(), delayMs);
  };
  scheduleAutoStop(NO_SPEECH_TIMEOUT_MS);
  recognition.onresult = (event) => {
   let combinedFinal = '';
   let combinedInterim = '';
   for (let i = 0; i < event.results.length; i += 1) {
    const result = event.results[i];
    if (result.isFinal) combinedFinal += `${combinedFinal ? ' ' : ''}${result[0].transcript}`;
    else combinedInterim += `${combinedInterim ? ' ' : ''}${result[0].transcript}`;
   }
   finalTranscript = combinedFinal.trim();
   interimTranscript = combinedInterim.trim();
   // Speech (even interim, not-yet-finalized) is still coming in — push the auto-stop back out.
   scheduleAutoStop(SILENCE_AUTOSTOP_MS);
  };
  recognition.onerror = (event) => {
   if (event.error === 'network') setIsUnsupportedEnv(true);
   if (silenceTimer) clearTimeout(silenceTimer);
   setIsListening(false);
  };
  recognition.onend = () => {
   if (silenceTimer) clearTimeout(silenceTimer);
   setIsListening(false);
   const transcript = finalTranscript || interimTranscript;
   if (transcript) onResultRef.current(transcript);
  };
  recognitionRef.current = recognition;
  recognition.start();
  setIsListening(true);
 }, [lang]);

 // Stop any in-flight recognition on unmount so it doesn't keep the mic open.
 useEffect(() => () => recognitionRef.current?.stop(), []);

 return { isSupported, isListening, isUnsupportedEnv, start, stop };
}
