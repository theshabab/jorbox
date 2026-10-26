import {
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Layers, Github } from 'lucide-react';
import { DataManager } from './utils/DataManager';
import { deckOrder, lastGameId, rememberLastGame } from './utils/deckOrder';
import { useRound, useScoreboard } from './utils/useRound';
import {
  initialRoute,
  parseRoute,
  rememberReturn,
  routePath,
} from './utils/route';
import GameSelector from './components/GameSelector';
import DeckBar from './components/DeckBar';
import CardViewer from './components/CardViewer';
import RoundTimer from './components/RoundTimer';
import AuroraBokehBackground from './components/AuroraBokehBackground';

// Administrator screens (and the CSV parser they use) load only when opened.
const CardManager = lazy(() => import('./components/CardManager'));
const GameManager = lazy(() => import('./components/GameManager'));
const AdminReports = lazy(() => import('./components/AdminReports'));

const VIEWS = [
  ['play', 'Play'],
  ['cards', 'Manage cards'],
  ['games', 'Games & formats'],
  ['reports', 'Reports'],
];

export default function App() {
  const [startRoute] = useState(initialRoute);
  const pendingGame = useRef(startRoute.gameId);
  const routeSynced = useRef(false);
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  // Cards in server (deck) order; the player view applies its own shuffled order.
  const [cards, setCards] = useState([]);
  const [order, setOrder] = useState([]);
  const [shuffles, setShuffles] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const [view, setView] = useState(startRoute.view);
  const [timerOpen, setTimerOpen] = useState(false);
  const [focusCard, setFocusCard] = useState('');
  const [revision, setRevision] = useState(0);
  const [retry, setRetry] = useState(0);
  const isAdmin = Boolean(session?.user?.isAdmin);
  const activeView = isAdmin ? view : 'play';
  // Players only see games they can play; administrators also see empty decks.
  const playableGames = useMemo(
    () => (isAdmin ? games : games.filter((game) => game.cardCount > 0)),
    [games, isAdmin],
  );

  function selectGame(game) {
    if (game) rememberLastGame(game.id);
    setSelectedGame(game);
    setSelectedCategory(null);
    setCards([]);
    setOrder([]);
    setLoading(Boolean(game));
    setFocusCard('');
    setError('');
  }
  // Opens the game named in the starting URL once the game list has loaded.
  // Returns whether a game was selected (it then keeps the loading state).
  const openStartGame = useEffectEvent((games) => {
    const id = pendingGame.current;
    pendingGame.current = '';
    if (!id) return false;
    const game = games.find((item) => item.id === id);
    if (game) selectGame(game);
    else setError('That game is not available. Choose another game.');
    return Boolean(game);
  });

  useEffect(() => {
    let active = true;
    Promise.all([DataManager.fetchGames(), DataManager.fetchSession()])
      .then(([games, session]) => {
        if (!active) return;
        setGames(games);
        setSession(session);
        setError('');
        if (!openStartGame(games)) setLoading(false);
      })
      .catch((error) => {
        if (active) {
          setError(error.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [retry]);

  useEffect(() => {
    if (!selectedGame) return;
    let active = true;
    DataManager.fetchGameData(selectedGame.id)
      .then((data) => {
        if (active) {
          setCards(data);
          setOrder(deckOrder(selectedGame.id, data));
          setError('');
        }
      })
      .catch((error) => {
        if (active) {
          setError(error.message);
          setCards([]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedGame, revision]);

  // Keep the address bar in step with the screen: new screens push a history
  // entry, and the first sync replaces the entry the page was loaded from.
  useEffect(() => {
    if (!session) return;
    const path = routePath(activeView, selectedGame);
    if (path !== location.pathname) {
      if (routeSynced.current) history.pushState(null, '', path);
      else history.replaceState(null, '', path);
    }
    routeSynced.current = true;
  }, [session, activeView, selectedGame]);

  const onPopState = useEffectEvent(() => {
    const route = parseRoute(location.pathname);
    setView(route.view);
    setFocusCard('');
    if (route.view === 'games' || route.view === 'reports') return;
    const game = games.find((item) => item.id === route.gameId) || null;
    if ((game?.id ?? null) !== (selectedGame?.id ?? null)) selectGame(game);
  });
  useEffect(() => {
    const listener = () => onPopState();
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, []);

  const round = useRound();
  const scoreboard = useScoreboard();
  // Each category with how many cards it holds, for the category picker.
  const categories = useMemo(() => {
    const counts = new Map();
    for (const card of cards)
      if (card.Category)
        counts.set(card.Category, (counts.get(card.Category) || 0) + 1);
    return [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cards]);
  const playCards = useMemo(() => {
    const byId = new Map(cards.map((card) => [card.id, card]));
    return order
      .map((id) => byId.get(id))
      .filter(
        (card) =>
          card && (!selectedCategory || card.Category === selectedCategory),
      );
  }, [cards, order, selectedCategory]);

  function reshuffle() {
    setOrder(deckOrder(selectedGame.id, cards, true));
    setShuffles((value) => value + 1);
  }
  function refreshCards() {
    setLoading(true);
    setRevision((value) => value + 1);
    DataManager.fetchGames()
      .then(setGames)
      .catch((error) => setError(error.message));
  }
  async function refreshGames() {
    const updated = await DataManager.fetchGames();
    setGames(updated);
    if (selectedGame) {
      const current = updated.find((game) => game.id === selectedGame.id);
      setSelectedGame(current || null);
      setSelectedCategory(null);
      setCards([]);
      setLoading(Boolean(current));
    }
  }
  async function logout() {
    try {
      await DataManager.logout();
      setSession(await DataManager.fetchSession());
      setView('play');
      if (selectedGame) refreshCards();
    } catch (error) {
      setError(error.message);
    }
  }
  function onVote(id, feedback) {
    setCards((previous) =>
      previous.map((card) =>
        card.id === id ? { ...card, ...feedback } : card,
      ),
    );
  }

  const compact = Boolean(selectedGame) || activeView !== 'play';
  const deckBar = (play) =>
    selectedGame && (
      <DeckBar
        games={play ? playableGames : games}
        game={selectedGame}
        onSelectGame={selectGame}
        onHome={() => selectGame(null)}
        {...(play && {
          categories: selectedGame.hasCategories ? categories : [],
          category: selectedCategory,
          onCategory: setSelectedCategory,
          onReshuffle: reshuffle,
          timerOpen,
          onTimer: () => setTimerOpen((value) => !value),
        })}
      />
    );
  let content;
  if (activeView === 'reports')
    content = (
      <AdminReports
        games={games}
        onOpenCards={(game, id) => {
          selectGame(game);
          setFocusCard(id);
          setView('cards');
        }}
      />
    );
  else if (activeView === 'games')
    content = (
      <GameManager
        games={games}
        onChanged={refreshGames}
        onOpenCards={(game) => {
          selectGame(game);
          setView('cards');
        }}
      />
    );
  else if (!session) content = null;
  else if (!selectedGame)
    content = (
      <GameSelector
        games={activeView === 'cards' ? games : playableGames}
        onSelectGame={selectGame}
        intro={
          activeView === 'play'
            ? 'Pick a deck and pass the phone around. Swipe or use the ← → keys to move between cards.'
            : ''
        }
        continueGame={
          activeView === 'play'
            ? playableGames.find((game) => game.id === lastGameId())
            : null
        }
        heading={
          activeView === 'cards'
            ? 'Choose a game to manage'
            : 'Choose a game to play'
        }
      />
    );
  else if (activeView === 'cards')
    content = (
      <>
        {deckBar(false)}
        <CardManager
          key={`${selectedGame.id}:${selectedGame.version}:${focusCard}`}
          game={selectedGame}
          games={games}
          cards={cards}
          focusCard={focusCard}
          onChanged={refreshCards}
          loading={loading}
        />
      </>
    );
  else
    content = (
      <>
        {deckBar(true)}
        {timerOpen && (
          <RoundTimer
            round={round}
            scoreboard={scoreboard}
            onClose={() => {
              round.reset();
              setTimerOpen(false);
            }}
          />
        )}
        {loading ? (
          <p className="empty-state" role="status">
            Shuffling the deck…
          </p>
        ) : (
          <CardViewer
            key={`${selectedGame.id}:${selectedCategory || ''}:${shuffles}`}
            cards={playCards}
            gameId={selectedGame.id}
            filter={selectedCategory || ''}
            session={session}
            onVote={onVote}
            onReshuffle={reshuffle}
            revealDescription={selectedGame.revealDescription}
            round={timerOpen ? round : null}
          />
        )}
      </>
    );

  return (
    <div className="app-container">
      <AuroraBokehBackground />
      <header className={`app-header${compact ? ' compact' : ''}`}>
        <h1>
          <button
            className="brand"
            onClick={() => {
              selectGame(null);
              setView('play');
            }}
          >
            <Layers
              size={32}
              color="var(--accent-primary)"
              aria-hidden="true"
            />
            <span className="brand-name">Shabab JorBox</span>
          </button>
        </h1>
        {!compact && <p className="subtitle">Companion App</p>}
        <div className="account-bar">
          {session?.user ? (
            <>
              <span>
                Signed in as <strong>{session.user.login}</strong>
                {isAdmin && ' · Administrator'}
              </span>
              <button className="btn-secondary" onClick={logout}>
                Sign out
              </button>
            </>
          ) : (
            session?.githubEnabled && (
              <a
                className="btn-secondary"
                href="/api/auth/github"
                onClick={rememberReturn}
              >
                <Github size={18} aria-hidden="true" /> Sign in with GitHub
              </a>
            )
          )}
        </div>
      </header>
      {isAdmin && (
        <nav className="tab-bar" aria-label="Sections">
          {VIEWS.map(([id, label]) => (
            <button
              key={id}
              className="tab"
              aria-current={activeView === id ? 'page' : undefined}
              onClick={() => {
                setView(id);
                setFocusCard('');
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      <main>
        {error && (
          <div className="error notice" role="alert">
            {error}{' '}
            <button
              className="btn-secondary"
              onClick={() => {
                setLoading(true);
                setRetry((value) => value + 1);
                if (selectedGame) refreshCards();
              }}
            >
              Retry
            </button>
          </div>
        )}
        {loading && !session && !error ? (
          <p className="empty-state" role="status">
            Loading games…
          </p>
        ) : (
          <Suspense
            fallback={
              <p className="empty-state" role="status">
                Loading…
              </p>
            }
          >
            {content}
          </Suspense>
        )}
      </main>
      <footer>
        <p>&copy; {new Date().getFullYear()} Shabab JorBox</p>
        <p>Like or dislike cards to help improve the decks.</p>
      </footer>
    </div>
  );
}
