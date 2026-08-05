import React, { useState, useEffect, useMemo } from 'react';
import { DataManager } from './utils/DataManager';
import GameSelector from './components/GameSelector';
import CardViewer from './components/CardViewer';
import CategorySelector from './components/CategorySelector';

import AuroraBokehBackground from './components/AuroraBokehBackground';
import { Layers } from 'lucide-react';

// Fisher-Yates shuffle (unbiased, unlike sort(() => Math.random() - 0.5))
const shuffle = (items) => {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

function App() {
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [cards, setCards] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch games registry on mount
  useEffect(() => {
    const loadGames = async () => {
      const gamesData = await DataManager.fetchGames();
      setGames(gamesData);
      setLoading(false);
    };
    loadGames();
  }, []);

  // Fetch game data when a game is selected
  useEffect(() => {
    const loadGameData = async () => {
      if (!selectedGame) {
        setCards([]);
        return;
      }

      setLoading(true);
      try {
        const data = await DataManager.fetchGameData(selectedGame.csv);
        setCards(shuffle(data));
        // Reset category when game changes
        setSelectedCategory(null);
      } catch (error) {
        console.error('Failed to load game data:', error);
        setCards([]);
      } finally {
        setLoading(false);
      }
    };

    loadGameData();
  }, [selectedGame]);

  // Extract unique categories if the game supports it
  const categories = useMemo(() => {
    if (!selectedGame?.hasCategories || !cards.length) return [];
    const uniqueCategories = new Set(cards.map(card => card.Category).filter(Boolean));
    return Array.from(uniqueCategories).sort();
  }, [selectedGame, cards]);

  // Filter cards based on selected category
  const filteredCards = useMemo(() => {
    if (!selectedCategory) return cards;
    return cards.filter(card => card.Category === selectedCategory);
  }, [cards, selectedCategory]);

  return (
    <div className="app-container" style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
      <AuroraBokehBackground />
      <header style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '1rem',
          background: 'rgba(255,255,255,0.05)',
          padding: '1rem 2rem',
          borderRadius: '50px',
          border: '1px solid var(--border-color)'
        }}>
          <Layers size={32} color="var(--accent-primary)" />
          <h1 style={{
            fontSize: '2rem',
            fontWeight: '800',
            letterSpacing: '-0.5px',
            fontFamily: 'var(--font-heading)',
            background: 'linear-gradient(120deg, #ffffff 0%, #cbd5e1 55%, var(--accent-primary) 100%)', /* --jb-gradient-text style */
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            Shabab JorBox
          </h1>
        </div>
        <p style={{
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-heading)',
          fontSize: '1.1rem',
          fontWeight: '300',
          letterSpacing: '1px',
          textTransform: 'uppercase'
        }}>
          Companion App
        </p>
      </header>

      <main>
        <GameSelector
          games={games}
          selectedGame={selectedGame}
          onSelectGame={setSelectedGame}
        />

        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
            Loading...
          </div>
        ) : (
          <>
            {selectedGame && selectedGame.hasCategories && (
              <CategorySelector
                categories={categories}
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
              />
            )}

            {selectedGame && (
              <CardViewer cards={filteredCards} />
            )}
          </>
        )}
      </main>

      <footer style={{
        textAlign: 'center',
        marginTop: '4rem',
        color: 'var(--text-secondary)',
        fontSize: '0.9rem',
        borderTop: '1px solid var(--border-color)',
        paddingTop: '2rem'
      }}>
        <p>&copy; {new Date().getFullYear()} Shabab JorBox</p>
        <p style={{ marginTop: '0.5rem' }}>For corrections, edits and additions contact thehaseebshah@zohomail.in</p>
      </footer>
    </div>
  );
}

export default App;
