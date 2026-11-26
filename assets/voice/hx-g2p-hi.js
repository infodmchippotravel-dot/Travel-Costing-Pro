/* Hippo Travel — Hindi (Devanagari) to phonemes for the website's own voice (Kokoro).
   Written for this website. It follows the sounds that espeak-ng gives for Hindi, which Kokoro learnt:
   the short "a" (schwa) is dropped at the end of a word and in the middle where Hindi speakers drop it,
   ं / ँ make a nasal sound, numbers are said in Hindi words.
   Latin words inside Hindi text (names, "Costing Sheet") are left for the English part to say. */
(function (root) {
  'use strict';
  var C = {   /* consonants (without the "a") */
    'क':'k','ख':'kʰ','ग':'ɡ','घ':'ɡ','ङ':'ŋ','च':'ʧ','छ':'ʧʰ','ज':'ʤ','झ':'ʤ','ञ':'ɲ',
    'ट':'ʈ','ठ':'ʈʰ','ड':'ɖ','ढ':'ɖ','ण':'ɳ','त':'t','थ':'tʰ','द':'d','ध':'d','न':'n',
    'प':'p','फ':'pʰ','ब':'b','भ':'b','म':'m','य':'j','र':'ɾ','ल':'l','ळ':'l','व':'ʋ',
    'श':'ʃ','ष':'ʃ','स':'s','ह':'h',
    'क़':'q','ख़':'x','ग़':'ɣ','ज़':'z','फ़':'f','ड़':'ɽ','ढ़':'ɽ','य़':'j','ऱ':'ɾ','ऩ':'n','ऴ':'l'
  };
  var NUKTA = {'क':'क़','ख':'ख़','ग':'ग़','ज':'ज़','फ':'फ़','ड':'ड़','ढ':'ढ़','य':'य़'};
  var V = {   /* vowels written as letters */
    'अ':'ə','आ':'aː','इ':'ɪ','ई':'iː','उ':'ʊ','ऊ':'uː','ऋ':'ɾɪ','ए':'eː','ऐ':'ɛː','ओ':'oː','औ':'ɔː',
    'ऍ':'ɛ','ऑ':'ɔ','ऎ':'e','ऒ':'o'
  };
  var M = {   /* vowel signs after a consonant */
    'ा':'aː','ि':'ɪ','ी':'iː','ु':'ʊ','ू':'uː','ृ':'ɾɪ','े':'eː','ै':'ɛː','ो':'oː','ौ':'ɔː',
    'ॅ':'ɛ','ॉ':'ɔ','ॆ':'e','ॊ':'o'
  };
  var HAL = '्', ANU = 'ं', CHA = 'ँ', VIS = 'ः', NUK = '़';
  /* the nasal that fits the next consonant (ं before क = ŋ, before प = m ...) */
  function nasalFor(next) {
    if (!next) return 'n';
    if (/^(k|ɡ|x|ɣ|q)/.test(next)) return 'ŋ';
    if (/^(ʧ|ʤ)/.test(next)) return 'ɲ';
    if (/^(ʈ|ɖ)/.test(next)) return 'ɳ';
    if (/^(p|b|m|f)/.test(next)) return 'm';
    return 'n';
  }
  /* one word: letters → list of {c: consonant sound or '', v: vowel sound or '', nas: nasal vowel, anu: ं} */
  function units(w) {
    var u = [], i = 0, ch, cur;
    w = w.normalize('NFC');
    while (i < w.length) {
      ch = w[i];
      if (w[i + 1] === NUK && NUKTA[ch]) { ch = NUKTA[ch]; i++; }
      if (C[ch] !== undefined) {
        cur = { c: C[ch], v: 'ə', inh: true };
        u.push(cur);
        var nx = w[i + 1];
        if (nx === HAL) { cur.v = ''; cur.inh = false; i += 2; continue; }
        if (M[nx] !== undefined) { cur.v = M[nx]; cur.inh = false; i += 2; }
        else i++;
      } else if (V[ch] !== undefined) {
        cur = { c: '', v: V[ch], inh: false }; u.push(cur); i++;
      } else if (ch === ANU || ch === CHA) {
        if (u.length) { var last = u[u.length - 1]; if (ch === ANU) last.anu = true; else last.nas = true; }
        i++; continue;
      } else if (ch === VIS) {
        u.push({ c: 'h', v: '', inh: false }); i++; continue;
      } else { i++; continue; }
      /* a sign after the vowel sign */
      while (w[i] === ANU || w[i] === CHA) { if (w[i] === ANU) cur.anu = true; else cur.nas = true; i++; }
    }
    return u;
  }
  /* which short "a" sounds are not said */
  function dropSchwa(u) {
    var n = u.length, k;
    if (!n) return;
    var last = u[n - 1];
    /* end of the word: drop it, but keep it after a joined pair like त्र / न्य, and in one-letter words */
    if (last.inh && n > 1 && !last.anu && !last.nas) {
      var prev = u[n - 2];
      var joined = prev.c && !prev.v;
      if (!(joined && /^(ɾ|j|ʋ)$/.test(last.c))) last.v = '';
    }
    /* in the middle (from the right): V C ə C V → the ə is dropped */
    for (k = n - 2; k >= 1; k--) {
      var x = u[k];
      if (!x.inh || x.anu || x.nas || !x.v) continue;
      var before = u[k - 1], after = u[k + 1];
      if (!before.v) continue;                 /* there is a consonant pair before it: keep */
      if (!after || !after.c || !after.v) continue;   /* the next letter has no vowel: keep */
      if (k + 1 === n - 1 && after.inh && after.v) continue;
      x.v = '';
    }
  }
  function isLong(v) { return /ː/.test(v); }
  function word(w) {
    var u = units(w);
    if (!u.length) return '';
    dropSchwa(u);
    /* stress: the first long vowel (not the last one when there is another), else the first vowel */
    var vi = [], j;
    for (j = 0; j < u.length; j++) if (u[j].v) vi.push(j);
    var st = -1;
    if (vi.length > 1) {
      for (j = 0; j < vi.length - 1; j++) if (isLong(u[vi[j]].v) || (u[vi[j] + 1] && !u[vi[j] + 1].v)) { st = vi[j]; break; }
      if (st < 0) st = vi[0];
    }
    var out = '';
    for (j = 0; j < u.length; j++) {
      var x = u[j];
      out += x.c;
      if (x.v) {
        var v = x.v;
        if (x.nas || (x.anu && !(u[j + 1] && u[j + 1].c))) v = v.replace(/^([^ː]+)(ː?)$/, '$1̃$2');
        out += (j === st ? 'ˈ' : '') + v;
        if (x.anu && u[j + 1] && u[j + 1].c) out += nasalFor(u[j + 1].c);
      } else if (x.anu) out += nasalFor(u[j + 1] && u[j + 1].c);
    }
    return out;
  }
  /* ---------- numbers in Hindi words ---------- */
  var N = ('शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस ' +
    'बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस ' +
    'चालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ ' +
    'साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी ' +
    'अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानबे बानबे तिरानबे चौरानबे पंचानबे छियानबे सत्तानबे अट्ठानबे निन्यानबे').split(' ');
  function num(n) {
    n = Math.floor(n);
    if (n < 100) return N[n];
    var s = [], p;
    if (n >= 10000000) { p = Math.floor(n / 10000000); s.push(num(p) + ' करोड़'); n %= 10000000; }
    if (n >= 100000) { p = Math.floor(n / 100000); s.push(num(p) + ' लाख'); n %= 100000; }
    if (n >= 1000) { p = Math.floor(n / 1000); s.push(num(p) + ' हज़ार'); n %= 1000; }
    if (n >= 100) { p = Math.floor(n / 100); s.push(N[p] + ' सौ'); n %= 100; }
    if (n) s.push(N[n]);
    return s.join(' ');
  }
  function numbers(t) {
    t = t.replace(/[०-९]/g, function (d) { return String(d.charCodeAt(0) - 0x966); });
    t = t.replace(/(\d),(?=\d)/g, '$1');
    t = t.replace(/(\d+)\.(\d+)/g, function (_, a, b) { return num(+a) + ' दशमलव ' + b.split('').map(function (d) { return N[+d]; }).join(' '); });
    /* a long number (phone) digit by digit, others as a number */
    return t.replace(/\d+/g, function (d) { return d.length > 9 ? d.split('').map(function (x) { return N[+x]; }).join(' ') : num(+d); });
  }
  /* text → list of pieces: {hi: phonemes} or {en: Latin text}; punctuation kept */
  function hindi(t) {
    t = numbers(String(t || ''));
    t = t.replace(/[।॥]/g, '.');
    var out = [], re = /([ऀ-ॿ]+)|([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*)*)|([;:,.!?—…"()“”]+)|(\s+)|./g, m;
    while ((m = re.exec(t))) {
      if (m[1]) out.push({ hi: word(m[1]) });
      else if (m[2]) out.push({ en: m[2] });
      else if (m[3]) out.push({ p: m[3] });
      else if (m[4]) out.push({ s: ' ' });
    }
    return out;
  }
  var api = { word: word, numbers: numbers, hindi: hindi, num: num };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HxHindiG2P = api;
})(typeof self !== 'undefined' ? self : this);
