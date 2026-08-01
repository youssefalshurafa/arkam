import type { ThinkingConfig } from '@google/genai';

// Shared across all AI routes so a future model/tuning change is made in one place instead of
// drifting across separately-hardcoded copies.
export const AI_MODEL = 'gemini-flash-latest';

// -1 = automatic: let the model decide how much to think per-request, rather than a fixed
// per-route budget that would need separate tuning for each task.
export const AI_THINKING_CONFIG: ThinkingConfig = { thinkingBudget: -1 };

// Near-deterministic sampling for the structured-JSON extraction/edit/review routes — these
// aren't creative-writing tasks, consistency matters more than variety.
export const AI_EXTRACTION_TEMPERATURE = 0.2;
