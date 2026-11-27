/* Hippo Travel — SentencePiece BPE tokenizer for the Hindi voice (Indus Pocket TTS), written for this website.
   Same steps as SentencePiece: NFKC + whitespace clean-up, "▁" for spaces (and one at the start),
   then the pair whose joined piece has the highest score is joined again and again. */
(function (root) {
  'use strict';
  function make(json) {
    var id = new Map(), score = new Map();
    json.pieces.forEach(function (p, i) { if (p[2] === 1) { id.set(p[0], i); score.set(p[0], p[1]); } });
    var unk = json.unk || 0;
    function norm(t) {
      t = String(t || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\s  -​  　]+/g, ' ').trim();
      return t ? '▁' + t.replace(/ /g, '▁') : '';
    }
    function encode(text) {
      var s = Array.from(norm(text));
      if (!s.length) return [];
      /* join the best pair until no pair makes a known piece */
      for (;;) {
        var best = -Infinity, at = -1;
        for (var i = 0; i < s.length - 1; i++) {
          var sc = score.get(s[i] + s[i + 1]);
          if (sc !== undefined && sc > best) { best = sc; at = i; }
        }
        if (at < 0) break;
        s.splice(at, 2, s[at] + s[at + 1]);
      }
      var out = [];
      s.forEach(function (p) {
        if (id.has(p)) out.push(id.get(p));
        else Array.from(p).forEach(function (c) { out.push(id.has(c) ? id.get(c) : unk); });
      });
      return out;
    }
    return { encode: encode, norm: norm };
  }
  var api = { make: make };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HxSpm = api;
})(typeof self !== 'undefined' ? self : this);
