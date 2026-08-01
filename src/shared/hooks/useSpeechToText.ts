'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// The Web Speech API has no official TS DOM lib types — declare the minimal shape this hook
// actually uses rather than pull in a types package for one small feature.
interface SpeechRecognitionAlternativeLike {
 transcript: string;
}
interface SpeechRecognitionResultLike {
 readonly length: number;
 [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
 readonly length: number;
 [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
 results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionLike {
 lang: string;
 continuous: boolean;
 interimResults: boolean;
 start: () => void;
 stop: () => void;
 onresult: ((event: SpeechRecognitionEventLike) => void) | null;
 onerror: (() => void) | null;
 onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
 if (typeof window === 'undefined') return null;
 const w = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
 return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Browser-native speech-to-text (Chrome/Edge/Safari; unsupported in Firefox — callers should
// hide the mic affordance entirely when `isSupported` is false rather than show a dead button).
// One-shot per `start()` call (continuous: false) — the caller gets a single final transcript
// via `onResult`, same shape as if the user had typed it.
export function useSpeechToText(lang: string, onResult: (text: string) => void) {
 const [isListening, setIsListening] = useState(false);
 const [isSupported] = useState(() => getSpeechRecognitionConstructor() != null);
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
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
   const parts: string[] = [];
   for (let i = 0; i < event.results.length; i += 1) {
    parts.push(event.results[i][0].transcript);
   }
   onResultRef.current(parts.join(' ').trim());
  };
  recognition.onerror = () => setIsListening(false);
  recognition.onend = () => setIsListening(false);
  recognitionRef.current = recognition;
  recognition.start();
  setIsListening(true);
 }, [lang]);

 // Stop any in-flight recognition on unmount so it doesn't keep the mic open.
 useEffect(() => () => recognitionRef.current?.stop(), []);

 return { isSupported, isListening, start, stop };
}
