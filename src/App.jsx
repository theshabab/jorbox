import { useState, useEffect, useMemo } from 'react';
import { Layers, Github } from 'lucide-react';
import { DataManager } from './utils/DataManager';
import GameSelector from './components/GameSelector';
import CardViewer from './components/CardViewer';
import CategorySelector from './components/CategorySelector';
import AuroraBokehBackground from './components/AuroraBokehBackground';
import CardManager from './components/CardManager';

const shuffle = (items) => {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export default function App() {
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [cards, setCards] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const [managing, setManaging] = useState(false);
  const [revision, setRevision] = useState(0);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([DataManager.fetchGames(), DataManager.fetchSession()]).then(([games, session]) => {
      if (active) { setGames(games); setSession(session); setError(''); }
    }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  useEffect(() => {
    if (!selectedGame) return;
    let active = true;
    DataManager.fetchGameData(selectedGame.id).then(data => {
      if (active) { setCards(shuffle(data)); setError(''); }
    }).catch(error => { if (active) { setError(error.message); setCards([]); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedGame, revision]);

  const categories = useMemo(() => Array.from(new Set(cards.map(card => card.Category).filter(Boolean))).sort(), [cards]);
  const filteredCards = useMemo(() => selectedCategory ? cards.filter(card => card.Category === selectedCategory) : cards, [cards, selectedCategory]);
  function selectGame(game) {
    setSelectedGame(game); setSelectedCategory(null); setCards([]); setLoading(true); setManaging(false); setError('');
  }
  function refreshCards() { setLoading(true); setRevision(value => value + 1); }
  async function logout() {
    try {
      await DataManager.logout();
      setSession(await DataManager.fetchSession());
      setManaging(false);
      if (selectedGame) refreshCards();
    } catch (error) { setError(error.message); }
  }
  function onVote(id, feedback) { setCards(previous => previous.map(card => card.id === id ? { ...card, ...feedback } : card)); }

  return <div className="app-container">
    <AuroraBokehBackground />
    <header className="app-header">
      <div className="brand"><Layers size={32} color="var(--accent-primary)" /><h1>Shabab JorBox</h1></div>
      <p className="subtitle">Companion App</p>
      <div className="account-bar">
        {session?.user ? <><span>Signed in as <strong>{session.user.login}</strong>{session.user.isAdmin && ' · Administrator'}</span><button className="btn-secondary" onClick={logout}>Sign out</button></> : session?.githubEnabled ? <a className="btn-secondary" href="/api/auth/github"><Github size={18} /> Sign in with GitHub</a> : session && <span className="muted">GitHub sign-in awaits configuration.</span>}
      </div>
    </header>
    <main>
      {error && <div className="error notice" role="alert">{error} <button className="btn-secondary" onClick={() => { setLoading(true); setRetry(value => value + 1); if (selectedGame) refreshCards(); }}>Retry</button></div>}
      {session && <GameSelector games={games} selectedGame={selectedGame} onSelectGame={selectGame} />}
      {selectedGame && session?.user?.isAdmin && <div className="button-row management-toggle"><button className="btn-secondary" onClick={() => setManaging(value => !value)}>{managing ? 'Back to playing' : 'Manage cards'}</button></div>}
      {managing && selectedGame ? <CardManager key={selectedGame.id} game={selectedGame} cards={cards} onChanged={refreshCards} loading={loading} /> : loading ? <p className="empty-state" role="status">Loading…</p> : selectedGame ? <>
        {selectedGame.hasCategories && <CategorySelector categories={categories} selectedCategory={selectedCategory} onSelectCategory={setSelectedCategory} />}
        <CardViewer key={`${selectedGame.id}:${selectedCategory || ''}:${revision}`} cards={filteredCards} session={session} onVote={onVote} />
      </> : !error && <p className="empty-state">Choose a game to start playing.</p>}
    </main>
    <footer><p>&copy; {new Date().getFullYear()} Shabab JorBox</p><p>Like or dislike cards to help improve the decks.</p></footer>
  </div>;
}
