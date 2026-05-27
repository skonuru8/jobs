const MONTH =
  /(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)/i;
const YEAR = /(?:19|20)\d{2}/;
const DATE = new RegExp(`${MONTH.source}\\s+${YEAR.source}|${YEAR.source}|Present|present|Current|current`);
const DATE_RANGE = new RegExp(
  `(${DATE.source})\\s*(?:-{2,3}|\\u2013|\\u2014)\\s*(${DATE.source})`,
  "g",
);

export function stripDashes(text: string): string {
  return text
    .replace(DATE_RANGE, "$1 to $2")
    .replace(/\s*-{3}\s*/g, ", ")
    .replace(/\s*-{2}\s*/g, ", ")
    .replace(/\s*[\u2013\u2014]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/,\s{2,}/g, ", ");
}
