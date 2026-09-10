/**
 * Server-side prompt builder and response validator for Grimm.
 *
 * buildMessages({ units }) → messages array for Groq chat completions.
 * parseJson(raw)           → best-effort JSON extraction from model output.
 * validateNotes(parsed, units) → clean array of { at, file, bullets }.
 */

export const LIMITS = {
  maxUnits: 400,
  maxChars: 300000,
};

/**
 * Builds the system + user messages that ask Groq to produce study notes.
 *
 * The model is instructed to return a JSON array where each element maps to
 * one input unit and carries a `bullets` array of concise note strings.
 */
export function buildMessages({ units }) {
  const system = [
    'You are a study-notes writer for university students.',
    'For each slide or page you receive, produce concise bullet-point notes',
    'that capture the key terms, definitions, important facts, and main ideas.',
    'Each bullet should be a short, self-contained sentence or phrase.',
    'Aim for 3 to 7 bullets per slide. Do not invent anything not in the text.',
    '',
    'Return ONLY a JSON array. Each element must have:',
    '  "at":     the slide/page label exactly as given in the input,',
    '  "file":   the filename exactly as given in the input,',
    '  "bullets": an array of strings, one per note point.',
    '',
    'Example:',
    '[',
    '  { "at": "Slide 1", "file": "lecture.pptx",',
    '    "bullets": ["Mitosis is cell division producing two identical daughter cells.",',
    '                "Occurs in four phases: prophase, metaphase, anaphase, telophase."] }',
    ']',
    '',
    'Return nothing but the JSON array. No markdown fences, no explanation.',
  ].join('\n');

  const lines = units.map(function (u, i) {
    return (
      '--- ' +
      (i + 1) +
      '. ' +
      u.at +
      ' (' +
      u.file +
      ') ---\n' +
      u.text
    );
  });

  const user = lines.join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Pulls the first JSON array or object out of raw model output, tolerating
 * markdown code fences and trailing commas.
 */
export function parseJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // strip markdown fences
  let text = raw.replace(/```(?:json)?/gi, '').trim();
  // find the outermost [ ... ] or { ... }
  const start = text.indexOf('[');
  const startObj = text.indexOf('{');
  let bracket = start;
  if (bracket < 0 || (startObj >= 0 && startObj < bracket)) bracket = startObj;
  if (bracket < 0) return null;
  const end = text.lastIndexOf(bracket === start ? ']' : '}');
  if (end < bracket) return null;
  text = text.slice(bracket, end + 1);
  // fix trailing commas
  text = text.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Validates the model's response. Returns an array of clean note objects.
 *
 * If a unit gets nothing back from the model, a plain-text fallback is
 * created by splitting the unit's text into lines, so the reviewer is never
 * entirely empty because of one bad batch.
 */
export function validateNotes(parsed, units) {
  const indexed = {};
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.at !== 'string' || !item.at.trim()) continue;
      if (!Array.isArray(item.bullets) || !item.bullets.length) continue;
      const bullets = item.bullets
        .filter((b) => typeof b === 'string' && b.trim())
        .map((b) => b.trim());
      if (!bullets.length) continue;
      const key = (item.at || '').trim() + '|' + (item.file || '').trim();
      if (!indexed[key]) indexed[key] = { at: item.at.trim(), file: (item.file || '').trim(), bullets };
    }
  }

  const out = [];
  for (const unit of units) {
    const key = unit.at.trim() + '|' + unit.file.trim();
    if (indexed[key]) {
      out.push(indexed[key]);
    } else {
      // Plain-text fallback: split the unit text into non-empty lines.
      const bullets = unit.text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 8)
        .slice(0, 10);
      if (bullets.length) out.push({ at: unit.at, file: unit.file, bullets });
    }
  }
  return out;
}
