/**
 * Batches slide units and calls /api/generate for notes.
 *
 * Unlike Acadex, there are no question-type counts or difficulty levels —
 * every batch simply asks for notes on all its units. Batches are kept small
 * so each request finishes inside the serverless time limit and so that the
 * full deck gets covered even when it is large.
 */
(function (root) {
  'use strict';

  var ENDPOINT = 'api/generate';

  var TARGET_CHARS = 12000;
  var MAX_BATCH_CHARS = 45000;
  var MAX_BATCHES = 40;
  var CONCURRENCY = 2;
  var TRIES = 3;

  function charsOf(unit) {
    return String(unit.text || '').length + String(unit.at || '').length + 8;
  }

  function labelOf(batch) {
    var first = batch.units[0];
    var last = batch.units[batch.units.length - 1];
    return first.at === last.at ? first.at : first.at + ' to ' + last.at;
  }

  /** Contiguous batches of roughly equal character count. */
  function plan(units) {
    var total = units.reduce(function (sum, unit) { return sum + charsOf(unit); }, 0);
    var count = Math.max(1, Math.ceil(total / TARGET_CHARS));
    if (total / count > MAX_BATCH_CHARS) count = Math.ceil(total / MAX_BATCH_CHARS);
    count = Math.min(count, MAX_BATCHES, units.length);

    var per = Math.ceil(total / count);
    var batches = [];
    var current = null;
    units.forEach(function (unit) {
      var size = charsOf(unit);
      var full = current && current.chars + size > MAX_BATCH_CHARS;
      if (!current || full || (current.chars >= per && batches.length < count)) {
        current = { units: [], chars: 0 };
        batches.push(current);
      }
      current.units.push(unit);
      current.chars += size;
    });
    batches.forEach(function (batch) { batch.label = labelOf(batch); });
    return batches;
  }

  function sleep(ms) {
    return new Promise(function (done) { setTimeout(done, ms); });
  }

  async function parseBody(res) {
    var text = '';
    try { text = await res.text(); } catch (err) { return {}; }
    try { return JSON.parse(text); } catch (err) {
      return { error: text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) };
    }
  }

  var AGAIN = { 408: 1, 429: 1, 502: 1, 503: 1, 504: 1 };

  function complain(status, said) {
    var text = said && said.error ? String(said.error) : '';
    if (status === 404 || status === 405) {
      text = 'No notes writer answered at /api/generate. This page has to be opened from the deployed site, not from a file on disk.';
    } else if (status === 401) {
      text = text || 'That access code was not accepted.';
    } else if (status === 500) {
      text = text || 'The site is missing its GROQ_API_KEY setting.';
    }
    var err = new Error(text || 'The notes writer answered with ' + status + '.');
    err.status = status;
    err.fatal = AGAIN[status] !== 1;
    return err;
  }

  async function ask(batch, code) {
    var headers = { 'content-type': 'application/json' };
    if (code) headers['x-access-code'] = code;
    var res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          units: batch.units.map(function (unit) {
            return { file: unit.file, at: unit.at, text: unit.text };
          }),
        }),
      });
    } catch (err) {
      var down = new Error('The notes writer could not be reached. Check the connection, then try again.');
      down.fatal = false;
      throw down;
    }
    if (res.ok) return await parseBody(res);
    var said = await parseBody(res);
    var trouble = complain(res.status, said);
    if (res.status === 429) trouble.after = Number(res.headers.get('retry-after')) || 0;
    throw trouble;
  }

  async function askHard(batch, code, note) {
    var last = null;
    for (var attempt = 1; attempt <= TRIES; attempt += 1) {
      try {
        return await ask(batch, code);
      } catch (err) {
        last = err;
        if (err.fatal || attempt === TRIES) throw err;
        var wait = Math.min(err.after ? err.after * 1000 : 700 * attempt * attempt, 20000);
        note(batch.label + ' is queued, trying again in ' + Math.max(1, Math.round(wait / 1000)) + 's');
        await sleep(wait + Math.floor(Math.random() * 400));
      }
    }
    throw last;
  }

  /**
   * Merges replies from all batches into one ordered notes array.
   * Notes are kept in the original slide order (the caller shuffles if needed).
   */
  function collect(replies, units) {
    var rank = {};
    units.forEach(function (unit, i) {
      var k = unit.at + '|' + unit.file;
      if (!(k in rank)) rank[k] = i;
    });

    var seen = {};
    var out = [];
    replies.forEach(function (reply) {
      var notes = reply && Array.isArray(reply.notes) ? reply.notes : [];
      notes.forEach(function (note) {
        if (!note || typeof note !== 'object') return;
        if (!Array.isArray(note.bullets) || !note.bullets.length) return;
        var k = (note.at || '') + '|' + (note.file || '');
        if (seen[k]) return;
        seen[k] = 1;
        var r = k in rank ? rank[k] : units.length;
        out.push({ at: note.at, file: note.file, bullets: note.bullets, rank: r });
      });
    });

    out.sort(function (a, b) { return a.rank - b.rank; });
    out.forEach(function (item) { delete item.rank; });
    return out;
  }

  /**
   * Generates notes for all uploaded units. Resolves with an ordered array of
   * note objects plus any warnings from partial failures.
   */
  async function run(options) {
    var settings = options || {};
    var units = (settings.units || []).filter(function (unit) { return unit && unit.text; });
    if (!units.length) throw new Error('There is no readable material to work from yet.');

    var code = settings.accessCode || '';
    var report = typeof settings.onProgress === 'function' ? settings.onProgress : function () {};
    var batches = plan(units);

    var replies = [];
    var models = [];
    var warnings = [];
    var stopped = null;
    var done = 0;
    var next = 0;

    function say(note) {
      report({ done: done, total: batches.length, note: note });
    }
    say('Reading ' + batches.length + (batches.length === 1 ? ' section' : ' sections') + ' of material');

    async function worker() {
      while (next < batches.length && !stopped) {
        var batch = batches[next];
        next += 1;
        try {
          var reply = await askHard(batch, code, say);
          replies.push(reply);
          if (reply && reply.model && models.indexOf(reply.model) < 0) models.push(reply.model);
        } catch (err) {
          var said = err && err.message ? err.message : 'Something went wrong.';
          if (err && err.fatal) stopped = err;
          else warnings.push(batch.label + ': ' + said);
        }
        done += 1;
        say('Notes written for ' + batch.label);
      }
    }

    var crew = [];
    for (var n = 0; n < Math.min(CONCURRENCY, batches.length); n += 1) crew.push(worker());
    await Promise.all(crew);

    var notes = collect(replies, units);
    if (!notes.length) throw stopped || new Error(warnings[0] || 'No notes came back. Try again in a moment.');
    if (stopped) warnings.push(stopped.message);

    return { notes: notes, models: models, batches: batches.length, warnings: warnings };
  }

  root.GR = root.GR || {};
  root.GR.generate = { run: run, plan: plan, collect: collect };
})(typeof window !== 'undefined' ? window : globalThis);
