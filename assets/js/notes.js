/**
 * Renders and manages the notes view on screen.
 *
 * mount(container, paper, options) builds the notes cards inside container.
 * Each card represents one slide or page: a header with the slide label and
 * source file, then a bullet list of study notes.
 *
 * The order is either the original slide order (chronological) or a
 * Fisher-Yates shuffle seeded from paper.stamp (randomised). The shuffled
 * order is stored on paper.order so the exporter can reproduce it exactly.
 */
(function (root) {
  'use strict';

  /**
   * Fisher-Yates shuffle using a simple seeded PRNG (mulberry32) so the
   * same stamp always produces the same order.
   */
  function seededShuffle(arr, seed) {
    var copy = arr.slice();
    var s = seed >>> 0;

    function next() {
      s += 0x6d2b79f5;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    for (var i = copy.length - 1; i > 0; i -= 1) {
      var j = Math.floor(next() * (i + 1));
      var held = copy[i];
      copy[i] = copy[j];
      copy[j] = held;
    }
    return copy;
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function text(str) {
    return document.createTextNode(str);
  }

  /** Escapes a string for safe insertion as HTML text. */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Builds one note card for a slide.
   *   { at, file, bullets }
   */
  function buildCard(note, index) {
    var card = el('article', 'note-card');
    card.setAttribute('data-index', String(index));

    var header = el('header', 'note-header');
    var label = el('span', 'note-label');
    label.textContent = note.at;
    var source = el('span', 'note-source');
    source.textContent = note.file;
    header.appendChild(label);
    header.appendChild(source);
    card.appendChild(header);

    var list = el('ul', 'note-bullets');
    note.bullets.forEach(function (bullet) {
      var li = el('li', 'note-bullet');
      li.textContent = bullet;
      list.appendChild(li);
    });
    card.appendChild(list);

    return card;
  }

  /**
   * Mounts the notes view.
   *
   * options:
   *   mode       'chronological' | 'randomised'
   *   onMounted  called with { notes, order } after the DOM is built
   */
  function mount(container, paper, options) {
    var opts = options || {};
    var mode = opts.mode === 'randomised' ? 'randomised' : 'chronological';
    var notes = (paper && paper.notes) || [];

    // Build or restore order
    var ordered;
    if (mode === 'randomised') {
      if (paper.order && paper.order.length === notes.length) {
        // Saved file: restore the stored shuffle
        ordered = paper.order.map(function (i) { return notes[i]; });
      } else {
        // First time: shuffle and store
        ordered = seededShuffle(notes, paper.stamp || Date.now());
        paper.order = ordered.map(function (note) { return notes.indexOf(note); });
      }
    } else {
      ordered = notes.slice();
      paper.order = null; // chronological — no stored order needed
    }

    container.textContent = '';

    var heading = el('h2', 'notes-heading');
    heading.textContent = paper.title || 'Notes Reviewer';
    container.appendChild(heading);

    var meta = el('p', 'notes-meta');
    meta.textContent =
      ordered.length +
      (ordered.length === 1 ? ' slide' : ' slides') +
      ' \u00b7 ' +
      (mode === 'randomised' ? 'Randomised order' : 'Chronological order') +
      ' \u00b7 ' +
      paper.made;
    container.appendChild(meta);

    var grid = el('div', 'notes-grid');
    ordered.forEach(function (note, i) {
      grid.appendChild(buildCard(note, i));
    });
    container.appendChild(grid);

    if (typeof opts.onMounted === 'function') {
      opts.onMounted({ notes: ordered, order: paper.order });
    }
  }

  root.GR = root.GR || {};
  root.GR.notes = { mount: mount, seededShuffle: seededShuffle };
})(typeof window !== 'undefined' ? window : globalThis);
