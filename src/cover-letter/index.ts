export { generateCoverLetter } from "./generator";
export {
  generateAndSaveCoverLetter,
  escapeLatexBody,
  escapeLatexPlain,
} from "./saver";
export {
  buildCoverLetterPrompt,
  appendJudgeSection,
  COVER_LETTER_SYSTEM,
  COVER_PROMPT_SHA,
  SYSTEM_PROMPT,
  PROMPT_VERSION,
  extractTitleKeywords,
} from "./prompt";
export { loadResume, loadCanonicalResumeMaster, stripLatex } from "./resume";
export { complete } from "./client";
export type {
  CandidateContact,
  CandidateProfile,
  CoverLetterInput,
  CoverLetterJobInput,
  CoverLetterResult,
  CoverLetterConfig,
} from "./types";
