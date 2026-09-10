/**
 * Wires the Grimm page together: files in, notes out, review on screen.
 *
 * Everything of substance lives in the other files. This one only listens to
 * the controls, keeps the small amount of state the page needs, and hands the
 * work to extract, generate, notes and exporter in turn.
 */
(function () {
  'use strict';

  var THEME_STORE = 'gr-theme';
  var CODE_STORE = 'gr-code';

  var material = { units: [], files: [] };
  var paper = null;
  var busy = false;
  var orderMode = 'chronological'; // 'chronological' | 'randomised'

  function $(id) { return document.getElementById(id); }

  var app         = $('app');
  var headMeta    = $('head-meta');
  var drop        = $('drop');
  var input       = $('files');
  var pick        = $('pick');
  var fileList    = $('filelist');
  var readStatus  = $('read-status');
  var optPanel    = $('opt-panel');
  var orderBtns   = $('order-seg');
  var codeField   = $('code-field');
  var code        = $('code');
  var makeBtn     = $('make');
  var track       = $('track');
  var fill        = $('track-fill');
  var status      = $('status');
  var themeBtn    = $('theme');
  var themeMark   = $('theme-mark');
  var saveBtn     = $('save-btn');
  var exportChooser = $('export-chooser');
  var exportHtml  = $('export-html');
  var exportPdf   = $('export-pdf');
  var exportPdfDownload = $('export-pdf-download');
  var pdfLayout   = $('pdf-layout');
  var exportCancel = $('export-cancel');

  /* ── helpers ─────────────────────────────────────────────────────────────── */

  function show(node, on) {
    if (node) node.classList.toggle('hidden', !on);
  }

  function say(node, txt, bad) {
    if (!node) return;
    node.textContent = txt || '';
    node.classList.toggle('is-bad', !!bad);
  }

  function plural(n, one, many) {
    return n + '\u00a0' + (n === 1 ? one : many);
  }

  function sizeText(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function row(tag, className, txt) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (txt != null) node.textContent = txt;
    return node;
  }

  function madeText() {
    try {
      return new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (err) {
      return new Date().toDateString();
    }
  }

  function titleFor() {
    var names = material.files
      .filter(function (f) { return f.units > 0; })
      .map(function (f) {
        return f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
      })
      .filter(Boolean);
    if (!names.length) return 'Notes';
    if (names.length === 1) return names[0];
    return names[0] + ' and ' + plural(names.length - 1, 'more file', 'more files');
  }

  /* ── file list ────────────────────────────────────────────────────────────── */

  function renderFiles() {
    fileList.textContent = '';
    material.files.forEach(function (file) {
      var line = row('li', 'file');
      line.appendChild(row('span', 'file-name', file.name));
      var parts = [];
      if (file.units) parts.push(plural(file.units, 'slide / page', 'slides / pages'));
      if (file.size)  parts.push(sizeText(file.size));
      line.appendChild(row('span', 'file-meta', parts.join(', ')));
      if (file.warning) line.appendChild(row('span', 'file-warn', file.warning));
      fileList.appendChild(line);
    });
    show(fileList, material.files.length > 0);
  }

  function renderHead() {
    if (!material.units.length) { headMeta.textContent = 'Nothing uploaded yet'; return; }
    var kept = material.files.filter(function (f) { return f.units > 0; }).length;
    headMeta.textContent =
      plural(kept, 'file', 'files') + ', ' + plural(material.units.length, 'slide / page', 'slides / pages');
  }

  /* ── upload ───────────────────────────────────────────────────────────────── */

  async function addFiles(list) {
    var picked = Array.prototype.slice.call(list || []);
    if (!picked.length || busy) return;
    busy = true;
    makeBtn.disabled = true;
    say(readStatus, 'Reading ' + plural(picked.length, 'file', 'files') + '...');
    try {
      var got = await GR.extract.read(picked, function (at) {
        say(readStatus, 'Reading ' + at.file + ', ' + at.at + ' of ' + at.of);
      });
      material.units = material.units.concat(got.units);
      material.files = material.files.concat(got.files);
      renderFiles();
      renderHead();
      show(optPanel, material.units.length > 0);
      var trouble = material.files
        .filter(function (f) { return !f.units; })
        .map(function (f) { return f.name; });
      if (!material.units.length) {
        say(readStatus, got.files[0] && got.files[0].warning ? got.files[0].warning : 'Nothing readable in that.', true);
      } else {
        say(readStatus, got.warnings.concat(
          trouble.length ? ['Nothing could be read from ' + trouble.join(', ') + '.'] : []
        ).join(' '));
      }
    } catch (err) {
      say(readStatus, err && err.message ? err.message : 'Those files could not be read.', true);
    }
    input.value = '';
    busy = false;
    makeBtn.disabled = !material.units.length;
  }

  /* ── order toggle ─────────────────────────────────────────────────────────── */

  function onOrder(event) {
    var btn = event.target.closest ? event.target.closest('.seg-btn') : null;
    if (!btn) return;
    orderMode = btn.getAttribute('data-mode') || 'chronological';
    Array.prototype.forEach.call(orderBtns.children, function (b) {
      b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
    });
  }

  /* ── generate ─────────────────────────────────────────────────────────────── */

  async function make() {
    if (busy) return;
    if (!material.units.length) return say(status, 'Add a file first.', true);
    busy = true;
    makeBtn.disabled = true;
    show(track, true);
    fill.style.width = '0%';
    say(status, 'Sending the material...');
    try {
      var out = await GR.generate.run({
        units: material.units,
        accessCode: code.value.trim(),
        onProgress: function (at) {
          if (at.total) fill.style.width = Math.round((at.done / at.total) * 100) + '%';
          say(status, at.note + (at.total > 1 ? ' (' + at.done + ' of ' + at.total + ' done)' : ''));
        },
      });
      remember(code.value.trim());
      showNotes(out);
    } catch (err) {
      if (err && err.status === 401) { show(codeField, true); code.focus(); }
      say(status, err && err.message ? err.message : 'The notes could not be written.', true);
      makeBtn.disabled = false;
      show(track, false);
    }
    busy = false;
  }

  /* ── notes view ───────────────────────────────────────────────────────────── */

  function showNotes(out) {
    paper = {
      title: titleFor(),
      made: madeText(),
      stamp: Date.now(),
      mode: orderMode,
      files: material.files
        .filter(function (f) { return f.units > 0; })
        .map(function (f) { return { name: f.name }; }),
      notes: out.notes,
      order: null, // filled in by notes.mount for randomised mode
    };

    app.textContent = '';
    GR.notes.mount(app, paper, {
      mode: orderMode,
      onMounted: function () {
        // Scroll to top after mount
        window.scrollTo(0, 0);
      },
    });

    // Append the save / PDF bar below the notes
    var bar = row('div', 'dock-bar');
    var saveHtml = row('button', 'btn', 'Save as a file');
    saveHtml.type = 'button';
    saveHtml.addEventListener('click', openExportChooser);
    bar.appendChild(saveHtml);
    app.appendChild(bar);

    show(saveBtn, true);
    renderHead();

    if (out.warnings && out.warnings.length) {
      var note = row('p', 'status is-bad', out.warnings.join(' '));
      app.appendChild(note);
    }
  }

  /* ── export chooser ───────────────────────────────────────────────────────── */

  function selectedColumns() {
    var chosen = document.querySelector('input[name="pdf-layout"]:checked');
    var value = chosen ? Number(chosen.value) : 1;
    return value === 2 || value === 3 ? value : 1;
  }

  function closeExportChooser() {
    show(exportChooser, false);
    if (exportChooser) exportChooser.setAttribute('aria-hidden', 'true');
    show(pdfLayout, false);
    show(exportPdfDownload, false);
  }

  function openExportChooser() {
    if (!paper) return;
    show(exportChooser, true);
    if (exportChooser) exportChooser.setAttribute('aria-hidden', 'false');
    show(pdfLayout, false);
    if (exportHtml) exportHtml.focus();
  }

  async function chooseHtml() {
    closeExportChooser();
    var was = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Building file...';
    try {
      var file = await GR.exporter.save(paper);
      saveBtn.textContent = 'Saved';
      setTimeout(function () { saveBtn.textContent = was; saveBtn.disabled = false; }, 2400);
    } catch (err) {
      saveBtn.textContent = was;
      saveBtn.disabled = false;
      say(status, err && err.message ? err.message : 'The file could not be built.', true);
    }
  }

  /* ── access code memory ───────────────────────────────────────────────────── */

  function remember(value) {
    try {
      if (value) localStorage.setItem(CODE_STORE, value);
      else localStorage.removeItem(CODE_STORE);
    } catch (err) { /* private browsing */ }
  }

  /* ── drag & drop ──────────────────────────────────────────────────────────── */

  function hot(on) { drop.classList.toggle('is-hot', on); }

  /* ── theme ────────────────────────────────────────────────────────────────── */

  function themeNow() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function paintTheme() {
    var dark = themeNow() === 'dark';
    themeMark.textContent = dark ? '\u263d' : '\u2600';
    themeBtn.setAttribute('title', dark ? 'Switch to light' : 'Switch to dark');
  }

  function setTheme(pick) {
    document.documentElement.setAttribute('data-theme', pick === 'light' ? 'light' : 'dark');
    paintTheme();
    try { localStorage.setItem(THEME_STORE, themeNow()); } catch (err) {}
  }

  function startTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_STORE); } catch (err) {}
    document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : 'dark');
    paintTheme();
    themeBtn.addEventListener('click', function () {
      setTheme(themeNow() === 'dark' ? 'light' : 'dark');
    });
  }

  /* ── boot ─────────────────────────────────────────────────────────────────── */

  function start() {
    startTheme();

    input.addEventListener('change', function () { addFiles(input.files); });

    drop.addEventListener('click', function (event) {
      if (event.target === input || event.target === pick || pick.contains(event.target)) return;
      input.click();
    });

    ['dragenter', 'dragover'].forEach(function (name) {
      drop.addEventListener(name, function (event) { event.preventDefault(); hot(true); });
    });
    ['dragleave', 'dragend'].forEach(function (name) {
      drop.addEventListener(name, function () { hot(false); });
    });
    drop.addEventListener('drop', function (event) {
      event.preventDefault();
      hot(false);
      addFiles(event.dataTransfer && event.dataTransfer.files);
    });
    ['dragover', 'drop'].forEach(function (name) {
      window.addEventListener(name, function (event) {
        if (!drop.contains(event.target)) event.preventDefault();
      });
    });

    if (orderBtns) orderBtns.addEventListener('click', onOrder);

    makeBtn.addEventListener('click', make);
    if (saveBtn) saveBtn.addEventListener('click', openExportChooser);

    if (exportCancel) exportCancel.addEventListener('click', closeExportChooser);
    if (exportHtml) exportHtml.addEventListener('click', chooseHtml);
    if (exportPdf) {
      exportPdf.addEventListener('click', function () {
        show(pdfLayout, true);
        show(exportPdfDownload, true);
        if (exportPdfDownload) exportPdfDownload.focus();
      });
    }
    if (exportPdfDownload) {
      exportPdfDownload.addEventListener('click', function () {
        var cols = selectedColumns();
        exportPdfDownload.disabled = true;
        exportPdfDownload.textContent = 'Opening print dialog...';
        try {
          var result = GR.exporter.downloadPDF(paper, cols);
          closeExportChooser();
          say(status, result.name + ' — ' + cols + '-column layout.');
        } catch (err) {
          say(status, err && err.message ? err.message : 'Could not open print dialog.', true);
        } finally {
          exportPdfDownload.disabled = false;
          exportPdfDownload.textContent = 'Download PDF';
        }
      });
    }
    if (exportChooser) {
      exportChooser.addEventListener('click', function (event) {
        if (event.target === exportChooser) closeExportChooser();
      });
    }

    // Restore saved access code
    try {
      var saved = localStorage.getItem(CODE_STORE);
      if (saved) { code.value = saved; show(codeField, true); }
    } catch (err) {}

    renderHead();
  }

  start();
})();
