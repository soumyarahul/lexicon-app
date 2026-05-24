import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search, Plus, Edit2, Trash2, Star, Shuffle, Volume2, X,
  Moon, Sun, BookOpen, Brain, Sparkles, ChevronLeft, ChevronRight,
  Target, Flame, TrendingUp, Library as LibraryIcon, ArrowLeft,
  Wand2, Loader, Settings, Key, CheckCircle, MessageSquareQuote,
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

// ── Firebase ──────────────────────────────────────────────
const firebaseApp = initializeApp({
  apiKey: "AIzaSyAvh-m7Xig7YYlW2YLOuREj9QbU2_2Sw2w",
  authDomain: "vocabulary-app-491d9.firebaseapp.com",
  projectId: "vocabulary-app-491d9",
  storageBucket: "vocabulary-app-491d9.firebasestorage.app",
  messagingSenderId: "787827046297",
  appId: "1:787827046297:web:e76cdffb31662bf3798508",
  measurementId: "G-69H9THXTK5",
});
const db = getFirestore(firebaseApp);
const CARDS_DOC  = doc(db, 'lexicon', 'cards');
const IDIOMS_DOC = doc(db, 'lexicon', 'idioms');   // ← new, separate doc

async function loadFromFirebase() {
  const snap = await getDoc(CARDS_DOC);
  if (snap.exists()) {
    const d = snap.data();
    if (Array.isArray(d.cards)) return d.cards;
  }
  return [];
}

async function saveToFirebase(cards) {
  await setDoc(CARDS_DOC, { cards, updatedAt: Date.now() });
}

// ── Idiom Firebase helpers ────────────────────────────────
async function loadIdiomsFromFirebase() {
  const snap = await getDoc(IDIOMS_DOC);
  if (snap.exists()) {
    const d = snap.data();
    if (Array.isArray(d.idioms)) return d.idioms;
  }
  return [];
}

async function saveIdiomsToFirebase(idioms) {
  await setDoc(IDIOMS_DOC, { idioms, updatedAt: Date.now() });
}

// ── API key (localStorage, per-device) ───────────────────
const API_KEY_STORAGE = 'lexicon_api_key';
const getApiKey = () => localStorage.getItem(API_KEY_STORAGE) || '';
const saveApiKey = (k) => localStorage.setItem(API_KEY_STORAGE, k.trim());

// ── Claude API ────────────────────────────────────────────
async function claudePost(body, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }
  return res.json();
}

async function lookupWord(word, apiKey) {
  const data = await claudePost({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `Look up the English word "${word}" and return its definitions.
Respond ONLY with a raw JSON array — no markdown, no backticks, no explanation.
Each item must have exactly these keys:
  "pos": one of noun/verb/adjective/adverb/pronoun/preposition/conjunction/interjection
  "meaning": plain English definition
  "example": one short example sentence, or empty string
Include up to 3 definitions. Example output:
[{"pos":"noun","meaning":"lasting for a very short time","example":"The ephemeral beauty of cherry blossoms."}]`,
    }],
  }, apiKey);

  const textBlock = [...(data.content || [])].reverse().find(b => b.type === 'text');
  if (!textBlock?.text) throw new Error('No response from API');
  const raw = textBlock.text.trim().replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('Empty result');
  return parsed;
}

async function generateExample(word, pos, meaning, apiKey) {
  const data = await claudePost({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Write exactly 2 clear, natural example sentences for the word "${word}" used as a ${pos} (meaning: ${meaning}). Output only the 2 sentences, one per line, no numbering, no extra text.`,
    }],
  }, apiKey);
  return data.content?.[0]?.text?.trim() || '';
}

// ── Idiom AI lookup ───────────────────────────────────────
async function lookupIdiom(phrase, apiKey) {
  const data = await claudePost({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `Look up the English idiom or phrase "${phrase}" and return information about it.
Respond ONLY with a raw JSON object — no markdown, no backticks, no explanation.
The object must have exactly these keys:
  "meaning": plain English explanation of what the idiom means
  "example": one natural example sentence using the idiom
  "origin": brief origin or background of the idiom (1-2 sentences), or empty string if unknown
Example output:
{"meaning":"To do something that causes more harm than good while trying to help","example":"By rewriting the whole module, he really let the cat out of the bag about our release date.","origin":"Possibly from 18th-century market fraud, where a piglet was switched for a cat in a bag."}`,
    }],
  }, apiKey);

  const textBlock = [...(data.content || [])].reverse().find(b => b.type === 'text');
  if (!textBlock?.text) throw new Error('No response from API');
  const raw = textBlock.text.trim().replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  const parsed = JSON.parse(raw);
  if (!parsed.meaning) throw new Error('Empty result');
  return parsed;
}

async function generateIdiomExample(phrase, meaning, apiKey) {
  const data = await claudePost({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Write exactly 2 clear, natural example sentences using the idiom "${phrase}" (meaning: ${meaning}). Output only the 2 sentences, one per line, no numbering, no extra text.`,
    }],
  }, apiKey);
  return data.content?.[0]?.text?.trim() || '';
}

// ── SM-2 Spaced Repetition ────────────────────────────────
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

// ── Constants ─────────────────────────────────────────────
const MAX_CARDS  = 1000;
const MAX_IDIOMS = 500;
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

// Idiom accent — a distinct teal/slate palette, separate from POS colors
const IDIOM_ACCENT       = '#4a7a8a';
const IDIOM_ACCENT_DARK  = '#366070';
const IDIOM_BG_LIGHT     = '#d8eaee';
const IDIOM_BG_DARK      = '#1e2d32';

// ── CSS via JS ────────────────────────────────────────────
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
      `.btn-idiom{background:${dark ? IDIOM_BG_DARK : IDIOM_BG_LIGHT};color:${dark ? '#d4eef4' : '#1e3a42'};border-color:${IDIOM_ACCENT}}`,
      `.btn-idiom:hover:not(:disabled){background:${IDIOM_ACCENT};color:#fdf9ef;transform:translateY(-1px)}`,
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
      `.lookup-result{border:1px solid ${theme.border};border-radius:2px;cursor:pointer;padding:0.75rem 1rem;background:${theme.surface};transition:background 0.15s}`,
      `.lookup-result:hover{background:${theme.surfaceAlt}}`,
      `.lookup-result.selected{border-color:${theme.accent};background:${theme.surfaceAlt}}`,
      '@media(max-width:640px){.hide-mobile{display:none!important}}',
    ].join('\n');
    return () => { el.textContent = ''; };
  }, [theme, dark]);
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
  const [cards, setCards]               = useState([]);
  const [idioms, setIdioms]             = useState([]);
  const [loading, setLoading]           = useState(true);
  const [syncStatus, setSyncStatus]     = useState('idle');
  const [idiomSyncStatus, setIdiomSync] = useState('idle');
  const [view, setView]                 = useState('library');
  const [dark, setDark]                 = useState(false);
  const [search, setSearch]             = useState('');
  const [filterPOS, setFilterPOS]       = useState('all');
  const [filterFav, setFilterFav]       = useState(false);
  const [showForm, setShowForm]         = useState(false);
  const [editingCard, setEditingCard]   = useState(null);
  const [showIdiomForm, setShowIdiomForm]     = useState(false);
  const [editingIdiom, setEditingIdiom]       = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [studyDeck, setStudyDeck]       = useState([]);
  const [studyIdx, setStudyIdx]         = useState(0);
  const [flipped, setFlipped]           = useState(false);
  const [toast, setToast]               = useState(null);
  const saveTimer      = useRef(null);
  const idiomSaveTimer = useRef(null);
  const isFirstLoad    = useRef(true);
  const isFirstIdiom   = useRef(true);

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

  // Load words
  useEffect(() => {
    loadFromFirebase()
      .then(loaded => setCards(loaded.sort((a, b) => b.createdAt - a.createdAt)))
      .catch(() => showToast('Could not load from cloud — check connection'))
      .finally(() => setLoading(false));
  }, []);

  // Load idioms
  useEffect(() => {
    loadIdiomsFromFirebase()
      .then(loaded => setIdioms(loaded.sort((a, b) => b.createdAt - a.createdAt)))
      .catch(() => {/* silent — idioms doc might not exist yet */});
  }, []);

  // Save words
  useEffect(() => {
    if (loading) return;
    if (isFirstLoad.current) { isFirstLoad.current = false; return; }
    setSyncStatus('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveToFirebase(cards)
        .then(() => { setSyncStatus('saved'); setTimeout(() => setSyncStatus('idle'), 2000); })
        .catch(() => { setSyncStatus('error'); showToast('Cloud save failed'); });
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [cards, loading]);

  // Save idioms
  useEffect(() => {
    if (isFirstIdiom.current) { isFirstIdiom.current = false; return; }
    setIdiomSync('saving');
    clearTimeout(idiomSaveTimer.current);
    idiomSaveTimer.current = setTimeout(() => {
      saveIdiomsToFirebase(idioms)
        .then(() => { setIdiomSync('saved'); setTimeout(() => setIdiomSync('idle'), 2000); })
        .catch(() => { setIdiomSync('error'); showToast('Idiom save failed'); });
    }, 800);
    return () => clearTimeout(idiomSaveTimer.current);
  }, [idioms]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  // ── Word CRUD ──────────────────────────────────────────
  const addCard = (data) => {
    if (cards.length >= MAX_CARDS) { showToast('Limit reached (1000 words)'); return; }
    const duplicate = cards.find(
      c => c.word.trim().toLowerCase() === data.word.trim().toLowerCase() && c.pos === data.pos
    );
    if (duplicate) { showToast(`"${data.word}" already exists as a ${data.pos}`); return; }
    const card = {
      ...data,
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      createdAt: Date.now(),
      favorite: false,
      srs: null,
    };
    setCards(prev => [card, ...prev]);
    showToast('Card saved');
  };

  const updateCard = (updated) => {
    setCards(prev => prev.map(c => c.id === updated.id ? updated : c));
    showToast('Card updated');
  };

  const deleteCard = (id) => { setCards(prev => prev.filter(c => c.id !== id)); showToast('Card deleted'); };
  const toggleFav  = (card) => { setCards(prev => prev.map(c => c.id === card.id ? { ...c, favorite: !c.favorite } : c)); };

  // ── Idiom CRUD ─────────────────────────────────────────
  const addIdiom = (data) => {
    if (idioms.length >= MAX_IDIOMS) { showToast('Idiom limit reached (500)'); return; }
    const duplicate = idioms.find(
      i => i.phrase.trim().toLowerCase() === data.phrase.trim().toLowerCase()
    );
    if (duplicate) { showToast(`"${data.phrase}" already exists`); return; }
    const idiom = {
      ...data,
      id: 'i_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      createdAt: Date.now(),
      favorite: false,
    };
    setIdioms(prev => [idiom, ...prev]);
    showToast('Idiom saved');
  };

  const updateIdiom = (updated) => {
    setIdioms(prev => prev.map(i => i.id === updated.id ? updated : i));
    showToast('Idiom updated');
  };

  const deleteIdiom = (id) => { setIdioms(prev => prev.filter(i => i.id !== id)); showToast('Idiom deleted'); };
  const toggleIdiomFav = (idiom) => { setIdioms(prev => prev.map(i => i.id === idiom.id ? { ...i, favorite: !i.favorite } : i)); };

  // ── Study ──────────────────────────────────────────────
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
      return c.word.toLowerCase().includes(q)
          || c.meaning.toLowerCase().includes(q)
          || (c.example || '').toLowerCase().includes(q);
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
    if (mode === 'due')            deck = deck.filter(c => !c.srs?.dueAt || c.srs.dueAt <= now);
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

  const syncLabel = syncStatus === 'saving' ? '↑ Saving…'
    : syncStatus === 'saved'  ? '✓ Synced'
    : syncStatus === 'error'  ? '✗ Sync failed' : '';
  const syncColor = syncStatus === 'error' ? '#c1666b'
    : syncStatus === 'saved' ? '#4A7C4A' : theme.textMuted;

  const idiomSyncLabel = idiomSyncStatus === 'saving' ? '↑ Saving…'
    : idiomSyncStatus === 'saved' ? '✓ Synced'
    : idiomSyncStatus === 'error' ? '✗ Sync failed' : '';

  const isIdiomView = view === 'idioms' || view === 'idiom-collection';

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, fontFamily: '"Cormorant Garamond","EB Garamond",Georgia,serif', transition: 'background 0.4s,color 0.4s' }}>
      <div className="paper-bg" style={{ minHeight: '100vh' }}>

        <header style={{ borderBottom: `1px solid ${theme.border}`, background: theme.surface }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', cursor: 'pointer' }} onClick={() => setView('library')}>
              <div style={{ width: 44, height: 44, background: theme.accent, color: dark ? '#1a1612' : '#fdf9ef', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: '1.4rem', fontStyle: 'italic' }}>L</div>
              <div>
                <h1 className="display-font" style={{ margin: 0, fontSize: '1.7rem', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1 }}>Lexicon</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div className="mono-font" style={{ fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginTop: 4 }}>a vocabulary journal</div>
                  {syncLabel     && <div className="mono-font" style={{ fontSize: '0.6rem', color: syncColor,  marginTop: 4 }}>{syncLabel}</div>}
                  {idiomSyncLabel && <div className="mono-font" style={{ fontSize: '0.6rem', color: IDIOM_ACCENT, marginTop: 4 }}>{idiomSyncLabel}</div>}
                </div>
              </div>
            </div>
            <nav style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn hide-mobile" onClick={() => setView('library')}     style={view === 'library'     ? { background: theme.surfaceAlt, fontWeight: 600 } : {}}><BookOpen size={15} /> Library</button>
              <button className="btn hide-mobile" onClick={() => setView('collection')}  style={view === 'collection'  ? { background: theme.surfaceAlt, fontWeight: 600 } : {}}><LibraryIcon size={15} /> Collection</button>
              <button className="btn hide-mobile" onClick={() => setView('idioms')}      style={view === 'idioms' || view === 'idiom-collection' ? { background: dark ? IDIOM_BG_DARK : IDIOM_BG_LIGHT, color: IDIOM_ACCENT, borderColor: IDIOM_ACCENT, fontWeight: 600 } : {}}><MessageSquareQuote size={15} /> Idioms</button>
              <button className="btn hide-mobile" onClick={() => setView('stats')}       style={view === 'stats'       ? { background: theme.surfaceAlt, fontWeight: 600 } : {}}><TrendingUp size={15} /> Progress</button>
              <button className="btn" onClick={() => setShowSettings(true)} title="Settings"><Settings size={15} /></button>
              <button className="btn" onClick={() => setDark(!dark)}>{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
              {isIdiomView ? (
                <button className="btn btn-idiom" onClick={() => { setEditingIdiom(null); setShowIdiomForm(true); }} disabled={idioms.length >= MAX_IDIOMS}><Plus size={15} /> New idiom</button>
              ) : (
                <button className="btn btn-primary" onClick={() => { setEditingCard(null); setShowForm(true); }} disabled={cards.length >= MAX_CARDS}><Plus size={15} /> New</button>
              )}
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

        <main style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '4rem', color: theme.textMuted }}>
              <Loader size={24} className="spin" style={{ marginBottom: '1rem' }} />
              <div className="display-font" style={{ fontSize: '1.5rem', fontStyle: 'italic' }}>Loading from cloud…</div>
            </div>
          ) : view === 'library' ? (
            <Library
              cards={cards} filtered={filtered} theme={theme} dark={dark}
              search={search} setSearch={setSearch}
              filterPOS={filterPOS} setFilterPOS={setFilterPOS}
              filterFav={filterFav} setFilterFav={setFilterFav}
              onEdit={c => { setEditingCard(c); setShowForm(true); }}
              onDelete={deleteCard} onToggleFav={toggleFav} onSpeak={speak}
              onStudy={startStudy} onQuiz={startQuiz}
              onCollection={() => setView('collection')}
              dueCount={dueCount}
            />
          ) : view === 'collection' ? (
            <CollectionView cards={cards} theme={theme} dark={dark} onBack={() => setView('library')} onQuiz={startQuiz} />
          ) : view === 'idioms' ? (
            <IdiomLibrary
              idioms={idioms} theme={theme} dark={dark}
              onEdit={i => { setEditingIdiom(i); setShowIdiomForm(true); }}
              onDelete={deleteIdiom} onToggleFav={toggleIdiomFav} onSpeak={speak}
              onCollection={() => setView('idiom-collection')}
              onNew={() => { setEditingIdiom(null); setShowIdiomForm(true); }}
            />
          ) : view === 'idiom-collection' ? (
            <IdiomCollectionView
              idioms={idioms} theme={theme} dark={dark}
              onBack={() => setView('idioms')}
              onEdit={i => { setEditingIdiom(i); setShowIdiomForm(true); }}
              onDelete={deleteIdiom} onToggleFav={toggleIdiomFav} onSpeak={speak}
            />
          ) : view === 'study' ? (
            <StudyView
              card={studyDeck[studyIdx]} idx={studyIdx} total={studyDeck.length}
              flipped={flipped} setFlipped={setFlipped}
              theme={theme} dark={dark} onRate={applyRating}
              onExit={() => setView('library')} onSpeak={speak}
              onPrev={() => { if (studyIdx > 0) { setStudyIdx(studyIdx - 1); setFlipped(false); } }}
              onNext={() => { if (studyIdx + 1 < studyDeck.length) { setStudyIdx(studyIdx + 1); setFlipped(false); } else setView('library'); }}
            />
          ) : view === 'quiz' ? (
            <QuizView cards={cards} theme={theme} dark={dark} onExit={() => setView('library')} />
          ) : view === 'stats' ? (
            <StatsView cards={cards} idioms={idioms} theme={theme} />
          ) : null}
        </main>

        {showForm && (
          <CardForm
            theme={theme} dark={dark}
            initial={editingCard}
            existingCards={cards}
            onSave={data => {
              if (editingCard) updateCard({ ...editingCard, ...data });
              else addCard(data);
              setShowForm(false);
              setEditingCard(null);
            }}
            onCancel={() => { setShowForm(false); setEditingCard(null); }}
          />
        )}

        {showIdiomForm && (
          <IdiomForm
            theme={theme} dark={dark}
            initial={editingIdiom}
            existingIdioms={idioms}
            onSave={data => {
              if (editingIdiom) updateIdiom({ ...editingIdiom, ...data });
              else addIdiom(data);
              setShowIdiomForm(false);
              setEditingIdiom(null);
            }}
            onCancel={() => { setShowIdiomForm(false); setEditingIdiom(null); }}
          />
        )}

        {showSettings && <SettingsPanel theme={theme} onClose={() => setShowSettings(false)} />}

        {toast && (
          <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: theme.text, color: theme.bg, padding: '0.7rem 1.4rem', fontFamily: 'Fraunces,serif', fontSize: '0.95rem', borderRadius: 2, zIndex: 100, animation: 'fadeIn 0.3s', whiteSpace: 'nowrap' }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Settings Panel ────────────────────────────────────────
function SettingsPanel({ theme, onClose }) {
  const [apiKey,     setApiKey]     = useState(getApiKey());
  const [saved,      setSaved]      = useState(false);
  const [testing,    setTesting]    = useState(false);
  const [testResult, setTestResult] = useState(null);

  const handleSave = () => {
    saveApiKey(apiKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    if (!apiKey.trim()) return;
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 10, messages: [{ role: 'user', content: 'Hi' }] }),
      });
      setTestResult(res.ok ? 'ok' : 'fail');
    } catch { setTestResult('fail'); }
    finally { setTesting(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} className="scale-in" style={{ background: theme.surface, border: `1px solid ${theme.border}`, padding: '2rem', maxWidth: 500, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <h2 className="display-font" style={{ margin: 0, fontSize: '1.7rem', fontWeight: 600, fontStyle: 'italic' }}>Settings</h2>
            <div className="mono-font" style={{ fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginTop: 4 }}>API configuration</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.text }}><X size={22} /></button>
        </div>

        <div style={{ padding: '1.25rem', background: theme.surfaceAlt, border: `1px solid ${theme.border}`, marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Key size={16} style={{ color: theme.accent }} />
            <div className="mono-font" style={{ fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted }}>Anthropic API Key</div>
          </div>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: theme.textMuted, lineHeight: 1.5 }}>
            Required for dictionary lookup and AI example generation. Get a free key at{' '}
            <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color: theme.accent }}>console.anthropic.com</a>.
            Stored only in this browser — never sent anywhere except Anthropic.
          </p>
          <input
            type="password"
            className="input-field"
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setTestResult(null); }}
            placeholder="sk-ant-..."
            style={{ marginBottom: '0.75rem', fontFamily: 'JetBrains Mono,monospace', fontSize: '0.85rem' }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={!apiKey.trim()}>
              {saved ? <><CheckCircle size={14} /> Saved</> : 'Save key'}
            </button>
            <button className="btn" onClick={handleTest} disabled={!apiKey.trim() || testing}>
              {testing ? <><Loader size={14} className="spin" /> Testing…</> : 'Test connection'}
            </button>
          </div>
          {testResult === 'ok'   && <div style={{ marginTop: '0.75rem', color: '#4A7C4A', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}><CheckCircle size={14} /> API key works — lookup and AI generation are ready.</div>}
          {testResult === 'fail' && <div style={{ marginTop: '0.75rem', color: '#c1666b', fontSize: '0.9rem' }}>✗ Connection failed — check your key and try again.</div>}
        </div>

        <div style={{ padding: '1rem', background: theme.surfaceAlt, border: `1px solid ${theme.border}`, fontSize: '0.9rem', color: theme.textMuted, lineHeight: 1.5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
            <CheckCircle size={14} style={{ color: '#4A7C4A' }} />
            <span style={{ color: theme.text, fontWeight: 500 }}>Cloud sync active</span>
          </div>
          Your cards and idioms sync to Firebase automatically — accessible from any device or browser.
        </div>
      </div>
    </div>
  );
}

// ── Card Form (unchanged) ─────────────────────────────────
function CardForm({ theme, dark, initial, existingCards, onSave, onCancel }) {
  const [word,    setWord]    = useState(initial?.word    || '');
  const [pos,     setPos]     = useState(initial?.pos     || 'noun');
  const [meaning, setMeaning] = useState(initial?.meaning || '');
  const [example, setExample] = useState(initial?.example || '');

  const [lookupState,   setLookupState]   = useState('idle');
  const [lookupResults, setLookupResults] = useState([]);
  const [selectedIdx,   setSelectedIdx]   = useState(null);
  const [lookupError,   setLookupError]   = useState('');
  const [exampleState,  setExampleState]  = useState('idle');

  const duplicateExists = !initial && (existingCards || []).some(
    c => c.word.trim().toLowerCase() === word.trim().toLowerCase() && c.pos === pos
  );

  const handleLookup = async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      setLookupError('No API key set — open Settings (⚙) in the header and add your Anthropic key first.');
      setLookupState('error');
      return;
    }
    if (!word.trim()) return;
    setLookupState('loading'); setLookupResults([]); setSelectedIdx(null); setLookupError('');
    try {
      const results = await lookupWord(word.trim(), apiKey);
      setLookupResults(results);
      setLookupState('results');
      setPos(results[0].pos);
      setMeaning(results[0].meaning);
      setExample(results[0].example || '');
      setSelectedIdx(0);
    } catch (e) {
      setLookupError(e.message || 'Could not find that word. Fill in manually below.');
      setLookupState('error');
    }
  };

  const selectResult = (idx) => {
    const r = lookupResults[idx];
    setSelectedIdx(idx); setPos(r.pos); setMeaning(r.meaning); setExample(r.example || '');
  };

  const handleGenerateExample = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { setExampleState('error'); return; }
    if (!word.trim() || !meaning.trim()) return;
    setExampleState('loading');
    try {
      setExample(await generateExample(word.trim(), pos, meaning, apiKey));
      setExampleState('done');
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

          <Field label="Word" theme={theme}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                className="input-field"
                value={word}
                onChange={e => { setWord(e.target.value); setLookupState('idle'); setLookupError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
                autoFocus placeholder="e.g. ephemeral"
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                onClick={handleLookup}
                disabled={!word.trim() || lookupState === 'loading'}
                style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                {lookupState === 'loading' ? <Loader size={14} className="spin" /> : <Search size={14} />} Look up
              </button>
            </div>
            {lookupState === 'loading' && (
              <div className="mono-font" style={{ fontSize: '0.75rem', color: theme.textMuted, marginTop: 6, fontStyle: 'italic' }}>
                Searching… takes a few seconds
              </div>
            )}
          </Field>

          {lookupState === 'error' && (
            <div style={{ padding: '0.75rem 1rem', background: theme.surfaceAlt, borderLeft: '3px solid #c1666b', fontSize: '0.9rem', color: theme.textMuted, lineHeight: 1.5 }}>
              {lookupError}
            </div>
          )}

          {lookupState === 'results' && lookupResults.length > 0 && (
            <div>
              <div className="mono-font" style={{ fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginBottom: '0.5rem' }}>
                {lookupResults.length} definition{lookupResults.length > 1 ? 's' : ''} found — click one to use it
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: 220, overflow: 'auto' }}>
                {lookupResults.map((r, i) => (
                  <div key={i} className={`lookup-result${selectedIdx === i ? ' selected' : ''}`} onClick={() => selectResult(i)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                      <span className="pos-pill" style={{ background: POS_COLORS[r.pos]?.accent || '#a0522d', color: dark ? '#1a1612' : '#fdf9ef', fontSize: '0.6rem' }}>{r.pos}</span>
                    </div>
                    <div style={{ fontSize: '0.95rem', lineHeight: 1.45 }}>{r.meaning}</div>
                    {r.example && <div style={{ fontSize: '0.85rem', color: theme.textMuted, fontStyle: 'italic', marginTop: '0.2rem' }}>"{r.example}"</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {duplicateExists && (
            <div style={{ padding: '0.75rem 1rem', background: theme.surfaceAlt, borderLeft: '3px solid #c1666b', fontSize: '0.9rem', color: '#c1666b', lineHeight: 1.5 }}>
              <strong>"{word}"</strong> already exists as a <strong>{pos}</strong>. Change the part of speech or edit the existing card instead.
            </div>
          )}

          <Field label="Part of speech" theme={theme}>
            <select className="input-field" value={pos} onChange={e => setPos(e.target.value)} style={{ cursor: 'pointer' }}>
              {POS_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>

          <Field label="Meaning" theme={theme}>
            <textarea className="input-field" value={meaning} onChange={e => setMeaning(e.target.value)}
              rows={2} placeholder="What does it mean?" style={{ resize: 'vertical', fontFamily: 'inherit' }} />
          </Field>

          <Field label="Example sentence" theme={theme} optional hint="Each line stays on its own line on the card.">
            <textarea className="input-field" value={example} onChange={e => setExample(e.target.value)}
              rows={3} placeholder="Use it in a sentence…" style={{ resize: 'vertical', fontFamily: 'inherit', fontStyle: 'italic' }} />
            <button
              className="btn"
              onClick={handleGenerateExample}
              disabled={!word.trim() || !meaning.trim() || exampleState === 'loading'}
              style={{ marginTop: '0.5rem', fontSize: '0.85rem', padding: '0.45rem 0.9rem' }}
            >
              {exampleState === 'loading'
                ? <><Loader size={13} className="spin" /> Generating…</>
                : <><Wand2 size={13} /> AI generate examples</>}
            </button>
            {exampleState === 'error' && (
              <div style={{ fontSize: '0.85rem', color: '#c1666b', marginTop: '0.3rem', fontStyle: 'italic' }}>
                Failed — check your API key in Settings (⚙).
              </div>
            )}
          </Field>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.8rem' }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (word.trim() && meaning.trim() && !duplicateExists)
                onSave({ word: word.trim(), pos, meaning: meaning.trim(), example: example.trim() });
            }}
            disabled={!word.trim() || !meaning.trim() || duplicateExists}
          >
            {initial ? 'Save changes' : 'Add to journal'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Idiom Form ────────────────────────────────────────────
function IdiomForm({ theme, dark, initial, existingIdioms, onSave, onCancel }) {
  const [phrase,  setPhrase]  = useState(initial?.phrase  || '');
  const [meaning, setMeaning] = useState(initial?.meaning || '');
  const [example, setExample] = useState(initial?.example || '');
  const [origin,  setOrigin]  = useState(initial?.origin  || '');

  const [lookupState,  setLookupState]  = useState('idle');
  const [lookupError,  setLookupError]  = useState('');
  const [exampleState, setExampleState] = useState('idle');

  const duplicateExists = !initial && (existingIdioms || []).some(
    i => i.phrase.trim().toLowerCase() === phrase.trim().toLowerCase()
  );

  const handleLookup = async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      setLookupError('No API key set — open Settings (⚙) and add your Anthropic key first.');
      setLookupState('error');
      return;
    }
    if (!phrase.trim()) return;
    setLookupState('loading'); setLookupError('');
    try {
      const result = await lookupIdiom(phrase.trim(), apiKey);
      setMeaning(result.meaning || '');
      setExample(result.example || '');
      setOrigin(result.origin || '');
      setLookupState('done');
    } catch (e) {
      setLookupError(e.message || 'Could not look up that idiom. Fill in manually below.');
      setLookupState('error');
    }
  };

  const handleGenerateExample = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { setExampleState('error'); return; }
    if (!phrase.trim() || !meaning.trim()) return;
    setExampleState('loading');
    try {
      setExample(await generateIdiomExample(phrase.trim(), meaning, apiKey));
      setExampleState('done');
    } catch { setExampleState('error'); }
  };

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} className="scale-in" style={{ background: theme.surface, border: `2px solid ${IDIOM_ACCENT}`, padding: '2rem', maxWidth: 580, width: '100%', maxHeight: '92vh', overflow: 'auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
              <MessageSquareQuote size={18} style={{ color: IDIOM_ACCENT }} />
              <h2 className="display-font" style={{ margin: 0, fontSize: '1.7rem', fontWeight: 600, fontStyle: 'italic' }}>{initial ? 'Edit idiom' : 'New idiom'}</h2>
            </div>
            <div className="mono-font" style={{ fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: theme.textMuted, marginTop: 4 }}>add to your idiom collection</div>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.text }}><X size={22} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          <Field label="Idiom / phrase" theme={theme}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                className="input-field"
                value={phrase}
                onChange={e => { setPhrase(e.target.value); setLookupState('idle'); setLookupError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
                autoFocus placeholder="e.g. bite the bullet"
                style={{ flex: 1 }}
              />
              <button
                className="btn"
                onClick={handleLookup}
                disabled={!phrase.trim() || lookupState === 'loading'}
                style={{ whiteSpace: 'nowrap', flexShrink: 0, background: IDIOM_ACCENT, color: '#fdf9ef', borderColor: IDIOM_ACCENT }}
              >
                {lookupState === 'loading' ? <Loader size={14} className="spin" /> : <Search size={14} />} Look up
              </button>
            </div>
            {lookupState === 'loading' && (
              <div className="mono-font" style={{ fontSize: '0.75rem', color: theme.textMuted, marginTop: 6, fontStyle: 'italic' }}>
                Searching… takes a few seconds
              </div>
            )}
            {lookupState === 'done' && (
              <div className="mono-font" style={{ fontSize: '0.72rem', color: IDIOM_ACCENT, marginTop: 6 }}>
                ✓ Fields filled in — review and save
              </div>
            )}
          </Field>

          {lookupState === 'error' && (
            <div style={{ padding: '0.75rem 1rem', background: theme.surfaceAlt, borderLeft: `3px solid #c1666b`, fontSize: '0.9rem', color: theme.textMuted, lineHeight: 1.5 }}>
              {lookupError}
            </div>
          )}

          {duplicateExists && (
            <div style={{ padding: '0.75rem 1rem', background: theme.surfaceAlt, borderLeft: '3px solid #c1666b', fontSize: '0.9rem', color: '#c1666b', lineHeight: 1.5 }}>
              <strong>"{phrase}"</strong> already exists in your collection.
            </div>
          )}

          <Field label="Meaning" theme={theme}>
            <textarea className="input-field" value={meaning} onChange={e => setMeaning(e.target.value)}
              rows={2} placeholder="What does this idiom mean?" style={{ resize: 'vertical', fontFamily: 'inherit' }} />
          </Field>

          <Field label="Example sentence" theme={theme} optional hint="Each line stays on its own line.">
            <textarea className="input-field" value={example} onChange={e => setExample(e.target.value)}
              rows={3} placeholder="Use it in a sentence…" style={{ resize: 'vertical', fontFamily: 'inherit', fontStyle: 'italic' }} />
            <button
              className="btn"
              onClick={handleGenerateExample}
              disabled={!phrase.trim() || !meaning.trim() || exampleState === 'loading'}
              style={{ marginTop: '0.5rem', fontSize: '0.85rem', padding: '0.45rem 0.9rem' }}
            >
              {exampleState === 'loading'
                ? <><Loader size={13} className="spin" /> Generating…</>
                : <><Wand2 size={13} /> AI generate examples</>}
            </button>
            {exampleState === 'error' && (
              <div style={{ fontSize: '0.85rem', color: '#c1666b', marginTop: '0.3rem', fontStyle: 'italic' }}>
                Failed — check your API key in Settings (⚙).
              </div>
            )}
          </Field>

          <Field label="Origin / background" theme={theme} optional hint="Where does this idiom come from?">
            <textarea className="input-field" value={origin} onChange={e => setOrigin(e.target.value)}
              rows={2} placeholder="e.g. 18th century naval terminology…" style={{ resize: 'vertical', fontFamily: 'inherit' }} />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.8rem' }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button
            style={{ background: IDIOM_ACCENT, color: '#fdf9ef', borderColor: IDIOM_ACCENT, fontFamily: 'Fraunces,serif', fontWeight: 500, padding: '0.6rem 1.2rem', borderRadius: 2, border: `1px solid ${IDIOM_ACCENT}`, cursor: 'pointer', fontSize: '0.95rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', opacity: (!phrase.trim() || !meaning.trim() || duplicateExists) ? 0.4 : 1 }}
            onClick={() => {
              if (phrase.trim() && meaning.trim() && !duplicateExists)
                onSave({ phrase: phrase.trim(), meaning: meaning.trim(), example: example.trim(), origin: origin.trim() });
            }}
            disabled={!phrase.trim() || !meaning.trim() || duplicateExists}
          >
            {initial ? 'Save changes' : 'Add idiom'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Field (shared) ────────────────────────────────────────
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

// ── Idiom Library ─────────────────────────────────────────
function IdiomLibrary({ idioms, theme, dark, onEdit, onDelete, onToggleFav, onSpeak, onCollection, onNew }) {
  const [search, setSearch]     = useState('');
  const [filterFav, setFilterFav] = useState(false);

  const filtered = useMemo(() => idioms.filter(i => {
    if (filterFav && !i.favorite) return false;
    if (search) {
      const q = search.toLowerCase();
      return i.phrase.toLowerCase().includes(q)
          || i.meaning.toLowerCase().includes(q)
          || (i.example || '').toLowerCase().includes(q)
          || (i.origin  || '').toLowerCase().includes(q);
    }
    return true;
  }), [idioms, search, filterFav]);

  return (
    <div className="fade-in">
      {/* Header band */}
      <div style={{ marginBottom: '2rem', paddingBottom: '2rem', borderBottom: `1px solid ${theme.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.3rem' }}>
          <MessageSquareQuote size={22} style={{ color: IDIOM_ACCENT }} />
          <div className="mono-font" style={{ fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: IDIOM_ACCENT }}>Idiom collection</div>
        </div>
        <h2 className="display-font" style={{ margin: 0, fontSize: '2.2rem', fontWeight: 600, fontStyle: 'italic' }}>Phrases &amp; Idioms</h2>
        <p style={{ color: theme.textMuted, marginTop: '0.4rem', fontSize: '1rem' }}>
          {idioms.length === 0 ? 'No idioms yet. Add your first one.' : `${idioms.length} idiom${idioms.length === 1 ? '' : 's'} collected.`}
        </p>
      </div>

      {/* Stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <IdiomStatTile theme={theme} dark={dark} label="Collected" value={idioms.length} />
        <IdiomStatTile theme={theme} dark={dark} label="Favorites"  value={idioms.filter(i => i.favorite).length} highlight />
        <IdiomStatTile theme={theme} dark={dark} label="With origin" value={idioms.filter(i => i.origin?.trim()).length} />
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '2rem', paddingBottom: '2rem', borderBottom: `1px solid ${theme.border}` }}>
        <button onClick={onNew} style={{ background: IDIOM_ACCENT, color: '#fdf9ef', borderColor: IDIOM_ACCENT, fontFamily: 'Fraunces,serif', fontWeight: 500, padding: '0.6rem 1.2rem', borderRadius: 2, border: `1px solid ${IDIOM_ACCENT}`, cursor: 'pointer', fontSize: '0.95rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s' }}>
          <Plus size={15} /> Add idiom
        </button>
        <button className="btn" onClick={onCollection} disabled={!idioms.length}><LibraryIcon size={15} /> View all A–Z</button>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '2rem' }}>
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 480 }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: theme.textMuted }} />
          <input className="input-field" placeholder="Search idioms, meanings, examples…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
        </div>
        <button className="btn" onClick={() => setFilterFav(!filterFav)} style={filterFav ? { background: IDIOM_ACCENT, color: '#fdf9ef', borderColor: IDIOM_ACCENT } : {}}>
          <Star size={15} fill={filterFav ? 'currentColor' : 'none'} /> Favorites
        </button>
      </div>

      {/* Cards grid */}
      {!idioms.length ? (
        <IdiomEmptyState theme={theme} onNew={onNew} />
      ) : !filtered.length ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: theme.textMuted, fontStyle: 'italic' }}>No idioms match your search.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: '1.25rem' }}>
          {filtered.map(idiom => (
            <IdiomCard key={idiom.id} idiom={idiom} theme={theme} dark={dark} onEdit={onEdit} onDelete={onDelete} onToggleFav={onToggleFav} onSpeak={onSpeak} />
          ))}
        </div>
      )}
    </div>
  );
}

function IdiomStatTile({ theme, dark, label, value, highlight }) {
  const bg = highlight
    ? (dark ? IDIOM_BG_DARK : IDIOM_BG_LIGHT)
    : theme.surface;
  const color = highlight ? IDIOM_ACCENT : theme.text;
  return (
    <div style={{ padding: '1.2rem 1.3rem', borderRadius: 2, background: bg, color, border: `1px solid ${highlight ? IDIOM_ACCENT : theme.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: 0.75, marginBottom: 6 }}>
        <MessageSquareQuote size={15} />
        <span className="mono-font" style={{ fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div className="display-font" style={{ fontSize: '2.2rem', fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'oldstyle-nums' }}>{value}</div>
    </div>
  );
}

function IdiomEmptyState({ theme, onNew }) {
  return (
    <div style={{ textAlign: 'center', padding: '5rem 1rem' }}>
      <MessageSquareQuote size={40} style={{ color: IDIOM_ACCENT, opacity: 0.4, marginBottom: '1.5rem' }} />
      <h2 className="display-font" style={{ fontSize: '2rem', fontWeight: 500, fontStyle: 'italic', margin: '0 0 0.5rem' }}>No idioms yet</h2>
      <p style={{ color: theme.textMuted, fontSize: '1.05rem', maxWidth: 400, margin: '0 auto 2rem' }}>
        Start building your collection of phrases, proverbs, and figures of speech.
      </p>
      <button onClick={onNew} style={{ background: IDIOM_ACCENT, color: '#fdf9ef', borderColor: IDIOM_ACCENT, fontFamily: 'Fraunces,serif', fontWeight: 500, padding: '0.7rem 1.5rem', borderRadius: 2, border: `1px solid ${IDIOM_ACCENT}`, cursor: 'pointer', fontSize: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
        <Plus size={16} /> Add your first idiom
      </button>
    </div>
  );
}

// ── Idiom Card ────────────────────────────────────────────
function IdiomCard({ idiom, theme, dark, onEdit, onDelete, onToggleFav, onSpeak }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="scale-in"
      style={{
        background: dark ? theme.surface : IDIOM_BG_LIGHT,
        border: `1px solid ${IDIOM_ACCENT}`,
        borderLeft: `4px solid ${IDIOM_ACCENT}`,
        padding: '1.3rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
        transition: 'box-shadow 0.2s',
        boxShadow: dark ? 'none' : '0 4px 12px -4px rgba(74,122,138,0.18)',
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = dark ? '0 0 0 1px rgba(74,122,138,0.4)' : '0 8px 24px -8px rgba(74,122,138,0.3)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = dark ? 'none' : '0 4px 12px -4px rgba(74,122,138,0.18)'}
    >
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span className="pos-pill" style={{ background: IDIOM_ACCENT, color: '#fdf9ef', fontSize: '0.6rem', letterSpacing: '0.12em' }}>idiom</span>
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <IconBtn onClick={() => onSpeak(idiom.phrase)} title="Pronounce"><Volume2 size={13} /></IconBtn>
          <IconBtn onClick={() => onToggleFav(idiom)} title="Favorite">
            <Star size={13} fill={idiom.favorite ? 'currentColor' : 'none'} style={{ color: idiom.favorite ? '#d4a574' : 'inherit' }} />
          </IconBtn>
        </div>
      </div>

      {/* Phrase */}
      <h3 className="display-font" style={{ margin: 0, fontSize: '1.45rem', fontWeight: 600, fontStyle: 'italic', lineHeight: 1.15, color: dark ? theme.text : IDIOM_ACCENT_DARK }}>{idiom.phrase}</h3>

      {/* Meaning */}
      <p style={{ margin: 0, fontSize: '0.97rem', lineHeight: 1.5, color: theme.text }}>{idiom.meaning}</p>

      {/* Example (collapsible) */}
      {idiom.example && (
        <div style={{ fontSize: '0.9rem', color: theme.textMuted, borderLeft: `2px solid ${IDIOM_ACCENT}`, paddingLeft: '0.75rem', lineHeight: 1.55 }}>
          <MultilineText text={idiom.example} italic />
        </div>
      )}

      {/* Origin (expandable) */}
      {idiom.origin && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: IDIOM_ACCENT, fontFamily: 'JetBrains Mono,monospace', fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', padding: 0, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
          >
            {expanded ? '▲' : '▼'} Origin
          </button>
          {expanded && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.88rem', color: theme.textMuted, fontStyle: 'italic', lineHeight: 1.5 }}>
              {idiom.origin}
            </div>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.3rem', marginTop: '0.2rem', borderTop: `1px solid ${dark ? theme.border : 'rgba(74,122,138,0.2)'}`, paddingTop: '0.6rem' }}>
        <IconBtn onClick={() => onEdit(idiom)} title="Edit"><Edit2 size={12} /></IconBtn>
        <IconBtn onClick={() => { if (confirm('Delete this idiom?')) onDelete(idiom.id); }} title="Delete"><Trash2 size={12} /></IconBtn>
      </div>
    </div>
  );
}

// ── Idiom Collection View (A–Z) ───────────────────────────
function IdiomCollectionView({ idioms, theme, dark, onBack, onEdit, onDelete, onToggleFav, onSpeak }) {
  const [search, setSearch] = useState('');

  const visible = useMemo(() =>
    [...idioms]
      .sort((a, b) => a.phrase.toLowerCase().localeCompare(b.phrase.toLowerCase()))
      .filter(i => {
        if (!search) return true;
        const q = search.toLowerCase();
        return i.phrase.toLowerCase().includes(q) || i.meaning.toLowerCase().includes(q) || (i.example || '').toLowerCase().includes(q);
      }),
    [idioms, search]);

  return (
    <div className="fade-in">
      <button className="btn" onClick={onBack} style={{ marginBottom: '2rem' }}><ArrowLeft size={15} /> Back to idioms</button>
      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
          <MessageSquareQuote size={16} style={{ color: IDIOM_ACCENT }} />
          <div className="mono-font" style={{ fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: IDIOM_ACCENT }}>A–Z index</div>
        </div>
        <h2 className="display-font" style={{ margin: 0, fontSize: '2.5rem', fontWeight: 600, fontStyle: 'italic' }}>All idioms</h2>
        <p style={{ color: theme.textMuted, marginTop: '0.5rem', fontSize: '1.05rem' }}>{idioms.length} {idioms.length === 1 ? 'phrase' : 'phrases'}, sorted alphabetically.</p>
      </div>

      <div style={{ position: 'relative', maxWidth: 480, marginBottom: '2rem' }}>
        <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: theme.textMuted }} />
        <input className="input-field" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
      </div>

      {!visible.length ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: theme.textMuted, fontStyle: 'italic' }}>No matches.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {visible.map(i => (
            <IdiomCollectionEntry key={i.id} idiom={i} theme={theme} dark={dark} onEdit={onEdit} onDelete={onDelete} onToggleFav={onToggleFav} onSpeak={onSpeak} />
          ))}
        </div>
      )}
    </div>
  );
}

function IdiomCollectionEntry({ idiom, theme, dark, onEdit, onDelete, onToggleFav, onSpeak }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderLeft: `3px solid ${IDIOM_ACCENT}`, padding: '1.25rem 1.5rem', transition: 'transform 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.transform = 'translateX(2px)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'translateX(0)'}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <h3 className="display-font" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600, fontStyle: 'italic', color: IDIOM_ACCENT_DARK }}>{idiom.phrase}</h3>
        <span className="pos-pill" style={{ background: IDIOM_ACCENT, color: '#fdf9ef', fontSize: '0.58rem' }}>idiom</span>
        {idiom.favorite && <Star size={14} fill="#d4a574" style={{ color: '#d4a574' }} />}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.3rem' }}>
          <IconBtn onClick={() => onSpeak(idiom.phrase)} title="Pronounce"><Volume2 size={13} /></IconBtn>
          <IconBtn onClick={() => onToggleFav(idiom)} title="Favorite"><Star size={13} fill={idiom.favorite ? 'currentColor' : 'none'} style={{ color: idiom.favorite ? '#d4a574' : 'inherit' }} /></IconBtn>
          <IconBtn onClick={() => onEdit(idiom)} title="Edit"><Edit2 size={12} /></IconBtn>
          <IconBtn onClick={() => { if (confirm('Delete this idiom?')) onDelete(idiom.id); }} title="Delete"><Trash2 size={12} /></IconBtn>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: '1.02rem', lineHeight: 1.5 }}>{idiom.meaning}</p>
      {idiom.example && (
        <div style={{ marginTop: '0.6rem', fontSize: '0.93rem', color: theme.textMuted, borderLeft: `2px solid ${theme.border}`, paddingLeft: '0.75rem', lineHeight: 1.55 }}>
          <MultilineText text={idiom.example} italic />
        </div>
      )}
      {idiom.origin && (
        <div style={{ marginTop: '0.5rem' }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: IDIOM_ACCENT, fontFamily: 'JetBrains Mono,monospace', fontSize: '0.63rem', letterSpacing: '0.15em', textTransform: 'uppercase', padding: 0 }}
          >
            {expanded ? '▲' : '▼'} Origin
          </button>
          {expanded && <div style={{ marginTop: '0.4rem', fontSize: '0.88rem', color: theme.textMuted, fontStyle: 'italic' }}>{idiom.origin}</div>}
        </div>
      )}
    </div>
  );
}

// ── Library (unchanged) ───────────────────────────────────
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
          <input className="input-field" placeholder="Search words, meanings, examples…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
        </div>
        <select className="input-field" value={filterPOS} onChange={e => setFilterPOS(e.target.value)} style={{ flex: '0 1 180px', cursor: 'pointer' }}>
          <option value="all">All parts of speech</option>
          {POS_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn" onClick={() => setFilterFav(!filterFav)} style={filterFav ? { background: theme.accent, color: '#fdf9ef', borderColor: theme.accent } : {}}>
          <Star size={15} fill={filterFav ? 'currentColor' : 'none'} /> Favorites
        </button>
      </div>
      {!cards.length ? <EmptyState theme={theme} /> : !filtered.length ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: theme.textMuted, fontStyle: 'italic' }}>No cards match your filters.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: '1.25rem' }}>
          {filtered.map(card => (
            <FlashCard key={card.id} card={card} theme={theme} dark={dark} onEdit={onEdit} onDelete={onDelete} onToggleFav={onToggleFav} onSpeak={onSpeak} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Collection View (unchanged) ───────────────────────────
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
          <input className="input-field" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
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
      onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.06)'}>{children}</button>
  );
}

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

// ── Stats View (idiom count added) ────────────────────────
function StatsView({ cards, idioms, theme }) {
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
        <BigStat theme={theme} value={idioms.length}                                                  label="Total idioms" accent={IDIOM_ACCENT} />
        <BigStat theme={theme} value={cards.filter(c => c.srs?.reps > 0).length}                     label="Reviewed"    />
        <BigStat theme={theme} value={cards.filter(c => (c.srs?.reps || 0) >= 4).length}             label="Mastered"    />
        <BigStat theme={theme} value={cards.filter(c => c.favorite).length}                          label="Fav words"   />
        <BigStat theme={theme} value={idioms.filter(i => i.favorite).length}                         label="Fav idioms"  accent={IDIOM_ACCENT} />
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
      {!cards.length && !idioms.length && <div style={{ textAlign: 'center', padding: '3rem', color: theme.textMuted, fontStyle: 'italic' }}>Add some words or idioms first to see your progress.</div>}
    </div>
  );
}

function BigStat({ theme, value, label, accent }) {
  return (
    <div style={{ padding: '1.25rem', background: theme.surface, border: `1px solid ${accent || theme.border}`, borderTop: accent ? `3px solid ${accent}` : undefined }}>
      <div className="display-font" style={{ fontSize: '2.5rem', fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'oldstyle-nums', color: accent || theme.text }}>{value}</div>
      <div className="mono-font" style={{ fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: theme.textMuted, marginTop: 6 }}>{label}</div>
    </div>
  );
}
