---
name: Review JorBox Cards
description: A guide for reviewing, filtering, and removing cards from JorBox game data (CSVs) to ensure they are culturally appropriate, Halal, and high-quality.
---

# Reviewing JorBox Cards

This skill outlines the process for auditing game cards in the JorBox application (specifically within `data/seed/data/*.csv`). The primary goal is to curate content that is **Family-Friendly**, **Halal**, and **Culturally Relevant (Pakistani/Desi)**, while removing Western-centric or inappropriate references.

## 1. Card Location
*   **Game Data:** All game content is stored in CSV format in:
    *   `/data/seed/data/game1.csv` (Main)
    *   `/data/seed/data/game5.csv` (Haiwani Pattay - *Primary Focus*)
    *   Other game files as needed.
*   **Format:** typically `Description,Category` or `Name,Description,Category`.

## 2. Removal Guidelines (The "Haram" Filter)
You must **strictly remove** any card containing explicit references to:
*   **Alcohol:** Beer, wine, vodka, getting drunk, hangovers, bars.
*   **Explicit Intimacy:** Sex, nudity, bedroom secrets, "sleeping together", physical arousal.
*   **Dating/Romance (Western Style):** Boyfriends/girlfriends living together, casual dating. (Courtship/Rishta/Tea is acceptable).
*   **Drugs:** Hard drugs (cocaine, heroin).
*   **Vulgarity:** Extreme profanity or bathroom humor that crosses the line of decency.
*   **Religious Desecration:**
    *   **NO** making fun of religious rituals (Salah, Khutbah, Wudu).
    *   **NO** trivializing theological concepts (Prophets, Angels, Qayamat, Soul).
    *   **NO** placing religious terms in "silly" contexts (e.g., "I trade my soul/iman for...").

## 3. Cultural Adaptation Guidelines
If a card is clean but "boring" or "too Western":
*   **Replace Western Pop Culture:**
    *   *David Blaine* -> "A Jinn" or "The Magician"
    *   *Dr. Phil* -> "Aamir Liaquat" or "The Morning Show"
    *   *Florida Man* -> "Lahori Man" or "Pindi Boy"
*   **Replace Western Concepts:**
    *   *Prom/Homecoming* -> "Mehndi/Valima"
    *   *Bacon/Ham* -> "Nihari/Paye"
    *   *Dollars/401k* -> "Rupees/Committee"

## 4. How to Remove Cards

### A. Manual Block Review (Preferred for Quality)
1.  **Read:** Use `view_file` to read a block of 100-500 lines.
2.  **Identify:** Note line numbers of problematic cards.
3.  **Edit:** Use `multi_replace_file_content` to either:
    *   **Delete:** Replace the content with an empty string or remove the line (if tool supports line deletion, otherwise empty string and cleanup later).
    *   **Modify:** Reword the card to be culturally fit (e.g., change "Bar" to "Chai Dhaba").

### B. Automated Scripting (Preferred for Bulk Cleaning)
1.  Create a Python script to scan for specific keywords.
2.  Use lists of known "bad" words (e.g., `["vodka", "bacon", "dating app"]`).
3.  Read the CSV, filter out rows containing these words, and write back to the file.
4.  **Always** backup the file before mass-deleting.

## 5. Example Workflow

```python
# Example logic for a quick filter script
bad_words = ['beer', 'wine', 'dating']
new_rows = []
for row in reader:
    if not any(word in row[0].lower() for word in bad_words):
        new_rows.append(row)
```

## 6. Verification
After edit/removal:
1.  Check the total line count (`wc -l data/seed/data/game5.csv`).
2.  Read a random sample to ensure data integrity (lines didn't shift or break CSV format).
