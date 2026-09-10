/**
 * A very small read-only zip reader, enough for the Office formats.
 *
 * PPTX and DOCX are zip archives of XML, so this replaces a zip library
 * outright: it walks the central directory and inflates entries with the
 * browser's own DecompressionStream. No dependency to pin, and it works with
 * no network once the page is loaded.
 */
(function (root) {
  'use strict';

  var EOCD = 0x06054b50;
  var CENTRAL = 0x02014b50;
  var LOCAL = 0x04034b50;

  function findEocd(view) {
    var last = view.byteLength - 22;
    var floor = Math.max(0, view.byteLength - 66000);
    for (var at = last; at >= floor; at -= 1) {
      if (view.getUint32(at, true) === EOCD) return at;
    }
    return -1;
  }

  function decode(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  async function inflateRaw(bytes) {
    if (typeof root.DecompressionStream !== 'function') {
      throw new Error('This browser cannot unpack Office files. Try a current Chrome, Edge, Safari or Firefox.');
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new root.DecompressionStream('deflate-raw'));
    var out = await new Response(stream).arrayBuffer();
    return new Uint8Array(out);
  }

  /** Reads the archive index. Entry contents are inflated only when asked for. */
  function open(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = findEocd(view);
    if (eocd < 0) throw new Error('That file is not a zip archive, so it cannot be a pptx or docx.');

    var total = view.getUint16(eocd + 10, true);
    var at = view.getUint32(eocd + 16, true);
    var entries = {};
    for (var n = 0; n < total && at + 46 <= bytes.byteLength; n += 1) {
      if (view.getUint32(at, true) !== CENTRAL) break;
      var nameLen = view.getUint16(at + 28, true);
      var entry = {
        method: view.getUint16(at + 10, true),
        packed: view.getUint32(at + 20, true),
        size: view.getUint32(at + 24, true),
        offset: view.getUint32(at + 42, true),
        name: decode(bytes.subarray(at + 46, at + 46 + nameLen)),
      };
      entries[entry.name] = entry;
      at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }

    function raw(entry) {
      if (view.getUint32(entry.offset, true) !== LOCAL) {
        throw new Error('Damaged archive: ' + entry.name);
      }
      var from =
        entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
      var length = entry.packed || entry.size;
      return bytes.subarray(from, from + length);
    }

    return {
      names: Object.keys(entries),
      has: function (name) {
        return Object.prototype.hasOwnProperty.call(entries, name);
      },
      /** Entry contents as text, inflating if needed. */
      text: async function (name) {
        var entry = entries[name];
        if (!entry) return '';
        var data = raw(entry);
        if (entry.method === 0) return decode(data);
        if (entry.method !== 8) throw new Error('Unsupported compression in ' + name);
        return decode(await inflateRaw(data));
      },
    };
  }

  root.GR = root.GR || {};
  root.GR.zip = { open: open };
})(typeof window !== 'undefined' ? window : globalThis);
