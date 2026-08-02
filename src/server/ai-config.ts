import type { ThinkingConfig } from '@google/genai';

// Shared across all AI routes so a future model/tuning change is made in one place instead of
// drifting across separately-hardcoded copies.
export const AI_MODEL = 'gemini-flash-latest';

// A small fixed budget rather than 0 — whatever model `gemini-flash-latest` currently resolves
// to rejects thinkingBudget: 0 with INVALID_ARGUMENT (confirmed live), so full disable isn't an
// option; -1 (automatic) was adding several seconds of internal "thinking" tokens per request for
// these structured extraction/lookup tasks. This is the smallest budget worth trying first.
export const AI_THINKING_CONFIG: ThinkingConfig = { thinkingBudget: 128 };

// Near-deterministic sampling for the structured-JSON extraction/edit/review routes — these
// aren't creative-writing tasks, consistency matters more than variety.
export const AI_EXTRACTION_TEMPERATURE = 0;
