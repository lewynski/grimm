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
 * Builds the system + user messages that ask Groq to produce accurate study notes.
 *
 * The model is instructed to read the slide content the way a diligent student
 * would — capturing the actual subject matter, not summarising the structure.
 */
export function buildMessages({ units }) {
  const system = [
    'You are an expert study-notes writer helping a university student review for an exam.',
    'You will receive the text of lecture slides or document pages, one at a time.',
    '',
    'For each slide or page, write concise but ACCURATE study notes that capture:',
    '  • The actual subject matter — facts, definitions, dates, names, processes, formulas, laws.',
    '  • Key concepts explained clearly, as if explaining to someone who needs to remember them.',
    '  • Important relationships and cause-effect chains present in the material.',
    '  • Any specific details that would appear on an exam (numbers, names, terms, steps).',
    '',
    'Rules:',
    '  1. Each bullet must be a COMPLETE, informative sentence — not a vague heading.',
    '     BAD:  "Rizal was important."',
    '     GOOD: "Jose Rizal\'s execution on December 30, 1896 intensified nationalist sentiment and accelerated the push for independence."',
    '  2. Do NOT invent or add information that is not in the slide text.',
    '  3. Do NOT write meta-commentary like "This slide covers..." or "The topic is...".',
    '  4. Do NOT write bullets about the course name, instructor, or administrative details unless the slide is purely administrative.',
    '  5. Aim for 3 to 6 bullets per slide. If a slide has rich content, write up to 8.',
    '  6. Use exact terms, names, and figures as they appear in the material.',
    '',
    'Return ONLY a valid JSON array. Each element must have exactly these keys:',
    '  "at":     the slide/page label exactly as given in the input (e.g. "Slide 1"),',
    '  "file":   the filename exactly as given in the input,',
    '  "bullets": an array of strings, one complete sentence per bullet.',
    '',
    'Example of good output:',
    '[',
    '  {',
    '    "at": "Slide 3",',
    '    "file": "lecture.pptx",',
    '    "bullets": [',
    '      "The Malolos Constitution, approved January 20, 1899, established the First Philippine Republic.",',
    '      "It was the first democratic constitution drafted by Filipinos, inspired by European liberal constitutions.",',
    '      "The constitution provided for a unicameral assembly and a president as the executive head.",',
    '      "Its creation was a direct result of the Philippine Revolution against Spanish colonial rule."',
    '    ]',
    '  }',
    ']',
    '',
    'Return nothing but the JSON array. No markdown fences, no explanation, no extra text.',
  ].join('\n');

  const lines = units.map(function (u, i) {
    return (
      '=== ' + (i + 1) + '. ' + u.at + ' | File: ' + u.file + ' ===\n' + u.text
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
      if (!indexed[key]) {
        indexed[key] = { at: item.at.trim(), file: (item.file || '').trim(), bullets };
      }
    }
  }

  const out = [];
  for (const unit of units) {
    const key = unit.at.trim() + '|' + unit.file.trim();
    if (indexed[key]) {
      out.push(indexed[key]);
    } else {
      // Plain-text fallback: split the unit text into non-empty sentences/lines.
      const bullets = unit.text
        .split(/\n|(?<=[.!?])\s+/)
        .map((l) => l.trim())
        .filter((l) => l.length > 12)
        .slice(0, 8);
      if (bullets.length) out.push({ at: unit.at, file: unit.file, bullets });
    }
  }
  return out;
}
