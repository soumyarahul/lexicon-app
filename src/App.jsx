import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Plus, Edit2, Trash2, Star, Shuffle, Volume2, X, Moon, Sun, BookOpen, Brain, Sparkles, ChevronLeft, ChevronRight, Target, Flame, TrendingUp, Library as LibraryIcon, ArrowLeft, Wand2, Loader } from 'lucide-react';

const POS_OPTIONS = ['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'interjection'];
const POS_COLORS = {
  noun:         { bg: '#E8DDD0', text: '#5C3A21', accent: '#A0522D' },
  verb:         { bg: '#D4E4D4', text: '#2D4A2D', accent: '#4A7C4A' },
  adjective:    { bg: '#E8D4D4', text: '#5C2D2D', accent: '#A04A4A' },
  adverb:       { bg: '#D4D4E8', text: '#2D2D5C', accent: '#4A4AA0' },
  pronoun:      { bg: '#E8E0D4', text: '#5C4A2D', accent: '#A07A4A' },
  preposition:  { bg: '#D4E8E4', text: '#2D5C4A', accent: '#4A9080' },
  conjunction:  { bg: '#E8D4E0', text: '#5C2D4A', accent: '#A04A80' },
  interjection: { bg: '#E8E4D0', text: '#5C5430', accent: '#A09040' },
};
const STORAGE_KEY = 'lexicon_cards_v1';
const MAX_CARDS   = 1000;

// ── CSS injected via JS — keeps Vite/PostCSS away from template literals ──
function useThemeStyles(theme, dark) {
  useEffect(() => {
    const id = 'lexicon-styles';
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent = [
      "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;0,9..144,800;1,9..144,400&family=JetBrains+Mono:wght@400;500&display=swap');",
      '*{box-sizing:border-box}body{margin:0}',
      '.paper-bg{background-image:radial-gradient(ellipse at top left,rgba(160,82,45,0.04),transparent 50%),radial-gradient(ellipse at bottom right,rgba(125,63,32,0.03),transparent 50%)}',
      ".display-font{font-family:'Fraunces','Cormorant Garamond',Georgia,serif}",
      ".mono-font{font-family:'JetBrains Mono',monospace}",
      '.card-flip{perspective:2000px}',
      '.card-flip-inner{position:relative;width:100%;height:100%;transition:transform 0.7s cubic-bezier(0.4,0,0.2,1);transform-style:preserve-3d}',
      '.card-flip-inner.flipped{transform:rotateY(180deg)}',
      '.card-face{position:absolute;width:100%;height:100%;backface-visibility:hidden;-webkit-backface-visibility:hidden}',
      '.card-back{transform:rotateY(180deg)}',
      `.btn{font-family:'Fraunces',serif;font-weight:500;padding:0.6rem 1.2rem;border-radius:2px;border:1px solid ${theme.border};background:${theme.surface};color:${theme.text};cursor:pointer;transition:all 0.2s;font-size:0.95rem;letter-spacing:0.01em;display:inline-flex;align-items:center;gap:0.5rem}`,
      `.btn:hover:not(:disabled){background:${theme.surfaceAlt};transform:translateY(-1px)}`,
      '.btn:disabled{opacity:0.4;cursor:not-allowed}',
      `.btn-primary{background:${theme.accent};color:${dark ? '#1a1612' : '#fdf9ef'};border-color:${theme.accent}}`,
      `.btn-primary:hover:not(:disabled){background:${theme.accentDark};border-color:${theme.accentDark}}`,
      `.input-field{width:100%;padding:0.75rem 1rem;background:${theme.surface};border:1px solid ${theme.border};color:${theme.text};font-family:'Cormorant Garamond',serif;font-size:1.05rem;border-radius:2px;outline:none;transition:border-color 0.2s}`,
      `.input-field:focus{border-color:${theme.accent}}`,
      ".pos-pill{display:inline-block;padding:0.15rem 0.7rem;font-family:'JetBrains Mono',monospace;font-size:0.7rem;letter-spacing:0.12em;text-transform:uppercase;border-radius:999px}",
      '.fade-in{animation:fadeIn 0.4s ease-out}',
      '@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
      '.scale-in{animation:scaleIn 0.5s cubic-bezier(0.34,1.56,0.64,1)}',
      '@keyframes scaleIn{from{opacity:0;transform:scale(0.92)}to{opacity:1;transform:scale(1)}}',
      `.ornament::before{content:'\u2766';color:${theme.accent};font-size:1.2rem}`,
      '.spin{animation:spin 1s linear infinite}',
      '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}',
      `.lookup-result{border:1px solid ${theme.border};border-radius:2px;cursor:pointer;padding:0.75rem 1rem;transition:background 0.15s}`,
      `.lookup-result:hover{background:${theme.surfaceAlt}}`,
      `.lookup-result.selected{border-color:${theme.accent};background:${theme.surfaceAlt}}`,
      '@media(max-width:640px){.hide-mobile{display:none!important}}',
    ].join('\n');
    return () => { el.textContent = ''; };
  }, [theme, dark]);
}

// ── Storage ───────────────────────────────────────────────
function loadCards() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { const p = JSON.parse(raw); if (Array.isArray(p)) return p; }
  } catch (_) {}
  return [];
}

// ── Lookup + example via Claude API (web_search enabled) ──
// Returns array of { pos, meaning, example }
async function lookupWord(word) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Look up the English word "${word}" in a dictionary and return its definitions.

Respond ONLY with a JSON array (no markdown, no backticks, no extra text) where each item has:
- "pos": part of speech (one of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection)
- "meaning": clear definition in plain English
- "example": one short example sentence using the word (or empty string if none)

Include up to 3 most common definitions. Example format:
[{"pos":"noun","meaning":"A feeling of great happiness","example":"She felt pure joy when she heard the news."}]`
      }],
    }),
  });
  if (!res.ok) throw new Error('API error');
  const data = await res.json();

  // Find the final text response (after any tool use)
  const textBlock = [...(data.content || [])].reverse().find(b => b.type === 'text');
  if (!textBlock?.text) throw new Error('No response');

  // Strip any accidental markdown fences
  const raw = textBlock.text.trim().replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('Empty');
  return parsed;
}

async function generateExample(word, pos, meaning) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Write exactly 2 clear, natural example sentences for the word "${word}" used as a ${pos} (meaning: ${meaning}).
Output only the 2 sentences, one per line, no numbering, no extra text.`,
      }],
    }),
  });
  if (!res.ok) throw new Error('API error');
  const data = await res.json();
  return data.content?.[0]?.text?.trim() || '';
}

// ── SM-2 ──────────────────────────────────────────────────
function nextReview(card, quality) {
  const now = Date.now();
  let { interval = 0, ease = 2.5, reps = 0 } = card.srs || {};
  if (quality < 3) { reps = 0; interval = 1; }
  else {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 3;
    else interval = Math.round(interval * ease);
    reps += 1;
    ease = Math.max(1.3, ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  }
  return { interval, ease, reps, dueAt: now + interval * 86400000, lastReviewed: now };
}

function MultilineText({ text, italic = true }) {
  if (!text) return null;
  return (
    <span style={{ fontStyle: italic ? 'italic' : 'normal' }}>
      {text.split(/\r?\n/).map((line, i, arr) => (
        <React.Fragment key={i}>{line}{i < arr.length - 1 && <br />}</React.Fragment>
      ))}
    </span>
  );
}

// ── App ───────────────────────────────────────────────────
export default function App() {
  const [cards, setCards]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [view, setView]               = useState('library');
  const [dark, setDark]               = useState(false);
  const [search, setSearch]           = useState('');
  const [filterPOS, setFilterPOS]     = useState('all');
  const [filterFav, setFilterFav]     = useState(false);
  const [showForm, setShowForm]       = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [studyDeck, setStudyDeck]     = useState([]);
  const [studyIdx, setStudyIdx]       = useState(0);
  const [flipped, setFlipped]         = useState(false);
  const [toast, setToast]             = useState(null);
  const saveTimer = useRef(null);

  const theme = dark ? {
    bg: '#1a1612', surface: '#241e18', surfaceAlt: '#2d2620',
    text: '#f0e6d2', textMuted: '#a89a82', border: '#3d342a',
    accent: '#d4a574', accentDark: '#b8895a',
  } : {
    bg: '#f5efe3', surface: '#fdf9ef', surfaceAlt: '#f0e8d6',
    text: '#2d2418', textMuted: '#6b5e48', border: '#d8cdb3',
    accent: '#a0522d', accentDark: '#7d3f20',
  };

  useThemeStyles(theme, dark);

  useEffect(() => {
    try {
      const loaded = loadCards();
      setCards(loaded.sort((a, b) => b.createdAt - a.createdAt));
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (loading) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cards)); } catch (_) { showToast('Save failed'); }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [cards, loading]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  const addCard = (data) => {
    if (cards.length >= MAX_CARDS) { showToast('Limit reached (1000 words)'); return; }
    const card = {
      ...data,
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      createdAt: Date.now(), favorite: false, srs: null,
    };
    setCards(prev => [card, ...prev]);
    showToast('Card saved');
  };

  const updateCard = (updated) => {
    setCards(prev => prev.map(c => c.id === updated.id ? updated : c));
    showToast('Card updated');
  };

  const deleteCard  = (id)   => { setCards(prev => prev.filter(c => c.id !== id)); showToast('Card deleted'); };
  const toggleFav   = (card) => { setCards(prev => prev.map(c => c.id === card.id ? { ...c, favorite: !c.favorite } : c)); };

  const applyRating = (quality) => {
    const card = studyDeck[studyIdx];
    setCards(prev => prev.map(c => c.id === card.id ? { ...c, srs: nextReview(c, quality) } : c));
    if (studyIdx + 1 >= studyDeck.length) { showToast('Session complete'); setView('library'); }
    else { setStudyIdx(studyIdx + 1); setFlipped(false); }
  };

  const filtered = useMemo(() => cards.filter(c => {
    if (filterPOS !== 'all' && c.pos !== filterPOS) return false;
    if (filterFav && !c.favorite) return false;
    if (search) {
      const q = search.toLowerCase();
      return c.word.toLowerCase().includes(q) || c.meaning.toLowerCase().includes(q) || (c.example || '').toLowerCase().includes(q);
    }
    return true;
  }), [cards, search, filterPOS, filterFav]);

  const dueCount = useMemo(() => {
    const now = Date.now();
    return cards.filter(c => !c.srs?.dueAt || c.srs.dueAt <= now).length;
  }, [cards]);

  const capacityPct = Math.round((cards.length / MAX_CARDS) * 100);

  const startStudy = (mode) => {
    let deck = [...cards];
    const now = Date.now();
    if (mode === 'due')           deck = deck.filter(c => !c.srs?.dueAt || c.srs.dueAt <= now);
    else if (mode === 'favorites') deck = deck.filter(c => c.favorite);
    if (!deck.length) { showToast('No cards in this set'); return; }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    setStudyDeck(deck); setStudyIdx(0); setFlipped(false); setView('study');
  };

  const startQuiz = () => {
    if (cards.length < 4) { showToast('Need at least 4 cards for quiz'); return; }
    setView('quiz');
  };

  const speak = (text) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, fontFamily: '"Cormorant Garamond","EB Garamond",Georgia,serif', transition: 'background 0.4s,color 0.4s' }}>
      <div className="paper-bg" style={{ minHeight: '100vh' }}>

        {/* HEADER */}
        <header style={{ borderBottom: `1px solid ${theme.border}`, background: theme.surface }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', cursor: 'pointer' }} onClick={() => setView('library')}>
              <div style={{ width: 44, height: 44, background: theme.accent, color: dark ? '#1a1612' : '#fdf9ef', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: '1.4rem', fontStyle: 'italic' }}>L</div>
              <div>
                <h1 className="display-font" style={{ margin: 0, fontSize: '1.7rem', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1 }}>Lexicon</h1>
                <div className="mono-font" style={{ fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginTop: 4 }}>a vocabulary journal</div>
              </div>
            </div>
            <nav style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn hide-mobile" onClick={() => setView('library')} style={view === 'library' ? { background: theme.surfaceAlt, fontWeight: 600 } : {}}><BookOpen size={15} /> Library</button>
              <button className="btn hide-mobile" onClick={() => setView('collection')} style={view === 'collection' ? { background: theme.surfaceAlt, fontWeight: 600 } : {}}><LibraryIcon size={15} /> Collection</button>
              <button className="btn hide-mobile" onClick={() => setView('stats')} style={view === 'stats' ? { background: theme.surfaceAlt, fontWeight: 600 } : {}}><TrendingUp size={15} /> Progress</button>
              <button className="btn" onClick={() => setDark(!dark)}>{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
              <button className="btn btn-primary" onClick={() => { setEditingCard(null); setShowForm(true); }} disabled={cards.length >= MAX_CARDS}><Plus size={15} /> New</button>
            </nav>
          </div>
          {capacityPct >= 50 && (
            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 1.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ flex: 1, height: 3, background: theme.border }}>
                <div style={{ height: '100%', width: `${capacityPct}%`, background: capacityPct >= 90 ? '#c1666b' : theme.accent, transition: 'width 0.4s' }} />
              </div>
              <div className="mono-font" style={{ fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: capacityPct >= 90 ? '#c1666b' : theme.textMuted, whiteSpace: 'nowrap' }}>{cards.length} / {MAX_CARDS}</div>
            </div>
          )}
        </header>

        {/* MAIN */}
        <main style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '4rem', color: theme.textMuted }}>
              <div className="display-font" style={{ fontSize: '1.5rem', fontStyle: 'italic' }}>Opening journal…</div>
            </div>
          ) : view === 'library' ? (
            <Library
              cards={cards} filtered={filtered} theme={theme} dark={dark}
              search={search} setSearch={setSearch} filterPOS={filterPOS} setFilterPOS={setFilterPOS}
              filterFav={filterFav} setFilterFav={setFilterFav}
              onEdit={c => { setEditingCard(c); setShowForm(true); }}
              onDelete={deleteCard} onToggleFav={toggleFav} onSpeak={speak}
              onStudy={startStudy} onQuiz={startQuiz} onCollection={() => setView('collection')} dueCount={dueCount}
            />
          ) : view === 'collection' ? (
            <CollectionView cards={cards} theme={theme} dark={dark} onBack={() => setView('library')} onQuiz={startQuiz} />
          ) : view === 'study' ? (
            <StudyView
              card={studyDeck[studyIdx]} idx={studyIdx} total={studyDeck.length}
              flipped={flipped} setFlipped={setFlipped} theme={theme} dark={dark}
              onRate={applyRating} onExit={() => setView('library')} onSpeak={speak}
              onPrev={() => { if (studyIdx > 0) { setStudyIdx(studyIdx - 1); setFlipped(false); } }}
              onNext={() => { if (studyIdx + 1 < studyDeck.length) { setStudyIdx(studyIdx + 1); setFlipped(false); } else setView('library'); }}
            />
          ) : view === 'quiz' ? (
            <QuizView cards={cards} theme={theme} dark={dark} onExit={() => setView('library')} />
          ) : view === 'stats' ? (
            <StatsView cards={cards} theme={theme} />
          ) : null}
        </main>

        {/* FORM */}
        {showForm && (
          <CardForm
            theme={theme} dark={dark} initial={editingCard}
            onSave={data => {
              editingCard ? updateCard({ ...editingCard, ...data }) : addCard(data);
              setShowForm(false); setEditingCard(null);
            }}
            onCancel={() => { setShowForm(false); setEditingCard(null); }}
          />
        )}

        {/* TOAST */}
        {toast && (
          <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: theme.text, color: theme.bg, padding: '0.7rem 1.4rem', fontFamily: 'Fraunces,serif', fontSize: '0.95rem', borderRadius: 2, zIndex: 100, animation: 'fadeIn 0.3s', whiteSpace: 'nowrap' }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Card Form ─────────────────────────────────────────────
function CardForm({ theme, dark, initial, onSave, onCancel }) {
  const [word,    setWord]    = useState(initial?.word    || '');
  const [pos,     setPos]     = useState(initial?.pos     || 'noun');
  const [meaning, setMeaning] = useState(initial?.meaning || '');
  const [example, setExample] = useState(initial?.example || '');

  const [lookupState,   setLookupState]   = useState('idle'); // idle | loading | results | error
  const [lookupResults, setLookupResults] = useState([]);
  const [selectedIdx,   setSelectedIdx]   = useState(null);
  const [exampleState,  setExampleState]  = useState('idle'); // idle | loading | done | error

  const handleLookup = async () => {
    if (!word.trim()) return;
    setLookupState('loading'); setLookupResults([]); setSelectedIdx(null);
    try {
      const results = await lookupWord(word.trim());
      setLookupResults(results);
      setLookupState('results');
      // Auto-select first result
      setPos(results[0].pos);
      setMeaning(results[0].meaning);
      setExample(results[0].example || '');
      setSelectedIdx(0);
    } catch (e) {
      console.error(e);
      setLookupState('error');
    }
  };

  const selectResult = (idx) => {
    const r = lookupResults[idx];
    setSelectedIdx(idx); setPos(r.pos); setMeaning(r.meaning); setExample(r.example || '');
  };

  const handleGenerateExample = async () => {
    if (!word.trim() || !meaning.trim()) return;
    setExampleState('loading');
    try {
      const text = await generateExample(word.trim(), pos, meaning);
      setExample(text); setExampleState('done');
    } catch { setExampleState('error'); }
  };

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} className="scale-in" style={{ background: theme.surface, border: `1px solid ${theme.border}`, padding: '2rem', maxWidth: 580, width: '100%', maxHeight: '92vh', overflow: 'auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <h2 className="display-font" style={{ margin: 0, fontSize: '1.7rem', fontWeight: 600, fontStyle: 'italic' }}>{initial ? 'Edit entry' : 'New entry'}</h2>
            <div className="mono-font" style={{ fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginTop: 4 }}>add to your lexicon</div>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.text }}><X size={22} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Word + Lookup */}
          <Field label="Word" theme={theme}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input className="input-field" value={word}
                onChange={e => { setWord(e.target.value); setLookupState('idle'); }}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
                autoFocus placeholder="e.g. ephemeral" style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={handleLookup}
                disabled={!word.trim() || lookupState === 'loading'}
                style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                {lookupState === 'loading' ? <Loader size={14} className="spin" /> : <Search size={14} />}
                Look up
              </button>
            </div>
            {lookupState === 'loading' && (
              <div className="mono-font" style={{ fontSize: '0.75rem', color: theme.textMuted, marginTop: 6, fontStyle: 'italic' }}>
                Searching dictionary… this takes a few seconds
              </div>
            )}
          </Field>

          {/* Lookup error */}
          {lookupState === 'error' && (
            <div style={{ padding: '0.75rem 1rem', background: theme.surfaceAlt, borderLeft: `3px solid #c1666b`, fontSize: '0.95rem', color: theme.textMuted, fontStyle: 'italic' }}>
              Could not find that word — fill in the fields manually below.
            </div>
          )}

          {/* Lookup results */}
          {lookupState === 'results' && lookupResults.length > 0 && (
            <div>
              <div className="mono-font" style={{ fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginBottom: '0.5rem' }}>
                {lookupResults.length} definition{lookupResults.length > 1 ? 's' : ''} found — click one to use it
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: 220, overflow: 'auto' }}>
                {lookupResults.map((r, i) => (
                  <div key={i}
                    className={`lookup-result${selectedIdx === i ? ' selected' : ''}`}
                    onClick={() => selectResult(i)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                      <span className="pos-pill" style={{ background: POS_COLORS[r.pos]?.accent || theme.accent, color: dark ? '#1a1612' : '#fdf9ef', fontSize: '0.6rem' }}>{r.pos}</span>
                    </div>
                    <div style={{ fontSize: '0.95rem', lineHeight: 1.45 }}>{r.meaning}</div>
                    {r.example && <div style={{ fontSize: '0.85rem', color: theme.textMuted, fontStyle: 'italic', marginTop: '0.2rem' }}>"{r.example}"</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* POS */}
          <Field label="Part of speech" theme={theme}>
            <select className="input-field" value={pos} onChange={e => setPos(e.target.value)} style={{ cursor: 'pointer' }}>
              {POS_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>

          {/* Meaning */}
          <Field label="Meaning" theme={theme}>
            <textarea className="input-field" value={meaning} onChange={e => setMeaning(e.target.value)}
              rows={2} placeholder="What does it mean?" style={{ resize: 'vertical', fontFamily: 'inherit' }} />
          </Field>

          {/* Example + AI generate */}
          <Field label="Example sentence" theme={theme} optional hint="Each line stays on its own line on the card.">
            <textarea className="input-field" value={example} onChange={e => setExample(e.target.value)}
              rows={3} placeholder="Use it in a sentence…" style={{ resize: 'vertical', fontFamily: 'inherit', fontStyle: 'italic' }} />
            <button className="btn" onClick={handleGenerateExample}
              disabled={!word.trim() || !meaning.trim() || exampleState === 'loading'}
              style={{ marginTop: '0.5rem', fontSize: '0.85rem', padding: '0.45rem 0.9rem' }}>
              {exampleState === 'loading'
                ? <><Loader size={13} className="spin" /> Generating…</>
                : <><Wand2 size={13} /> AI generate examples</>}
            </button>
            {exampleState === 'error' && (
              <div style={{ fontSize: '0.85rem', color: '#c1666b', marginTop: '0.3rem', fontStyle: 'italic' }}>Generation failed — try again or write manually.</div>
            )}
          </Field>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.8rem' }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary"
            onClick={() => { if (word.trim() && meaning.trim()) onSave({ word: word.trim(), pos, meaning: meaning.trim(), example: example.trim() }); }}
            disabled={!word.trim() || !meaning.trim()}>
            {initial ? 'Save changes' : 'Add to journal'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, theme, optional, hint }) {
  return (
    <label style={{ display: 'block' }}>
      <div className="mono-font" style={{ fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginBottom: 6 }}>
        {label}{optional && <span style={{ opacity: 0.5 }}> · optional</span>}
      </div>
      {children}
      {hint && <div style={{ fontSize: '0.85rem', color: theme.textMuted, marginTop: 4, fontStyle: 'italic' }}>{hint}</div>}
    </label>
  );
}

// ── Library ───────────────────────────────────────────────
function Library({ cards, filtered, theme, dark, search, setSearch, filterPOS, setFilterPOS, filterFav, setFilterFav, onEdit, onDelete, onToggleFav, onSpeak, onStudy, onQuiz, onCollection, dueCount }) {
  return (
    <div className="fade-in">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
        <StatTile theme={theme} icon={<BookOpen size={18} />} label="Words collected" value={cards.length} />
        <StatTile theme={theme} icon={<Flame size={18} />}   label="Due for review"  value={dueCount} highlight />
        <StatTile theme={theme} icon={<Star size={18} />}    label="Favorites"        value={cards.filter(c => c.favorite).length} />
        <StatTile theme={theme} icon={<Brain size={18} />}   label="Mastered"         value={cards.filter(c => (c.srs?.reps || 0) >= 4).length} />
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '2rem', paddingBottom: '2rem', borderBottom: `1px solid ${theme.border}` }}>
        <button className="btn btn-primary" onClick={() => onStudy('due')} disabled={dueCount === 0}><Sparkles size={15} /> Review due ({dueCount})</button>
        <button className="btn" onClick={() => onStudy('all')} disabled={!cards.length}><Shuffle size={15} /> Shuffle all</button>
        <button className="btn" onClick={() => onStudy('favorites')} disabled={!cards.filter(c => c.favorite).length}><Star size={15} /> Favorites only</button>
        <button className="btn" onClick={onQuiz} disabled={cards.length < 4}><Target size={15} /> Quiz mode</button>
        <button className="btn" onClick={onCollection} disabled={!cards.length}><LibraryIcon size={15} /> Collection</button>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '2rem' }}>
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 480 }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: theme.textMuted }} />
          <input className="input-field" placeholder="Search words, meanings, examples…" value={search}
            onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
        </div>
        <select className="input-field" value={filterPOS} onChange={e => setFilterPOS(e.target.value)} style={{ flex: '0 1 180px', cursor: 'pointer' }}>
          <option value="all">All parts of speech</option>
          {POS_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn" onClick={() => setFilterFav(!filterFav)}
          style={filterFav ? { background: theme.accent, color: '#fdf9ef', borderColor: theme.accent } : {}}>
          <Star size={15} fill={filterFav ? 'currentColor' : 'none'} /> Favorites
        </button>
      </div>
      {!cards.length ? <EmptyState theme={theme} /> : !filtered.length ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: theme.textMuted, fontStyle: 'italic' }}>No cards match your filters.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: '1.25rem' }}>
          {filtered.map(card => (
            <FlashCard key={card.id} card={card} theme={theme} dark={dark}
              onEdit={onEdit} onDelete={onDelete} onToggleFav={onToggleFav} onSpeak={onSpeak} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Collection View ───────────────────────────────────────
function CollectionView({ cards, theme, dark, onBack, onQuiz }) {
  const [search, setSearch]       = useState('');
  const [filterPOS, setFilterPOS] = useState('all');

  const visible = useMemo(() =>
    [...cards]
      .sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()))
      .filter(c => {
        if (filterPOS !== 'all' && c.pos !== filterPOS) return false;
        if (search) {
          const q = search.toLowerCase();
          return c.word.toLowerCase().includes(q) || c.meaning.toLowerCase().includes(q) || (c.example || '').toLowerCase().includes(q);
        }
        return true;
      }),
    [cards, search, filterPOS]);

  if (!cards.length) return (
    <div className="fade-in">
      <button className="btn" onClick={onBack} style={{ marginBottom: '2rem' }}><ArrowLeft size={15} /> Back</button>
      <EmptyState theme={theme} />
    </div>
  );

  return (
    <div className="fade-in">
      <button className="btn" onClick={onBack} style={{ marginBottom: '2rem' }}><ArrowLeft size={15} /> Back to library</button>
      <div style={{ marginBottom: '2.5rem' }}>
        <div className="mono-font" style={{ fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginBottom: '0.3rem' }}>Word library</div>
        <h2 className="display-font" style={{ margin: 0, fontSize: '2.5rem', fontWeight: 600, fontStyle: 'italic' }}>Your collection</h2>
        <p style={{ color: theme.textMuted, marginTop: '0.5rem', fontSize: '1.05rem' }}>{cards.length} {cards.length === 1 ? 'word' : 'words'}, sorted alphabetically.</p>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '2rem' }}>
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 480 }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: theme.textMuted }} />
          <input className="input-field" placeholder="Search…" value={search}
            onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
        </div>
        <select className="input-field" value={filterPOS} onChange={e => setFilterPOS(e.target.value)} style={{ flex: '0 1 180px', cursor: 'pointer' }}>
          <option value="all">All parts of speech</option>
          {POS_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn btn-primary" onClick={onQuiz} disabled={cards.length < 4}><Target size={15} /> Quiz mode</button>
      </div>
      {!visible.length ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: theme.textMuted, fontStyle: 'italic' }}>No matches.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {visible.map(c => <CollectionEntry key={c.id} card={c} theme={theme} dark={dark} />)}
        </div>
      )}
    </div>
  );
}

function CollectionEntry({ card, theme, dark }) {
  const accent = POS_COLORS[card.pos]?.accent || theme.accent;
  return (
    <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderLeft: `3px solid ${accent}`, padding: '1.25rem 1.5rem', transition: 'transform 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.transform = 'translateX(2px)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'translateX(0)'}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <h3 className="display-font" style={{ margin: 0, fontSize: '1.6rem', fontWeight: 600, fontStyle: 'italic', color: theme.text }}>{card.word}</h3>
        <span className="pos-pill" style={{ background: accent, color: dark ? '#1a1612' : '#fdf9ef' }}>{card.pos}</span>
        {card.favorite && <Star size={14} fill="#d4a574" style={{ color: '#d4a574' }} />}
      </div>
      <p style={{ margin: 0, fontSize: '1.05rem', lineHeight: 1.5 }}>{card.meaning}</p>
      {card.example && (
        <div style={{ marginTop: '0.6rem', fontSize: '0.95rem', lineHeight: 1.55, color: theme.textMuted, borderLeft: `2px solid ${theme.border}`, paddingLeft: '0.75rem' }}>
          <MultilineText text={card.example} italic />
        </div>
      )}
    </div>
  );
}

// ── Shared components ─────────────────────────────────────
function StatTile({ theme, icon, label, value, highlight }) {
  return (
    <div style={{ padding: '1.2rem 1.3rem', borderRadius: 2, background: highlight ? theme.accent : theme.surface, color: highlight ? (theme.bg === '#1a1612' ? '#1a1612' : '#fdf9ef') : theme.text, border: `1px solid ${highlight ? theme.accent : theme.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: 0.8, marginBottom: 6 }}>
        {icon}<span className="mono-font" style={{ fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div className="display-font" style={{ fontSize: '2.2rem', fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'oldstyle-nums' }}>{value}</div>
    </div>
  );
}

function EmptyState({ theme }) {
  return (
    <div style={{ textAlign: 'center', padding: '5rem 1rem' }}>
      <div className="ornament" style={{ marginBottom: '1.5rem' }} />
      <h2 className="display-font" style={{ fontSize: '2rem', fontWeight: 500, fontStyle: 'italic', margin: '0 0 0.5rem' }}>Your journal awaits</h2>
      <p style={{ color: theme.textMuted, fontSize: '1.1rem', maxWidth: 420, margin: '0 auto' }}>Add your first word to begin building a personal lexicon you'll actually remember.</p>
    </div>
  );
}

function FlashCard({ card, theme, dark, onEdit, onDelete, onToggleFav, onSpeak }) {
  const [flipped, setFlipped] = useState(false);
  const palette = POS_COLORS[card.pos] || POS_COLORS.noun;
  const accent  = dark ? theme.accent : palette.accent;
  return (
    <div className="card-flip scale-in" style={{ height: 280 }}>
      <div className={`card-flip-inner ${flipped ? 'flipped' : ''}`}>
        <div className="card-face" style={{ background: dark ? theme.surface : palette.bg, border: `1px solid ${theme.border}`, padding: '1.3rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: dark ? theme.text : palette.text, boxShadow: dark ? '0 1px 0 rgba(255,255,255,0.04)' : '0 1px 0 rgba(0,0,0,0.04),0 8px 16px -8px rgba(92,58,33,0.15)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="pos-pill" style={{ background: accent, color: dark ? '#1a1612' : '#fdf9ef' }}>{card.pos}</span>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <IconBtn onClick={e => { e.stopPropagation(); onSpeak(card.word); }} title="Pronounce"><Volume2 size={14} /></IconBtn>
              <IconBtn onClick={e => { e.stopPropagation(); onToggleFav(card); }} title="Favorite">
                <Star size={14} fill={card.favorite ? 'currentColor' : 'none'} style={{ color: card.favorite ? '#d4a574' : 'inherit' }} />
              </IconBtn>
            </div>
          </div>
          <div onClick={() => setFlipped(true)} style={{ cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0.5rem 0' }}>
            <h3 className="display-font" style={{ margin: 0, fontSize: '2rem', fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.05, fontStyle: 'italic' }}>{card.word}</h3>
            <p style={{ margin: '0.6rem 0 0', fontSize: '0.98rem', lineHeight: 1.45, opacity: 0.85, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{card.meaning}</p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${dark ? theme.border : 'rgba(0,0,0,0.08)'}`, paddingTop: '0.6rem' }}>
            <button onClick={() => setFlipped(true)} style={{ background: 'none', border: 'none', fontFamily: 'JetBrains Mono,monospace', fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'inherit', opacity: 0.6, cursor: 'pointer' }}>tap to reveal example →</button>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <IconBtn onClick={e => { e.stopPropagation(); onEdit(card); }} title="Edit"><Edit2 size={12} /></IconBtn>
              <IconBtn onClick={e => { e.stopPropagation(); if (confirm('Delete this card?')) onDelete(card.id); }} title="Delete"><Trash2 size={12} /></IconBtn>
            </div>
          </div>
        </div>
        <div className="card-face card-back" onClick={() => setFlipped(false)} style={{ background: dark ? theme.surfaceAlt : '#fdf9ef', border: `1px solid ${theme.border}`, borderLeft: `4px solid ${accent}`, padding: '1.3rem', color: theme.text, cursor: 'pointer', display: 'flex', flexDirection: 'column' }}>
          <div className="mono-font" style={{ fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginBottom: '0.5rem' }}>example · usage</div>
          <div className="display-font" style={{ fontSize: '1.1rem', lineHeight: 1.55, margin: 0, flex: 1, overflow: 'auto' }}>
            <MultilineText text={card.example || 'No example provided.'} italic />
          </div>
          <div className="mono-font" style={{ fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: theme.textMuted, marginTop: '0.6rem', textAlign: 'right' }}>← tap to flip back</div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{ background: 'rgba(0,0,0,0.06)', border: 'none', width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'inherit', transition: 'background 0.2s' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.12)'}
      onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.06)'}
    >{children}</button>
  );
}

// ── Study View ────────────────────────────────────────────
function StudyView({ card, idx, total, flipped, setFlipped, theme, dark, onRate, onExit, onSpeak, onPrev, onNext }) {
  if (!card) return null;
  const palette = POS_COLORS[card.pos] || POS_COLORS.noun;
  const accent  = dark ? theme.accent : palette.accent;
  return (
    <div className="fade-in" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <button className="btn" onClick={onExit}><ChevronLeft size={15} /> Exit</button>
        <div className="mono-font" style={{ fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted }}>{idx + 1} of {total}</div>
      </div>
      <div style={{ height: 2, background: theme.border, marginBottom: '2rem', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${((idx + 1) / total) * 100}%`, background: theme.accent, transition: 'width 0.4s' }} />
      </div>
      <div className="card-flip" style={{ height: 460, marginBottom: '2rem' }}>
        <div className={`card-flip-inner ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(!flipped)} style={{ cursor: 'pointer' }}>
          <div className="card-face" style={{ background: dark ? theme.surface : palette.bg, color: dark ? theme.text : palette.text, border: `1px solid ${theme.border}`, padding: '2.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: dark ? 'none' : '0 20px 40px -20px rgba(92,58,33,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="pos-pill" style={{ background: accent, color: dark ? '#1a1612' : '#fdf9ef' }}>{card.pos}</span>
              <button onClick={e => { e.stopPropagation(); onSpeak(card.word); }} style={{ background: 'rgba(0,0,0,0.08)', border: 'none', borderRadius: '50%', width: 36, height: 36, cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Volume2 size={16} /></button>
            </div>
            <div style={{ textAlign: 'center' }}>
              <h2 className="display-font" style={{ margin: 0, fontSize: 'clamp(2.5rem,7vw,4rem)', fontWeight: 600, fontStyle: 'italic', letterSpacing: '-0.02em', lineHeight: 1 }}>{card.word}</h2>
              <p className="display-font" style={{ fontSize: '1.3rem', margin: '1.5rem 0 0', lineHeight: 1.5, opacity: 0.85 }}>{card.meaning}</p>
            </div>
            <div className="mono-font" style={{ textAlign: 'center', fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.6 }}>tap for example →</div>
          </div>
          <div className="card-face card-back" style={{ background: dark ? theme.surfaceAlt : '#fdf9ef', color: theme.text, border: `1px solid ${theme.border}`, borderLeft: `4px solid ${accent}`, padding: '2.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="mono-font" style={{ fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginBottom: '1.5rem', textAlign: 'center' }}>example</div>
            <div className="display-font" style={{ fontSize: 'clamp(1.2rem,2.6vw,1.55rem)', lineHeight: 1.6, maxHeight: '60vh', overflow: 'auto' }}>
              <MultilineText text={card.example || 'No example provided.'} italic />
            </div>
          </div>
        </div>
      </div>
      {flipped ? (
        <div>
          <div className="mono-font" style={{ textAlign: 'center', fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginBottom: '0.75rem' }}>How well did you remember it?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.5rem' }}>
            <RateBtn theme={theme} label="Again" sub="< 1m" color="#c1666b" onClick={() => onRate(0)} />
            <RateBtn theme={theme} label="Hard"  sub="~1d"  color="#d4a574" onClick={() => onRate(3)} />
            <RateBtn theme={theme} label="Good"  sub="~3d"  color="#8aa884" onClick={() => onRate(4)} />
            <RateBtn theme={theme} label="Easy"  sub="~7d"  color="#5a8a8a" onClick={() => onRate(5)} />
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
          <button className="btn" onClick={onPrev} disabled={idx === 0}><ChevronLeft size={15} /> Previous</button>
          <button className="btn btn-primary" onClick={() => setFlipped(true)} style={{ flex: 1, justifyContent: 'center' }}>Show answer</button>
          <button className="btn" onClick={onNext}>Skip <ChevronRight size={15} /></button>
        </div>
      )}
    </div>
  );
}

function RateBtn({ theme, label, sub, color, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: '0.85rem 0.5rem', background: theme.surface, border: `1px solid ${theme.border}`, borderTop: `3px solid ${color}`, cursor: 'pointer', color: theme.text, fontFamily: 'Fraunces,serif', transition: 'transform 0.15s,background 0.2s', borderRadius: 2 }}
      onMouseEnter={e => { e.currentTarget.style.background = theme.surfaceAlt; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = theme.surface;    e.currentTarget.style.transform = 'translateY(0)'; }}>
      <div style={{ fontSize: '1rem', fontWeight: 600 }}>{label}</div>
      <div className="mono-font" style={{ fontSize: '0.65rem', letterSpacing: '0.1em', color: theme.textMuted, marginTop: 2 }}>{sub}</div>
    </button>
  );
}

// ── Quiz ──────────────────────────────────────────────────
function QuizView({ cards, theme, dark, onExit }) {
  const [questions] = useState(() => {
    const shuffled = [...cards].sort(() => Math.random() - 0.5).slice(0, Math.min(10, cards.length));
    return shuffled.map(correct => {
      const distractors = cards.filter(c => c.id !== correct.id).sort(() => Math.random() - 0.5).slice(0, 3);
      return { correct, options: [...distractors, correct].sort(() => Math.random() - 0.5) };
    });
  });
  const [qIdx,   setQIdx]   = useState(0);
  const [picked, setPicked] = useState(null);
  const [score,  setScore]  = useState(0);
  const [done,   setDone]   = useState(false);

  if (done) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div className="fade-in" style={{ maxWidth: 520, margin: '4rem auto', textAlign: 'center' }}>
        <div className="ornament" style={{ marginBottom: '1rem' }} />
        <h2 className="display-font" style={{ fontSize: '2.5rem', fontWeight: 600, fontStyle: 'italic', margin: '0 0 0.5rem' }}>
          {pct >= 80 ? 'Magnificent.' : pct >= 50 ? 'Not bad.' : 'Keep at it.'}
        </h2>
        <p className="display-font" style={{ fontSize: '1.4rem', color: theme.textMuted, marginBottom: '2rem' }}>You scored {score} of {questions.length}</p>
        <button className="btn btn-primary" onClick={onExit}>Back to library</button>
      </div>
    );
  }

  const q = questions[qIdx];
  const pick = (opt) => {
    if (picked) return;
    setPicked(opt);
    if (opt.id === q.correct.id) setScore(s => s + 1);
    setTimeout(() => {
      if (qIdx + 1 >= questions.length) setDone(true);
      else { setQIdx(qIdx + 1); setPicked(null); }
    }, 1100);
  };

  return (
    <div className="fade-in" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <button className="btn" onClick={onExit}><ChevronLeft size={15} /> Exit</button>
        <div className="mono-font" style={{ fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted }}>Question {qIdx + 1} of {questions.length} · Score {score}</div>
      </div>
      <div className="scale-in" style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <div className="mono-font" style={{ fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginBottom: '1rem' }}>What does this word mean?</div>
        <h2 className="display-font" style={{ fontSize: 'clamp(2.5rem,7vw,4rem)', fontWeight: 600, fontStyle: 'italic', margin: 0, letterSpacing: '-0.02em' }}>{q.correct.word}</h2>
        <span className="pos-pill" style={{ background: theme.accent, color: dark ? '#1a1612' : '#fdf9ef', marginTop: '1rem', display: 'inline-block' }}>{q.correct.pos}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {q.options.map((opt, i) => {
          const isCorrect = opt.id === q.correct.id;
          const isPicked  = picked?.id === opt.id;
          let bg = theme.surface, border = theme.border;
          if (picked) { if (isCorrect) { bg = '#d4e6c8'; border = '#8aa884'; } else if (isPicked) { bg = '#e6c8c8'; border = '#c1666b'; } }
          return (
            <button key={opt.id} onClick={() => pick(opt)} disabled={!!picked}
              style={{ padding: '1rem 1.25rem', background: bg, border: `1px solid ${border}`, color: picked && (isCorrect || isPicked) ? '#2d2418' : theme.text, fontFamily: 'Cormorant Garamond,serif', fontSize: '1.1rem', textAlign: 'left', cursor: picked ? 'default' : 'pointer', transition: 'all 0.2s', borderRadius: 2 }}
              onMouseEnter={e => { if (!picked) e.currentTarget.style.background = theme.surfaceAlt; }}
              onMouseLeave={e => { if (!picked) e.currentTarget.style.background = bg; }}>
              <span className="mono-font" style={{ marginRight: '0.75rem', opacity: 0.5, fontSize: '0.85rem' }}>{String.fromCharCode(65 + i)}</span>
              {opt.meaning}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Stats ─────────────────────────────────────────────────
function StatsView({ cards, theme }) {
  const now    = Date.now();
  const byPOS  = POS_OPTIONS.map(p => ({ pos: p, count: cards.filter(c => c.pos === p).length })).filter(x => x.count > 0);
  const maxPOS = Math.max(1, ...byPOS.map(x => x.count));
  return (
    <div className="fade-in" style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{ marginBottom: '3rem' }}>
        <div className="mono-font" style={{ fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginBottom: '0.3rem' }}>Your progress</div>
        <h2 className="display-font" style={{ margin: 0, fontSize: '2.5rem', fontWeight: 600, fontStyle: 'italic' }}>The journal so far</h2>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '1rem', marginBottom: '3rem' }}>
        <BigStat theme={theme} value={cards.length}                                                   label="Total words" />
        <BigStat theme={theme} value={cards.filter(c => c.srs?.reps > 0).length}                     label="Reviewed"    />
        <BigStat theme={theme} value={cards.filter(c => (c.srs?.reps || 0) >= 4).length}             label="Mastered"    />
        <BigStat theme={theme} value={cards.filter(c => c.favorite).length}                          label="Favorites"   />
        <BigStat theme={theme} value={cards.filter(c => !c.srs?.dueAt || c.srs.dueAt <= now).length} label="Due now"     />
      </div>
      {byPOS.length > 0 && (
        <div style={{ background: theme.surface, padding: '2rem', border: `1px solid ${theme.border}` }}>
          <div className="mono-font" style={{ fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginBottom: '1.5rem' }}>Distribution by part of speech</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {byPOS.map(({ pos, count }) => (
              <div key={pos}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span className="display-font" style={{ fontSize: '1.1rem', fontStyle: 'italic' }}>{pos}</span>
                  <span className="mono-font" style={{ fontSize: '0.85rem', color: theme.textMuted }}>{count}</span>
                </div>
                <div style={{ height: 6, background: theme.border }}>
                  <div style={{ height: '100%', width: `${(count / maxPOS) * 100}%`, background: POS_COLORS[pos]?.accent || theme.accent, transition: 'width 0.6s ease-out' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!cards.length && <div style={{ textAlign: 'center', padding: '3rem', color: theme.textMuted, fontStyle: 'italic' }}>Add some words first to see your progress.</div>}
    </div>
  );
}

function BigStat({ theme, value, label }) {
  return (
    <div style={{ padding: '1.25rem', background: theme.surface, border: `1px solid ${theme.border}` }}>
      <div className="display-font" style={{ fontSize: '2.5rem', fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'oldstyle-nums' }}>{value}</div>
      <div className="mono-font" style={{ fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: theme.textMuted, marginTop: 6 }}>{label}</div>
    </div>
  );
}
