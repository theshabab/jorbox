import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { DataManager } from '../utils/DataManager';
import { exportCardCsv, parseCardCsv } from '../utils/cardCsv';
import {
  CARD_FORMATS,
  MAX_BODY_BYTES,
  MAX_BULK_ROWS,
  cardErrors,
} from '../utils/cardFormats';
import CardFields from './CardFields';
import BulkCardEditor from './BulkCardEditor';
import DuplicateCards from './DuplicateCards';
import CopyCards from './CopyCards';
import CategoryManager from './CategoryManager';
import Dialog from './Dialog';

const PAGE_SIZE = 50;
const emptyCard = { Name: '', Description: '', Category: '' };
const cardLabel = (card) =>
  card.Name || card.Description?.slice(0, 80) || card.id;
const wideScreen = () =>
  typeof matchMedia !== 'function' || matchMedia('(min-width: 700px)').matches;
const pastTense = {
  import: 'added',
  edit: 'updated',
  feedback: 'rated',
  restore: 'restored',
  remove: 'removed',
};
const verb = { import: 'add', edit: 'update' };

// Shows what an edit replaces, so a blank CSV column cannot clear text unnoticed.
function CardDiff({ row, original, fields }) {
  const changes = fields.filter(
    (field) => (row[field] ?? '') !== (original?.[field] ?? ''),
  );
  if (!changes.length) return <p className="muted">No changes.</p>;
  return (
    <dl className="diff">
      {changes.map((field) => (
        <div key={field}>
          <dt>{field}</dt>
          <dd>
            <del>{original?.[field] || '(empty)'}</del>
            <ins>{row[field] || '(cleared)'}</ins>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function CardManager({
  game,
  cards,
  games,
  onChanged,
  loading,
  focusCard = '',
}) {
  const [search, setSearch] = useState(focusCard);
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState([]);
  const [editor, setEditor] = useState(null);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState('import');
  const [csvText, setCsvText] = useState('');
  const [targetCategory, setTargetCategory] = useState('');
  const [removed, setRemoved] = useState(false);
  const [trash, setTrash] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashRevision, setTrashRevision] = useState(0);
  const [page, setPage] = useState(0);
  const [bulkEditor, setBulkEditor] = useState(null);
  const [feedbackFilter, setFeedbackFilter] = useState('all');
  const [sort, setSort] = useState('deck');
  const [duplicates, setDuplicates] = useState(false);
  const [copying, setCopying] = useState(null);
  const [managingCategories, setManagingCategories] = useState(false);
  const [filtersOpen] = useState(wideScreen);
  const query = useDeferredValue(search.toLowerCase());
  useEffect(() => {
    if (!removed) return;
    let active = true;
    DataManager.fetchGameData(game.id, true)
      .then((data) => {
        if (active) setTrash(data);
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setTrashLoading(false);
      });
    return () => {
      active = false;
    };
  }, [removed, game.id, trashRevision]);
  const source = removed ? trash : cards;
  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          [...cards, ...trash].map((card) => card.Category).filter(Boolean),
        ),
      ).sort(),
    [cards, trash],
  );
  const searchText = useMemo(
    () =>
      new Map(
        source.map((card) => [
          card.id,
          `${card.id} ${card.Name} ${card.Description} ${card.Category}`.toLowerCase(),
        ]),
      ),
    [source],
  );
  const filtered = useMemo(() => {
    const rows = source.filter(
      (card) =>
        (!category || card.Category === category) &&
        (!query || searchText.get(card.id).includes(query)) &&
        (feedbackFilter === 'all' ||
          (feedbackFilter === 'liked' && card.myVote === 1) ||
          (feedbackFilter === 'disliked' && card.myVote === -1) ||
          (feedbackFilter === 'unrated' && !card.myVote)),
    );
    if (sort !== 'deck')
      rows.sort((a, b) =>
        sort === 'name'
          ? cardLabel(a).localeCompare(cardLabel(b))
          : b[sort] - a[sort] || a.id.localeCompare(b.id),
      );
    return rows;
  }, [source, category, query, searchText, feedbackFilter, sort]);
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const selection = useMemo(
    () => source.filter((card) => selectedIds.has(card.id)),
    [source, selectedIds],
  );
  const preview = useMemo(
    () => (csvText ? parseCardCsv(csvText, game, mode) : null),
    [csvText, game, mode],
  );
  const contentFields = [
    ...(game.cardFormat === 'description' ? [] : ['Name']),
    ...(game.cardFormat === 'name' ? [] : ['Description']),
    ...(game.hasCategories ? ['Category'] : []),
  ];
  const locked = busy || loading || trashLoading;
  const activeFilters =
    Boolean(search) +
    Boolean(category) +
    (feedbackFilter !== 'all') +
    (sort !== 'deck') +
    removed;
  function closePanels() {
    setPending(null);
    setBulkEditor(null);
    setCopying(null);
  }
  function changeFilter(update) {
    update();
    setPage(0);
    setSelected([]);
    closePanels();
  }
  function selectOnly(ids) {
    setSelected(ids.slice(0, MAX_BULK_ROWS));
    closePanels();
  }
  function toggle(id) {
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : previous.length < MAX_BULK_ROWS
          ? [...previous, id]
          : previous,
    );
    closePanels();
  }
  function exportCsv() {
    const exportRows = selection.length ? selection : filtered;
    const blob = new Blob([exportCardCsv(exportRows)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${game.id}${removed ? '-removed' : ''}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function readCsv(event) {
    const file = event.target.files?.[0];
    setError('');
    if (!file) return;
    if (file.size > MAX_BODY_BYTES) {
      setError(`CSV must be at most ${MAX_BODY_BYTES / 1024} KB.`);
      return;
    }
    try {
      setCsvText(await file.text());
      setPending(null);
    } catch {
      setError('Unable to read this file.');
    }
    event.target.value = '';
  }
  function review(action, rows, value) {
    setError('');
    setMessage('');
    setPending({ action, rows, value });
  }
  async function commit() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await DataManager.bulk(
        game.id,
        pending.action,
        pending.rows,
        pending.value,
      );
      setMessage(
        `${result.changed} card${result.changed === 1 ? '' : 's'} ${pastTense[pending.action]}.`,
      );
      closePanels();
      setEditor(null);
      setSelected([]);
      setCsvText('');
      setPage(0);
      if (removed) {
        setTrashLoading(true);
        setTrashRevision((value) => value + 1);
      }
      onChanged();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  function refresh() {
    closePanels();
    setEditor(null);
    setSelected([]);
    setError('');
    setPage(0);
    if (removed) {
      setTrashLoading(true);
      setTrashRevision((value) => value + 1);
    }
    onChanged();
  }
  const pendingOriginal = (row) => source.find((card) => card.id === row.id);
  const changedCount =
    pending?.action === 'edit'
      ? pending.rows.filter((row) =>
          contentFields.some(
            (field) =>
              (row[field] ?? '') !== (pendingOriginal(row)?.[field] ?? ''),
          ),
        ).length
      : 0;
  return (
    <section className="glass-panel manager" aria-label="Card management">
      <div className="manager-heading">
        <div>
          <h2>Manage {game.name}</h2>
          <p className="muted">
            Add cards, review feedback, and make bulk changes. Up to{' '}
            {MAX_BULK_ROWS} cards per change.
          </p>
        </div>
        <button className="btn-secondary" disabled={busy} onClick={refresh}>
          Refresh
        </button>
      </div>
      <div className="notices">
        {error && !pending && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice success" role="status">
            {message}
          </p>
        )}
      </div>
      <fieldset disabled={locked}>
        <details className="drawer" open={filtersOpen}>
          <summary>
            Filters & sort
            {activeFilters > 0 && (
              <span className="badge">{activeFilters} active</span>
            )}
          </summary>
          <div className="manager-filters">
            <label>
              Search cards
              <input
                type="search"
                value={search}
                onChange={(event) =>
                  changeFilter(() => setSearch(event.target.value))
                }
                placeholder="Name or description"
              />
            </label>
            {game.hasCategories && (
              <label>
                Category
                <select
                  aria-label="Category"
                  value={category}
                  onChange={(event) =>
                    changeFilter(() => setCategory(event.target.value))
                  }
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Show
              <select
                aria-label="Show"
                value={removed ? 'removed' : 'active'}
                onChange={(event) =>
                  changeFilter(() => {
                    const value = event.target.value === 'removed';
                    setRemoved(value);
                    setTrashLoading(value);
                    setEditor(null);
                  })
                }
              >
                <option value="active">Active cards</option>
                <option value="removed">Removed cards</option>
              </select>
            </label>
            <label>
              My feedback
              <select
                aria-label="My feedback"
                value={feedbackFilter}
                onChange={(event) =>
                  changeFilter(() => setFeedbackFilter(event.target.value))
                }
              >
                <option value="all">All feedback</option>
                <option value="liked">My likes</option>
                <option value="disliked">My dislikes</option>
                <option value="unrated">Not rated by me</option>
              </select>
            </label>
            <label>
              Sort by
              <select
                aria-label="Sort by"
                value={sort}
                onChange={(event) =>
                  changeFilter(() => setSort(event.target.value))
                }
              >
                <option value="deck">Deck order</option>
                <option value="name">Name / description</option>
                <option value="likes">Most likes</option>
                <option value="dislikes">Most dislikes</option>
              </select>
            </label>
          </div>
        </details>
        <div className="toolbar">
          {!removed && (
            <button
              className="btn-primary"
              onClick={() => {
                setEditor({ ...emptyCard, Category: category });
                closePanels();
              }}
            >
              Add a card
            </button>
          )}
          {!removed && (
            <button
              className="btn-secondary"
              onClick={() => setDuplicates(true)}
            >
              Find duplicates
            </button>
          )}
          {game.hasCategories && (
            <button
              className="btn-secondary"
              onClick={() => setManagingCategories(true)}
            >
              Manage categories
            </button>
          )}
          <button
            className="btn-secondary"
            disabled={!filtered.length}
            onClick={exportCsv}
          >
            Export{' '}
            {selection.length
              ? `${selection.length} selected`
              : `${filtered.length} matching`}{' '}
            cards
          </button>
        </div>
        {!removed && (
          <details className="drawer import-panel">
            <summary>Bulk import & CSV edits</summary>
            <p className="muted">
              Upload a CSV with Name and/or Description
              {game.hasCategories ? ', and Category' : ''}. To edit existing
              cards, export them first and keep their id and version columns.
              Updates replace every content field; blank fields clear existing
              text. You will see every change before it is saved.
            </p>
            <label>
              Import mode
              <select
                aria-label="Import mode"
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value);
                  setPending(null);
                }}
              >
                <option value="import">Add as new cards</option>
                <option value="edit">Update existing cards by ID</option>
                <option value="feedback">Update my feedback by ID</option>
              </select>
            </label>
            {mode === 'feedback' && (
              <p className="muted">
                Keep exported id/version columns and set myVote to 1 (like), -1
                (dislike), or 0 (clear). Only your feedback changes; aggregate
                counts are read-only.
              </p>
            )}
            <label>
              CSV file
              <input type="file" accept=".csv,text/csv" onChange={readCsv} />
            </label>
            {preview && (
              <div className="csv-preview">
                <strong>
                  {preview.cards.length} rows to{' '}
                  {mode === 'edit'
                    ? 'update'
                    : mode === 'feedback'
                      ? 'rate'
                      : 'add'}
                </strong>
                {preview.errors.length ? (
                  <ul className="error">
                    {preview.errors.slice(0, 20).map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                ) : (
                  <>
                    <p className="muted">
                      {mode === 'import'
                        ? 'These will be new cards, even if similar cards already exist.'
                        : 'Only matching IDs in this game will be updated. Stale versions stop the whole update.'}
                    </p>
                    <ol>
                      {preview.cards.slice(0, 5).map((card, index) => (
                        <li key={index}>
                          {cardLabel(card)}
                          {card.Category && ` · ${card.Category}`}
                          {mode === 'feedback' &&
                            ` · ${card.value === 1 ? 'Like' : card.value === -1 ? 'Dislike' : 'Clear my feedback'}`}
                        </li>
                      ))}
                    </ol>
                    <button
                      className="btn-primary"
                      onClick={() => review(mode, preview.cards)}
                    >
                      Review {preview.cards.length}{' '}
                      {mode === 'edit'
                        ? 'updates'
                        : mode === 'feedback'
                          ? 'feedback changes'
                          : 'new cards'}
                    </button>
                  </>
                )}
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setCsvText('');
                    setPending(null);
                  }}
                >
                  Clear file
                </button>
              </div>
            )}
          </details>
        )}
        <div className="toolbar selection-tools" aria-label="Selection">
          <button
            className="btn-secondary"
            onClick={() => selectOnly(visible.map((card) => card.id))}
            disabled={!visible.length}
          >
            Select this page
          </button>
          <button
            className="btn-secondary"
            onClick={() => selectOnly(filtered.map((card) => card.id))}
            disabled={!filtered.length}
          >
            Select first {Math.min(MAX_BULK_ROWS, filtered.length)} matching
          </button>
          <button
            className="btn-secondary"
            disabled={!selection.length}
            onClick={() => selectOnly([])}
          >
            Clear selection
          </button>
        </div>
        {selection.length > 0 && (
          <div className="selection-bar">
            <strong>{selection.length} selected</strong>
            {!removed && (
              <>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    closePanels();
                    setEditor(null);
                    setCopying(selection);
                  }}
                >
                  Copy selected cards
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    closePanels();
                    setEditor(null);
                    setBulkEditor(selection);
                  }}
                >
                  Edit selected cards
                </button>
                {[
                  [1, 'Like selected'],
                  [-1, 'Dislike selected'],
                  [0, 'Clear my feedback'],
                ].map(([value, label]) => (
                  <button
                    key={label}
                    className="btn-secondary"
                    onClick={() =>
                      review(
                        'feedback',
                        selection.map(({ id, version }) => ({ id, version })),
                        value,
                      )
                    }
                  >
                    {label}
                  </button>
                ))}
              </>
            )}
            {!removed && game.hasCategories && (
              <>
                <label>
                  Move to category
                  <input
                    list="manager-categories"
                    value={targetCategory}
                    maxLength={200}
                    onChange={(event) => {
                      setTargetCategory(event.target.value);
                      setPending(null);
                    }}
                  />
                </label>
                <button
                  className="btn-secondary"
                  disabled={!targetCategory.trim()}
                  onClick={() =>
                    review(
                      'edit',
                      selection.map((card) => ({
                        ...card,
                        Category: targetCategory.trim(),
                      })),
                    )
                  }
                >
                  Review category change
                </button>
              </>
            )}
            <button
              className={removed ? 'btn-secondary' : 'btn-danger-quiet'}
              onClick={() =>
                review(
                  removed ? 'restore' : 'remove',
                  selection.map(({ id, version }) => ({ id, version })),
                )
              }
            >
              {removed ? 'Review restore' : 'Review removal'}
            </button>
          </div>
        )}
        {locked && <p role="status">Loading cards…</p>}
        <div className="table-scroll">
          <table className="stack-table">
            <thead>
              <tr>
                <th>
                  <span className="sr-only">Select</span>
                </th>
                <th>Card</th>
                {game.hasCategories && <th>Category</th>}
                <th>Feedback</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((card) => (
                <tr key={card.id}>
                  <td className="select-cell">
                    <input
                      type="checkbox"
                      aria-label={`Select ${cardLabel(card)}`}
                      checked={selectedIds.has(card.id)}
                      onChange={() => toggle(card.id)}
                      disabled={
                        !selectedIds.has(card.id) &&
                        selected.length >= MAX_BULK_ROWS
                      }
                    />
                  </td>
                  <td>
                    <strong>{card.Name}</strong>
                    <p className="table-description">{card.Description}</p>
                  </td>
                  {game.hasCategories && (
                    <td data-label="Category">{card.Category}</td>
                  )}
                  <td className="feedback-count" data-label="Feedback">
                    +{card.likes} / −{card.dislikes}
                    <span className="muted">
                      {' '}
                      · Mine:{' '}
                      {card.myVote === 1
                        ? 'Like'
                        : card.myVote === -1
                          ? 'Dislike'
                          : 'None'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      {!removed && (
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            closePanels();
                            setEditor({ ...card });
                          }}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        className={
                          removed ? 'btn-secondary' : 'btn-danger-quiet'
                        }
                        onClick={() =>
                          review(removed ? 'restore' : 'remove', [
                            { id: card.id, version: card.version },
                          ])
                        }
                      >
                        {removed ? 'Restore' : 'Remove'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && !locked && (
          <p className="empty-state">No matching cards.</p>
        )}
        <div className="button-row pagination">
          <button
            className="btn-secondary"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous page
          </button>
          <span>
            {filtered.length.toLocaleString()} cards · Page {page + 1} of{' '}
            {Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}
          </span>
          <button
            className="btn-secondary"
            disabled={(page + 1) * PAGE_SIZE >= filtered.length}
            onClick={() => setPage((value) => value + 1)}
          >
            Next page
          </button>
        </div>
        <datalist id="manager-categories">
          {categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
      </fieldset>
      {duplicates && (
        <Dialog
          title="Duplicate card detection"
          wide
          onClose={() => setDuplicates(false)}
        >
          <DuplicateCards
            cards={cards}
            onSelect={(ids) => {
              setSearch('');
              setCategory('');
              setFeedbackFilter('all');
              setPage(0);
              selectOnly(ids);
              setDuplicates(false);
            }}
          />
        </Dialog>
      )}
      {managingCategories && (
        <Dialog
          title="Category manager"
          wide
          onClose={() => setManagingCategories(false)}
        >
          <CategoryManager game={game} onChanged={refresh} />
        </Dialog>
      )}
      {copying && (
        <Dialog
          title={`Copy ${copying.length} cards to another game`}
          wide
          onClose={() => setCopying(null)}
        >
          <CopyCards
            sourceGame={game}
            cards={copying}
            games={games}
            onCancel={() => setCopying(null)}
            onCopied={(message) => {
              setMessage(message);
              setCopying(null);
              setSelected([]);
              onChanged();
            }}
          />
        </Dialog>
      )}
      {editor && (
        <Dialog
          title={editor.id ? 'Edit card' : 'New card'}
          onClose={() => {
            setEditor(null);
            setPending(null);
          }}
        >
          <form
            className="editor"
            onSubmit={(event) => {
              event.preventDefault();
              review(editor.id ? 'edit' : 'import', [editor]);
            }}
          >
            <CardFields
              card={editor}
              game={game}
              onChange={(card) => {
                setEditor(card);
                setPending(null);
              }}
            />
            <p className="muted">
              {CARD_FORMATS.find((format) => format.value === game.cardFormat)
                ?.help || 'A name or description is required.'}{' '}
              {game.hasCategories && 'Typing a new category creates it.'}
            </p>
            <div className="button-row">
              <button
                className="btn-primary"
                disabled={cardErrors(editor, game).length > 0}
                type="submit"
              >
                Review card
              </button>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => {
                  setEditor(null);
                  setPending(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {bulkEditor && (
        <Dialog
          title={`Edit ${bulkEditor.length} selected cards`}
          wide
          onClose={() => closePanels()}
        >
          <BulkCardEditor
            cards={bulkEditor}
            game={game}
            onDraftChange={() => setPending(null)}
            onReview={(rows) => review('edit', rows)}
            onCancel={() => closePanels()}
          />
        </Dialog>
      )}
      {pending && (
        <Dialog
          title={`Confirm ${pending.rows.length} card${pending.rows.length === 1 ? '' : 's'} to ${verb[pending.action] || pending.action}`}
          wide
          onClose={() => !busy && setPending(null)}
        >
          <div className="review-panel" aria-label="Review changes">
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <p>
              {pending.action === 'remove'
                ? 'These cards will leave the playable deck. You can restore them from Removed cards.'
                : pending.action === 'restore'
                  ? 'These cards will return to the playable deck with their feedback.'
                  : pending.action === 'feedback'
                    ? 'Only your own feedback changes. Other players’ votes stay as they are.'
                    : pending.action === 'edit'
                      ? `${changedCount} of ${pending.rows.length} cards change. Old text is struck through; new text is highlighted.`
                      : 'Review the content below before saving.'}
            </p>
            <ul className="review-items">
              {pending.rows.map((row, index) => {
                const original = pendingOriginal(row);
                return (
                  <li key={row.id || index}>
                    <strong>
                      {original ? cardLabel(original) : cardLabel(row)}
                    </strong>
                    {pending.action === 'edit' ? (
                      <CardDiff
                        row={row}
                        original={original}
                        fields={contentFields}
                      />
                    ) : (
                      <>
                        {(row.Description ?? original?.Description) && (
                          <p>{row.Description ?? original.Description}</p>
                        )}
                        {row.Category && (
                          <span className="category-badge">{row.Category}</span>
                        )}
                      </>
                    )}
                    {pending.action === 'feedback' && (
                      <p>
                        {(row.value ?? pending.value) === 1
                          ? 'Like'
                          : (row.value ?? pending.value) === -1
                            ? 'Dislike'
                            : 'Clear my feedback'}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="button-row">
              <button
                className={
                  pending.action === 'remove' ? 'btn-danger' : 'btn-primary'
                }
                disabled={locked}
                onClick={commit}
              >
                {busy ? 'Saving…' : 'Confirm changes'}
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
