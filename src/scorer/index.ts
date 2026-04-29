export { scoreJob, DEFAULT_WEIGHTS, DEFAULT_THRESHOLD } from "./score.js";
export { scoreSkills, scoreYOE, scoreSeniority, scoreLocation, scoreSemantic } from "./components.js";
export { embedText, embedJob, embedProfile, getEmbedder } from "./embed.js";
export type { ScoreResult, ScoreComponents, ScoringWeights, ScoringJobInput, ScoringProfileInput } from "./types.js";