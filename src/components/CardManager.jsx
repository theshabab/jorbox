import { useEffect, useMemo, useState } from 'react';
import { DataManager } from '../utils/DataManager';
import { exportCardCsv, parseCardCsv } from '../utils/cardCsv';
import { CARD_FORMATS, cardErrors } from '../utils/cardFormats';
import CardFields from './CardFields';
import BulkCardEditor from './BulkCardEditor';

const emptyCard = { Name: '', Description: '', Category: '' };

export default function CardManager({ game, cards, onChanged, loading }) {
  const [search, setSearch] = useState('');
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
  useEffect(() => {
    if (!removed) return;
    let active = true;
    DataManager.fetchGameData(game.id, true).then(data => { if (active) setTrash(data); })
      .catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setTrashLoading(false); });
    return () => { active = false; };
  }, [removed, game.id, trashRevision]);
  const source = removed ? trash : cards;
  const categories = useMemo(() => Array.from(new Set([...cards, ...trash].map(card => card.Category).filter(Boolean))).sort(), [cards, trash]);
  const filtered = source.filter(card => (!category || card.Category === category) && `${card.Name} ${card.Description} ${card.Category}`.toLowerCase().includes(search.toLowerCase()) &&
    (feedbackFilter === 'all' || (feedbackFilter === 'liked' && card.myVote === 1) || (feedbackFilter === 'disliked' && card.myVote === -1) || (feedbackFilter === 'unrated' && !card.myVote)));
  if (sort !== 'deck') filtered.sort((a, b) => sort === 'name' ? (a.Name || a.Description).localeCompare(b.Name || b.Description) : b[sort] - a[sort] || a.id.localeCompare(b.id));
  const visible = filtered.slice(page * 50, (page + 1) * 50);
  const selection = source.filter(card => selected.includes(card.id));
  const preview = useMemo(() => csvText ? parseCardCsv(csvText, game, mode) : null, [csvText, game, mode]);
  const locked = busy || loading || trashLoading;
  function changeFilter(update) { update(); setPage(0); setSelected([]); setPending(null); setBulkEditor(null); }
  function select(id) { setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : previous.length < 100 ? [...previous, id] : previous); setPending(null); setBulkEditor(null); }
  function exportCsv() {
    const exportRows = selection.length ? selection : filtered;
    const blob = new Blob([exportCardCsv(exportRows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${game.id}${removed ? '-removed' : ''}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function readCsv(event) {
    const file = event.target.files?.[0];
    setError('');
    if (!file) return;
    if (file.size > 512 * 1024) { setError('CSV must be at most 512 KB.'); return; }
    try { setCsvText(await file.text()); setPending(null); }
    catch { setError('Unable to read this file.'); }
    event.target.value = '';
  }
  function review(action, rows, value) { setError(''); setMessage(''); setPending({ action, rows, value }); }
  async function commit() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await DataManager.bulk(game.id, pending.action, pending.rows, pending.value);
      setMessage(`${result.changed} card${result.changed === 1 ? '' : 's'} ${pending.action === 'import' ? 'added' : pending.action === 'edit' ? 'updated' : pending.action === 'feedback' ? 'rated' : pending.action === 'restore' ? 'restored' : 'removed'}.`);
      setPending(null); setEditor(null); setBulkEditor(null); setSelected([]); setCsvText(''); setPage(0);
      if (removed) { setTrashLoading(true); setTrashRevision(value => value + 1); }
      onChanged();
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  function refresh() {
    setPending(null); setEditor(null); setBulkEditor(null); setSelected([]); setError(''); setPage(0);
    if (removed) { setTrashLoading(true); setTrashRevision(value => value + 1); }
    onChanged();
  }
  return <section className="glass-panel manager" aria-label="Card management">
    <div className="manager-heading"><div><h2>Manage {game.name}</h2><p className="muted">Add cards, review feedback, and make bulk changes. Up to 100 cards per change.</p></div><button className="btn-secondary" disabled={busy} onClick={refresh}>Refresh</button></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {message && <p className="notice success" role="status">{message}</p>}
    <fieldset disabled={locked}>
      <div className="manager-filters">
        <label>Search cards<input value={search} onChange={event => changeFilter(() => setSearch(event.target.value))} placeholder="Name or description" /></label>
        {game.hasCategories && <label>Category<select aria-label="Category" value={category} onChange={event => changeFilter(() => setCategory(event.target.value))}><option value="">All categories</option>{categories.map(category => <option key={category}>{category}</option>)}</select></label>}
        <label>Show<select aria-label="Show" value={removed ? 'removed' : 'active'} onChange={event => changeFilter(() => { const value = event.target.value === 'removed'; setRemoved(value); setTrashLoading(value); setEditor(null); })}><option value="active">Active cards</option><option value="removed">Removed cards</option></select></label>
        <label>My feedback<select aria-label="My feedback" value={feedbackFilter} onChange={event => changeFilter(() => setFeedbackFilter(event.target.value))}><option value="all">All feedback</option><option value="liked">My likes</option><option value="disliked">My dislikes</option><option value="unrated">Not rated by me</option></select></label>
        <label>Sort by<select aria-label="Sort by" value={sort} onChange={event => changeFilter(() => setSort(event.target.value))}><option value="deck">Deck order</option><option value="name">Name / description</option><option value="likes">Most likes</option><option value="dislikes">Most dislikes</option></select></label>
      </div>
      <div className="button-row toolbar">
        {!removed && <button className="btn-primary" onClick={() => { setEditor({ ...emptyCard, Category: category }); setBulkEditor(null); setPending(null); }}>Add a card</button>}
        <button className="btn-secondary" disabled={!filtered.length} onClick={exportCsv}>Export {selection.length ? `${selection.length} selected` : `${filtered.length} matching`} cards</button>
        <button className="btn-secondary" onClick={() => { setSelected(visible.slice(0, 100).map(card => card.id)); setPending(null); setBulkEditor(null); }} disabled={!visible.length}>Select this page</button>
        <button className="btn-secondary" onClick={() => { setSelected(filtered.slice(0, 100).map(card => card.id)); setPending(null); setBulkEditor(null); }} disabled={!filtered.length}>Select first {Math.min(100, filtered.length)} matching</button>
        <button className="btn-secondary" disabled={!selection.length} onClick={() => { setSelected([]); setPending(null); setBulkEditor(null); }}>Clear selection</button>
      </div>
      {selection.length > 0 && <div className="selection-bar">
        <strong>{selection.length} selected</strong>
        {!removed && <>
          <button className="btn-secondary" onClick={() => { setBulkEditor(selection); setEditor(null); setPending(null); }}>Edit selected cards</button>
          <button className="btn-secondary" onClick={() => review('feedback', selection.map(({ id, version }) => ({ id, version })), 1)}>Like selected</button>
          <button className="btn-secondary" onClick={() => review('feedback', selection.map(({ id, version }) => ({ id, version })), -1)}>Dislike selected</button>
          <button className="btn-secondary" onClick={() => review('feedback', selection.map(({ id, version }) => ({ id, version })), 0)}>Clear my feedback</button>
        </>}
        {!removed && game.hasCategories && <><label>Move to category<input list="manager-categories" value={targetCategory} maxLength={200} onChange={event => { setTargetCategory(event.target.value); setPending(null); }} /></label><button className="btn-secondary" disabled={!targetCategory.trim()} onClick={() => review('edit', selection.map(card => ({ ...card, Category: targetCategory.trim() })))}>Review category change</button></>}
        <button className={removed ? 'btn-secondary' : 'btn-danger'} onClick={() => review(removed ? 'restore' : 'remove', selection.map(({ id, version }) => ({ id, version })))}>{removed ? 'Review restore' : 'Review removal'}</button>
      </div>}
      {locked && <p role="status">Loading cards…</p>}
      <div className="table-scroll"><table><thead><tr><th><span className="sr-only">Select</span></th><th>Card</th>{game.hasCategories && <th>Category</th>}<th>Feedback</th><th>Actions</th></tr></thead><tbody>
        {visible.map(card => <tr key={card.id}>
          <td><input type="checkbox" aria-label={`Select ${card.Name || card.Description.slice(0, 60)}`} checked={selected.includes(card.id)} onChange={() => select(card.id)} disabled={!selected.includes(card.id) && selected.length >= 100} /></td>
          <td><strong>{card.Name}</strong><p className="table-description">{card.Description}</p></td>
          {game.hasCategories && <td>{card.Category}</td>}
          <td className="feedback-count">+{card.likes} / −{card.dislikes}<p className="muted">Mine: {card.myVote === 1 ? 'Like' : card.myVote === -1 ? 'Dislike' : 'None'}</p></td>
          <td><div className="button-row">{!removed && <button className="btn-secondary" onClick={() => { setEditor({ ...card }); setBulkEditor(null); setPending(null); }}>Edit</button>}<button className={removed ? 'btn-secondary' : 'btn-danger'} onClick={() => review(removed ? 'restore' : 'remove', [{ id: card.id, version: card.version }])}>{removed ? 'Restore' : 'Remove'}</button></div></td>
        </tr>)}
      </tbody></table></div>
      {!filtered.length && !locked && <p className="empty-state">No matching cards.</p>}
      <div className="button-row pagination"><button className="btn-secondary" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous page</button><span>{filtered.length} cards · Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 50))}</span><button className="btn-secondary" disabled={(page + 1) * 50 >= filtered.length} onClick={() => setPage(value => value + 1)}>Next page</button></div>
      {editor && <form className="editor" onSubmit={event => { event.preventDefault(); review(editor.id ? 'edit' : 'import', [editor]); }}>
        <h3>{editor.id ? 'Edit card' : 'New card'}</h3>
        <CardFields card={editor} game={game} onChange={card => { setEditor(card); setPending(null); }} />
        <p className="muted">{CARD_FORMATS.find(format => format.value === game.cardFormat)?.help || 'A name or description is required.'} {game.hasCategories && 'Typing a new category creates it.'}</p>
        <div className="button-row"><button className="btn-primary" disabled={cardErrors(editor, game).length > 0} type="submit">Review card</button><button className="btn-secondary" type="button" onClick={() => { setEditor(null); setPending(null); }}>Cancel</button></div>
      </form>}
      {bulkEditor && <BulkCardEditor cards={bulkEditor} game={game} onDraftChange={() => setPending(null)} onReview={rows => review('edit', rows)} onCancel={() => { setBulkEditor(null); setPending(null); }} />}
      {!removed && <div className="import-panel">
        <h3>Bulk import & edits</h3>
        <p className="muted">Upload a CSV with Name and/or Description{game.hasCategories ? ', and Category' : ''}. To edit existing cards, export them first and keep their id and version columns. Updates replace every content field; blank fields clear existing text.</p>
        <label>Import mode<select aria-label="Import mode" value={mode} onChange={event => { setMode(event.target.value); setPending(null); }}><option value="import">Add as new cards</option><option value="edit">Update existing cards by ID</option><option value="feedback">Update my feedback by ID</option></select></label>
        {mode === 'feedback' && <p className="muted">Keep exported id/version columns and set myVote to 1 (like), -1 (dislike), or 0 (clear). Only your feedback changes; aggregate counts are read-only.</p>}
        <label>CSV file<input type="file" accept=".csv,text/csv" onChange={readCsv} /></label>
        {preview && <div className="csv-preview"><strong>{preview.cards.length} rows to {mode === 'edit' ? 'update' : mode === 'feedback' ? 'rate' : 'add'}</strong>
          {preview.errors.length ? <ul className="error">{preview.errors.slice(0, 20).map((error, index) => <li key={index}>{error}</li>)}</ul> : <><p className="muted">{mode === 'import' ? 'These will be new cards, even if similar cards already exist.' : 'Only matching IDs in this game will be updated. Stale versions stop the whole update.'}</p><ol>{preview.cards.slice(0, 5).map((card, index) => <li key={index}>{card.Name || card.Description.slice(0, 100) || card.id}{card.Category && ` · ${card.Category}`}{mode === 'feedback' && ` · ${card.value === 1 ? 'Like' : card.value === -1 ? 'Dislike' : 'Clear my feedback'}`}</li>)}</ol><button className="btn-primary" onClick={() => review(mode, preview.cards)}>Review {preview.cards.length} {mode === 'edit' ? 'updates' : mode === 'feedback' ? 'feedback changes' : 'new cards'}</button></>}
          <button className="btn-secondary" onClick={() => { setCsvText(''); setPending(null); }}>Clear file</button>
        </div>}
      </div>}
      <datalist id="manager-categories">{categories.map(category => <option key={category} value={category} />)}</datalist>
    </fieldset>
    {pending && <div className="review-panel" role="region" aria-label="Review changes">
      <h3>Confirm {pending.rows.length} card{pending.rows.length === 1 ? '' : 's'} to {pending.action === 'import' ? 'add' : pending.action === 'edit' ? 'update' : pending.action}</h3>
      <p>{pending.action === 'remove' ? 'These cards will leave the playable deck. You can restore them from Removed cards.' : pending.action === 'restore' ? 'These cards will return to the playable deck with their feedback.' : pending.action === 'feedback' ? 'Only your own feedback changes. Other players’ votes stay as they are.' : 'Review the content below before saving.'}</p>
      <ul className="review-items">{pending.rows.map(row => { const original = source.find(card => card.id === row.id); return <li key={row.id || pending.rows.indexOf(row)}><strong>{row.Name ?? original?.Name ?? row.id ?? 'Description-only card'}</strong>{(row.Description || original?.Description) && <p>{row.Description ?? original.Description}</p>}{row.Category && <span className="category-badge">{row.Category}</span>}{pending.action === 'feedback' && <p>{(row.value ?? pending.value) === 1 ? 'Like' : (row.value ?? pending.value) === -1 ? 'Dislike' : 'Clear my feedback'}</p>}</li>; })}</ul>
      <div className="button-row"><button className={pending.action === 'remove' ? 'btn-danger' : 'btn-primary'} disabled={locked} onClick={commit}>{busy ? 'Saving…' : 'Confirm changes'}</button><button className="btn-secondary" disabled={busy} onClick={() => setPending(null)}>Cancel</button></div>
    </div>}
  </section>;
}
