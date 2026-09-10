/**
 * Pulls plain text out of the files a student actually has: PDF handouts,
 * PowerPoint decks, Word documents, and notes in plain text.
 *
 * Everything happens in the browser. The files themselves never leave the
 * machine; only the extracted text is sent on for notes writing.
 *
 * The output is a flat list of units, one per slide or page, because that is
 * what lets Grimm cover a whole deck instead of its first few slides.
 */
(function (root) {
  'use strict';

  var PDF_BASES = [
    'assets/vendor/pdfjs/',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@5/build/',
    'https://unpkg.com/pdfjs-dist@5/build/',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/',
  ];

  var MAX_UNIT_CHARS = 3000;
  var MAX_UNITS = 400;
  var MIN_UNIT_CHARS = 16;
  var CHUNK_CHARS = 1100;

  var pdfLib = null;

  function extOf(name) {
    var dot = String(name || '').lastIndexOf('.');
    return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  }

  function tidy(text) {
    return String(text == null ? '' : text)
      .replace(/\r/g, '')
      .replace(new RegExp('[ \\t\\u00a0\\u200b]+', 'g'), ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function cap(text) {
    return text.length > MAX_UNIT_CHARS ? text.slice(0, MAX_UNIT_CHARS) + '...' : text;
  }

  function absolute(url) {
    return new URL(url, document.baseURI).href;
  }

  async function present(url) {
    try {
      var res = await fetch(url, { method: 'HEAD' });
      return res.ok && /javascript|ecmascript/i.test(res.headers.get('content-type') || '');
    } catch (err) {
      return false;
    }
  }

  async function loadPdf() {
    if (pdfLib) return pdfLib;
    var trouble = [];
    for (var i = 0; i < PDF_BASES.length; i += 1) {
      var base = absolute(PDF_BASES[i]);
      var local = base.indexOf(location.origin) === 0;
      if (local && !(await present(base + 'pdf.min.mjs'))) continue;
      try {
        var lib = await import(base + 'pdf.min.mjs');
        lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
        pdfLib = { lib: lib, cmaps: base.replace(/build\/$/, '') + 'cmaps/' };
        return pdfLib;
      } catch (err) {
        trouble.push(PDF_BASES[i] + ' (' + (err && err.message ? err.message : err) + ')');
      }
    }
    throw new Error('Could not load the PDF reader from ' + trouble.join(', ') + '.');
  }

  async function readPdf(file, emit) {
    var pdf = await loadPdf();
    var doc = await pdf.lib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false,
      useWorkerFetch: false,
      cMapUrl: pdf.cmaps,
      cMapPacked: true,
    }).promise;
    var pages = doc.numPages;
    var units = [];
    var thin = 0;
    for (var n = 1; n <= pages; n += 1) {
      var page = await doc.getPage(n);
      var content = await page.getTextContent();
      var text = tidy(
        content.items
          .map(function (bit) {
            return typeof bit.str === 'string' ? bit.str + (bit.hasEOL ? '\n' : '') : '';
          })
          .join('')
      );
      page.cleanup();
      if (text.length < MIN_UNIT_CHARS) thin += 1;
      else units.push({ at: 'Page ' + n, file: file.name, text: cap(text) });
      emit({ file: file.name, at: 'Page ' + n, of: pages });
    }
    await doc.destroy();
    var warning = '';
    if (!units.length) {
      warning = 'No text could be selected, so this looks like a scan. Run OCR on it first, then upload again.';
    } else if (thin > pages / 2) {
      warning = thin + ' of ' + pages + ' pages held no text and were skipped.';
    }
    return { units: units, warning: warning };
  }

  var NS = {
    draw: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    word: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  };

  function xmlLines(xml, ns) {
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return [];
    var paras = doc.getElementsByTagNameNS(ns, 'p');
    var lines = [];
    for (var i = 0; i < paras.length; i += 1) {
      var runs = paras[i].getElementsByTagNameNS(ns, 't');
      var line = '';
      for (var j = 0; j < runs.length; j += 1) line += runs[j].textContent;
      line = line.replace(/\s+/g, ' ').trim();
      if (line) lines.push(line);
    }
    return lines;
  }

  function slideNumber(name) {
    var found = /(\d+)\.xml$/.exec(name);
    return found ? parseInt(found[1], 10) : 0;
  }

  async function notesFor(zip, slide) {
    var rels = 'ppt/slides/_rels/' + slide.split('/').pop() + '.rels';
    if (!zip.has(rels)) return '';
    var doc = new DOMParser().parseFromString(await zip.text(rels), 'application/xml');
    var all = doc.getElementsByTagName('*');
    for (var i = 0; i < all.length; i += 1) {
      var type = all[i].getAttribute ? all[i].getAttribute('Type') : null;
      var target = all[i].getAttribute ? all[i].getAttribute('Target') : null;
      if (!type || !target || !/notesSlide$/.test(type)) continue;
      var path = 'ppt/' + target.replace(/^(\.\.\/)+/, '');
      if (!zip.has(path)) return '';
      return xmlLines(await zip.text(path), NS.draw).join('\n');
    }
    return '';
  }

  async function readPptx(file, emit) {
    var zip = root.GR.zip.open(await file.arrayBuffer());
    var slides = zip.names
      .filter(function (name) {
        return /^ppt\/slides\/slide\d+\.xml$/.test(name);
      })
      .sort(function (a, b) {
        return slideNumber(a) - slideNumber(b);
      });
    if (!slides.length) throw new Error('No slides inside. Is this really a PowerPoint file?');

    var units = [];
    var bare = 0;
    for (var i = 0; i < slides.length; i += 1) {
      var body = xmlLines(await zip.text(slides[i]), NS.draw).join('\n');
      var notes = await notesFor(zip, slides[i]);
      var text = tidy(body + (notes ? '\nNotes: ' + notes : ''));
      var at = 'Slide ' + (i + 1);
      if (text.length < MIN_UNIT_CHARS) bare += 1;
      else units.push({ at: at, file: file.name, text: cap(text) });
      emit({ file: file.name, at: at, of: slides.length });
    }
    return {
      units: units,
      warning: units.length
        ? bare
          ? bare + ' of ' + slides.length + ' slides were images or titles only, so they were skipped.'
          : ''
        : 'Every slide came back empty. If the text is inside pictures, export the deck to PDF and run OCR.',
    };
  }

  async function readDocx(file, emit) {
    var zip = root.GR.zip.open(await file.arrayBuffer());
    if (!zip.has('word/document.xml')) throw new Error('No document inside. Is this really a Word file?');
    var lines = xmlLines(await zip.text('word/document.xml'), NS.word);
    emit({ file: file.name, at: 'Reading', of: 1 });
    var units = chunkLines(lines, file.name, 'Section');
    return {
      units: units,
      warning: units.length ? '' : 'No text found in this document.',
    };
  }

  async function readPlain(file, emit) {
    var raw = await file.text();
    emit({ file: file.name, at: 'Reading', of: 1 });
    var lines = tidy(raw)
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
    var units = chunkLines(lines, file.name, 'Section');
    return { units: units, warning: units.length ? '' : 'This file has no readable text.' };
  }

  function chunkLines(lines, name, label) {
    var units = [];
    var buffer = [];
    var size = 0;

    function flush() {
      if (!size) return;
      var text = tidy(buffer.join('\n'));
      if (text.length >= MIN_UNIT_CHARS) {
        units.push({ at: label + ' ' + (units.length + 1), file: name, text: cap(text) });
      }
      buffer = [];
      size = 0;
    }

    lines.forEach(function (line) {
      var heading = /^#{1,6}\s/.test(line) || (line.length < 80 && !/[.:;,]$/.test(line));
      if (size && (size + line.length > CHUNK_CHARS || (heading && size > CHUNK_CHARS / 2))) flush();
      buffer.push(line);
      size += line.length + 1;
    });
    flush();
    return units;
  }

  var READERS = {
    pdf: readPdf,
    pptx: readPptx,
    pptm: readPptx,
    docx: readDocx,
    docm: readDocx,
    txt: readPlain,
    md: readPlain,
    markdown: readPlain,
    csv: readPlain,
  };

  var OLD = {
    ppt: 'PowerPoint 97-2003',
    doc: 'Word 97-2003',
    xls: 'Excel 97-2003',
  };

  async function read(list, onProgress) {
    var emit = typeof onProgress === 'function' ? onProgress : function () {};
    var units = [];
    var files = [];
    var full = false;

    for (var i = 0; i < list.length; i += 1) {
      var file = list[i];
      var kind = extOf(file.name);
      var entry = { name: file.name, size: file.size, units: 0, warning: '' };
      files.push(entry);
      try {
        var reader = READERS[kind];
        if (!reader) {
          throw new Error(
            OLD[kind]
              ? OLD[kind] + ' files cannot be read here. Open it, then save as .pptx, .docx or PDF.'
              : 'Not a format this reads. Use PDF, PPTX, DOCX, TXT or MD.'
          );
        }
        var got = await reader(file, emit);
        var room = MAX_UNITS - units.length;
        if (got.units.length > room) {
          got.units = got.units.slice(0, Math.max(0, room));
          full = true;
        }
        units = units.concat(got.units);
        entry.units = got.units.length;
        entry.warning = got.warning || '';
      } catch (err) {
        entry.warning = err && err.message ? err.message : 'Could not read this file.';
      }
    }

    var warnings = [];
    if (full) warnings.push('That is a lot of material, so only the first ' + MAX_UNITS + ' slides and pages were used.');
    return { units: units, files: files, warnings: warnings };
  }

  root.GR = root.GR || {};
  root.GR.extract = { read: read, limits: { units: MAX_UNITS, unitChars: MAX_UNIT_CHARS } };
})(typeof window !== 'undefined' ? window : globalThis);
