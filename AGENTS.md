# AGENTS.md

## Project Overview
**Shabab JorBox Companion App** is a static React application designed to serve as a companion for physical card games. It allows users to select a game, filter cards by category (if applicable), and view card details (Name, Description) with a premium, glassmorphic UI.

## Tech Stack
- **Framework**: React 18 + Vite
- **Language**: JavaScript (ES6+)
- **Styling**: Vanilla CSS with CSS Variables (Glassmorphism, Dark Mode)
- **Icons**: `lucide-react`
- **Data Parsing**: `papaparse` (CSV to JSON)
- **Deployment**: GitHub Pages (via GitHub Actions)

## Project Structure
```
/
├── public/
│   ├── games.json        # Registry of available games
│   └── data/             # CSV files containing card data
├── src/
│   ├── components/       # UI Components (GameSelector, CardViewer, CategorySelector)
│   ├── utils/            # DataManager.js (CSV fetching/parsing)
│   ├── App.jsx           # Main application logic
│   └── index.css         # Global styles & variables
└── vite.config.js        # Vite configuration (base path set for GH Pages)
```

## Data Architecture
### `games.json`
Registry of games.
```json
[
  {
    "id": "game-id",
    "name": "Game Name",
    "csv": "/data/filename.csv",
    "hasCategories": true/false
  }
]
```

### CSV Format
Columns vary per game; every file has at least a `Name` or `Description` column. `Category` is present only when the game has real categories (mirrors `hasCategories` in `games.json`).
```csv
Name,Description,Category
Card Name,Card Description,CategoryName
```
*Known shapes in use: `Name,Description,Category` (most games), `Description,Category` (game7, game14), `Name,Description` (game9, game11), `Name` only (game10, game12), `Description` only (game6, game13), `Name,Category` (game16).*
*CardViewer renders whichever of `Name`/`Description`/`Category` exist, so partial shapes are safe.*

## Key Components
- **GameSelector**: Dropdown to switch games.
- **CategorySelector**: Dropdown to filter cards (only shown if `hasCategories` is true).
- **CardViewer**: Displays current card with Next/Prev navigation.

## Styling Guidelines
- **Theme**: Dark mode with glassmorphism.
- **Fonts**:
  - Headings: 'Outfit' (Sans-serif, Bold)
  - Body: 'Inter' (Sans-serif)
- **Colors**: defined in `index.css` (`--bg-primary`, `--accent-primary`, etc.)

## Deployment
- **Platform**: GitHub Pages
- **Workflow**: `.github/workflows/deploy.yml`
- **Trigger**: Push to `main` branch.
- **Base URL**: configured as `/jorbox/` in `vite.config.js`.

## Development
1. **Install**: `npm install`
2. **Dev Server**: `npm run dev`
3. **Build**: `npm run build`
4. **Preview**: `npm run preview`
