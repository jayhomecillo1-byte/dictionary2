(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);   const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // Resilient memory cache if localStorage is blocked by local file security
  const memStore = {};
  const store = {
    get(k, d) {
      try {
        const item = window.localStorage ? localStorage.getItem('tala:' + k) : null;
        return item !== null ? JSON.parse(item) : d;
      } catch (e) {
        return memStore[k] !== undefined ? memStore[k] : d;
      }
    },
    set(k, v) {
      try {
        if (window.localStorage) localStorage.setItem('tala:' + k, JSON.stringify(v));
      } catch (e) {}
      memStore[k] = v;
    }
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const weekId = () => Math.floor(Date.now() / 604800000);

  const S = {
    fav: store.get('fav', []),
    hist: store.get('hist', []),
    theme: store.get('theme', 'light'),
    goal: store.get('goal', 15),
    week: store.get('week', { id: weekId(), words: [] }),
    cur: null
  };

  if (!S.week || S.week.id !== weekId()) {
    S.week = { id: weekId(), words: [] };
  }

  const save = () => ['fav', 'hist', 'theme', 'goal', 'week'].forEach(k => store.set(k, S[k]));

  const SAMPLE = [
    { word: 'hello', def: 'A greeting said when meeting someone or acknowledging someone arrival.' },
    { word: 'serendipity', def: 'The occurrence of fortunate events by chance.' },
    { word: 'resilient', def: 'Able to recover quickly from difficulties; tough.' },
    { word: 'ephemeral', def: 'Lasting for a very short time.' },
    { word: 'luminous', def: 'Full of or shedding light; bright or shining.' },
    { word: 'petrichor', def: 'The pleasant, earthy smell that accompanies the first rain after a long dry spell.' }
  ];

  /* ---------- Toast & Theme ---------- */
  let tt;
  function toast(m) {
    const t = $('#toast');     if (!t) return;     t.textContent = m;     t.classList.add('show');     clearTimeout(tt);     tt = setTimeout(() => t.classList.remove('show'), 1800);   }    function applyTheme() {     document.documentElement.dataset.theme = S.theme === 'dark' ? 'dark' : 'light';     $$('[data-theme-opt]').forEach(b => b.classList.toggle('on', b.dataset.themeOpt === S.theme));
  }

  function show(v) {
    if (!$('#v-' + v)) v = 'dictionary';
    $$('[data-v]').forEach(s => { s.hidden = s.id !== ('v-' + v); });$$
('nav [data-view]').forEach(b => { b.classList.toggle('on', b.dataset.view === v); });
    const viewMap = {
      favorites: renderFav,
      history: renderHist,
      quiz: renderQuizHome,
      settings: renderSettings
    };
    if (viewMap[v]) viewMap[v]();
    window.scrollTo(0, 0);
  }

  /* ---------- Normalized API Parser ---------- */
  function normalize(data) {
    const rootWord = (Array.isArray(data) ? data[0]?.word : data?.word) || '';
    const entries = Array.isArray(data) ? data : (data?.entries || []);
    const e = {
      word: rootWord,
      phonetic: '',
      audio: '',
      source: (Array.isArray(data) ? data[0]?.sourceUrls?.[0] : data?.entries?.[0]?.source?.url) || ('https://en.wiktionary.org/wiki/' + encodeURIComponent(rootWord)),
      meanings: []
    };
    const map = {};

    entries.forEach(item => {
      const prons = item.pronunciations || item.phonetics || [];
      prons.forEach(p => {
        const txt = p.text || (typeof p === 'string' ? p : '');
        if (!e.phonetic && txt) e.phonetic = txt;
        if (!e.audio && p.audio) e.audio = p.audio;
      });
      if (!e.phonetic && item.phonetic) e.phonetic = item.phonetic;

      if (item.partOfSpeech && item.senses) {
        const g = map[item.partOfSpeech] ||= { pos: item.partOfSpeech, defs: [], syn: [] };
        item.senses.forEach(s => {
          if (s.definition) {
            const ex = Array.isArray(s.examples) ? s.examples[0] : (s.example || '');
            g.defs.push({ d: s.definition, ex: typeof ex === 'string' ? ex : (ex?.text || '') });
          }
          (s.synonyms || []).forEach(syn => {
            const w = typeof syn === 'string' ? syn : syn.word;
            if (w && !g.syn.includes(w)) g.syn.push(w);
          });
        });
      } else if (item.meanings) {
        item.meanings.forEach(m => {
          const g = map[m.partOfSpeech] ||= { pos: m.partOfSpeech, defs: [], syn: [] };
          m.definitions?.forEach(x => g.defs.push({ d: x.definition, ex: x.example || '' }));
          [...(m.synonyms || []), ...(m.definitions?.flatMap(x => x.synonyms || []) || [])].forEach(syn => {
            if (!g.syn.includes(syn)) g.syn.push(syn);
          });
        });
      }
    });

    e.meanings = Object.values(map);
    return e;
  }

  async function fetchEntry(w) {
    try {
      const r = await fetch('https://freedictionaryapi.com/api/v1/entries/en/' + encodeURIComponent(w));
      if (r.ok) return normalize(await r.json());
    } catch (err) {}

    // Fallback dictionary for local/offline environments
    const found = SAMPLE.find(s => s.word.toLowerCase() === w.toLowerCase());
    if (found) {
      return {
        word: found.word,
        phonetic: '/' + found.word + '/',
        audio: '',
        source: 'https://en.wiktionary.org/wiki/' + encodeURIComponent(found.word),
        meanings: [{ pos: 'general', defs: [{ d: found.def, ex: '' }], syn: [] }]
      };
    }

    const err = new Error('nf');
    err.nf = true;
    throw err;
  }

  const firstDef = e => e.meanings[0]?.defs[0]?.d || '';

  function showError(t, m) {
    const mainCard = $('#main-card');
    if (!mainCard) return;
    mainCard.innerHTML = `<div class="card" style="text-align:center;padding:32px 20px;">
      <h2>${esc(t)}</h2>
      <p style="color:var(--muted);margin:8px 0 16px;">${esc(m)}</p>
      <button class="chip" data-w="hello">Try “hello”</button>
    </div>`;
  }

  async function lookup(raw) {
    const w = (raw || '').trim().toLowerCase();
    const qInput = $('#q');
    const mainCard = $('#main-card');

    if (!w) {
      showError('Type a word to search', 'Enter an English word in the box above.');
      if (qInput) qInput.focus();
      return;
    }

    show('dictionary');
    if (qInput) qInput.value = w;
    if (mainCard) mainCard.innerHTML = '<div class="card" style="padding:32px;text-align:center;">Looking up “' + esc(w) + '”...</div>';

    try {
      const e = await fetchEntry(w);
      renderEntry(e);
      addHist(e);
      markExplored(e.word);
    } catch (x) {
      if (x.nf) showError(`No entry for “${w}”`, 'Check the spelling or try another word.');
      else showError('Unable to search', 'Check your connection and try again.');
    }
  }

  function speak(w) {
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(w);
      u.lang = 'en-US';
      speechSynthesis.speak(u);
    } else {
      toast('Speech synthesis is not supported on this browser');
    }
  }

  function renderEntry(e) {
    S.cur = e;
    const mainCard = $('#main-card');
    if (!mainCard) return;

    const isF = S.fav.some(f => f.word === e.word);
    const secs = e.meanings.map(m => `
      <div class="posh">${esc(m.pos)}</div>
      <ol class="defs">${m.defs.map((d, i) => `<li><span class="n">${i + 1}</span><div><div>${esc(d.d)}</div>${d.ex ? `<div class="q">“${esc(d.ex)}”</div>` : ''}</div></li>`).join('')}</ol>
      ${m.syn.length ? `<div class="syn"><span class="lbl">Synonyms:</span>${m.syn.slice(0, 8).map(s => `<button class="chip" data-w="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    `).join('');

    mainCard.innerHTML = `<article class="card">
      <div class="wordhead">
        <span class="lbl">Definition</span>
        <button class="icon-btn ${isF ? 'saved' : ''}" id="b-fav">${isF ? '★ Saved' : '☆ Save'}</button>
      </div>
      <h2 class="word">${esc(e.word)}</h2>
      <div class="pron">
        <button class="icon-btn" id="b-play">▶ Listen</button>
        <span>${esc(e.phonetic) || ''}</span>
      </div>
      ${secs || '<p style="color:var(--muted)">No definition entries found.</p>'}
      <div style="margin-top:20px;padding-top:12px;border-top:1px solid var(--line);font-size:13px;">
        ${e.source ? `<a href="${esc(e.source)}" target="_blank" rel="noopener" style="color:var(--brass-t);text-decoration:none;">Source: Wiktionary ↗</a>` : ''}
      </div>
    </article>`;

    $('#b-fav').onclick = () => {
      if (S.fav.some(f => f.word === e.word)) {
        S.fav = S.fav.filter(f => f.word !== e.word);
        toast('Removed from favorites');
      } else {
        S.fav.unshift({ word: e.word, def: firstDef(e), pos: e.meanings[0]?.pos || '' });
        toast('Saved to favorites');
      }
      save();
      updateCounts();
      renderEntry(e);
    };

    $('#b-play').onclick = () => {
      if (e.audio) new Audio(e.audio).play().catch(() => speak(e.word));
      else speak(e.word);
    };
  }

  function addHist(e) {
    S.hist = [{ word: e.word, def: firstDef(e), t: Date.now() }, ...S.hist.filter(h => h.word !== e.word)].slice(0, 50);
    save();
    updateCounts();
  }

  function markExplored(w) {
    if (!S.week.words.includes(w)) S.week.words.push(w);
    save();
    updateCounts();
  }

  function updateCounts() {
    const cHist = $('#c-hist');
    const cFav = $('#c-fav');
    const cWeek = $('#c-week');
    const cBar = $('#c-bar');
    if (cHist) cHist.textContent = S.hist.length;
    if (cFav) cFav.textContent = S.fav.length;
    const n = S.week.words.length;
    if (cWeek) cWeek.textContent = `${n} / ${S.goal}`;
    if (cBar) cBar.style.width = Math.min(100, (n / S.goal) * 100) + '%';
  }

  function renderFav() {
    const favList = $('#fav-list');
    if (!favList) return;
    favList.innerHTML = S.fav.length
      ? `<div class="cards">${S.fav.map(f => `<div class="mini" data-lookup="${esc(f.word)}"><h3>${esc(f.word)}</h3><p>${esc(f.def)}</p></div>`).join('')}</div>`
      : '<div class="card" style="text-align:center;padding:32px;"><p style="color:var(--muted)">No favorites saved yet.</p></div>';
  }

  function renderHist() {
    const histList = $('#hist-list');
    if (!histList) return;
    histList.innerHTML = S.hist.length
      ? `<div class="cards">${S.hist.map(h => `<div class="mini" data-lookup="${esc(h.word)}"><h3>${esc(h.word)}</h3><p>${esc(h.def)}</p></div>`).join('')}</div>`
      : '<div class="card" style="text-align:center;padding:32px;"><p style="color:var(--muted)">No search history yet.</p></div>';
  }

  /* ---------- Quiz ---------- */
  let Q = null;
  function renderQuizHome() {
    const quiz = $('#quiz');
    if (!quiz) return;
    const pool = S.fav.length >= 3 ? S.fav : SAMPLE;
    quiz.innerHTML = `<div class="card" style="text-align:center;padding:32px;">
      <h2>Vocabulary Quiz</h2>
      <p style="color:var(--muted);margin:8px 0 20px;">Ready to test yourself on ${pool.length} vocabulary words?</p>
      <button class="btn" id="start-q">Start Quiz</button>
    </div>`;
    $('#start-q').onclick = () => {
      const qs = pool.map(c => {
        const others = SAMPLE.filter(x => x.def !== c.def).slice(0, 3).map(x => x.def);
        const opts = [c.def, ...others].sort(() => Math.random() - 0.5);
        return { word: c.word, ans: c.def, opts };
      });
      Q = { qs, i: 0, score: 0 };
      renderQ();
    };
  }

  function renderQ() {
    const quiz = $('#quiz');
    if (!quiz || !Q) return;
    if (Q.i >= Q.qs.length) {
      quiz.innerHTML = `<div class="card" style="text-align:center;padding:32px;">
        <div class="lbl">Final Score</div>
        <div class="score">${Q.score} / ${Q.qs.length}</div>
        <button class="btn" onclick="location.hash='#dictionary'">Return to Dictionary</button>
      </div>`;
      return;
    }
    const cur = Q.qs[Q.i];
    quiz.innerHTML = `<div class="card">
      <div class="lbl">Question ${Q.i + 1} of ${Q.qs.length}</div>
      <h2 class="word" style="font-size:32px;">${esc(cur.word)}</h2>
      <div class="opts">${cur.opts.map((o, k) => `<button class="opt" data-k="${k}">${k + 1}.${esc(o)}</button>`).join('')}</div>
      <div class="fb" id="q-fb"></div>
    </div>`;
    $$('.opt').forEach(b => {       b.onclick = () => {         const pick = cur.opts[+b.dataset.k];         const ok = pick === cur.ans;         if (ok) Q.score++;         $$('.opt').forEach((btn, idx) => {           btn.disabled = true;           if (cur.opts[idx] === cur.ans) btn.classList.add('ok');           else if (btn === b) btn.classList.add('no');         });$('#q-fb').innerHTML = `<span>${ok ? 'Correct!' : 'Incorrect.'}</span><button class="btn" id="q-nxt">Next</button>`;
        $('#q-nxt').onclick = () => { Q.i++; renderQ(); };
      };
    });
  }

  /* ---------- Settings ---------- */
  function renderSettings() {
    const gVal = $('#g-val');
    const dNote = $('#data-note');
    if (gVal) gVal.textContent = S.goal;
    if (dNote) dNote.textContent = `${S.fav.length} saved words, ${S.hist.length} history items.`;
  }

  /* ---------- Delegated Click Handler ---------- */
  document.addEventListener('click', e => {
    const t = e.target;
    const vBtn = t.closest('[data-view]');
    if (vBtn && vBtn.dataset.view) {
      e.preventDefault();
      show(vBtn.dataset.view);
      return;
    }
    const lk = t.closest('[data-lookup]');
    if (lk) {
      lookup(lk.dataset.lookup);
      return;
    }
    const w = t.closest('[data-w]');
    if (w) {
      lookup(w.dataset.w);
      return;
    }
  });

  $('#form').onsubmit = e => {
    e.preventDefault();
    lookup($('#q').value);
  };

  $('#themeToggle').onclick = () => {     S.theme = S.theme === 'dark' ? 'light' : 'dark';     save();     applyTheme();   };    $$('[data-theme-opt]').forEach(b => {
    b.onclick = () => {
      S.theme = b.dataset.themeOpt;
      save();
      applyTheme();
    };
  });

  $('#g-dn').onclick = () => { S.goal = Math.max(1, S.goal - 1); save(); renderSettings(); updateCounts(); };
  $('#g-up').onclick = () => { S.goal = Math.min(100, S.goal + 1); save(); renderSettings(); updateCounts(); };

  $('#clear-hist').onclick = $('#s-clear-hist').onclick = () => {
    S.hist = []; save(); updateCounts(); renderHist(); renderSettings();
  };
  $('#s-clear-fav').onclick = () => {
    S.fav = []; save(); updateCounts(); renderFav(); renderSettings();
  };

  /* ---------- Init ---------- */
  applyTheme();
  updateCounts();
  show('dictionary');
  lookup('hello');
})();