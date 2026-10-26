import { useEffect, useState } from 'react';
import { DataManager } from '../utils/DataManager';
import Dialog from './Dialog';

export default function CategoryManager({ game, onChanged }) {
  const [data, setData] = useState(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pending, setPending] = useState(null);
  useEffect(() => {
    let active = true;
    DataManager.fetchCategories(game.id)
      .then((data) => {
        if (active) {
          setData(data);
          setError('');
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [game.id, revision]);
  const source = data?.categories.find((category) => category.name === from);
  const merge = data?.categories.some(
    (category) => category.name === to.trim(),
  );
  function refresh() {
    setLoading(true);
    setPending(null);
    setRevision((value) => value + 1);
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const result = await DataManager.renameCategory(game.id, pending);
      setMessage(
        `${result.changed} cards moved from “${pending.from}” to “${pending.to}”.`,
      );
      setFrom('');
      setTo('');
      setPending(null);
      refresh();
      onChanged();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="editor">
      <div className="manager-heading">
        <div>
          <p className="muted">
            Rename a category, or merge it into an existing one. Active and
            removed cards are included.
          </p>
        </div>
        <button className="btn-secondary" disabled={busy} onClick={refresh}>
          Refresh categories
        </button>
      </div>
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
      {loading && <p role="status">Loading categories…</p>}
      <fieldset disabled={loading || busy}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Active cards</th>
                <th>Removed cards</th>
              </tr>
            </thead>
            <tbody>
              {data?.categories.map((category) => (
                <tr key={category.name}>
                  <td>{category.name}</td>
                  <td>{category.active}</td>
                  <td>{category.removed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label>
          Source category
          <select
            aria-label="Source category"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPending(null);
            }}
          >
            <option value="">Choose a category…</option>
            {data?.categories.map((category) => (
              <option key={category.name} value={category.name}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          New or existing category
          <input
            maxLength={200}
            value={to}
            list="category-targets"
            onChange={(event) => {
              setTo(event.target.value);
              setPending(null);
            }}
          />
        </label>
        <datalist id="category-targets">
          {data?.categories.map((category) => (
            <option key={category.name} value={category.name} />
          ))}
        </datalist>
        <button
          className="btn-primary"
          disabled={!source || !to.trim() || from === to.trim()}
          onClick={() => {
            setMessage('');
            setPending({
              from,
              to: to.trim(),
              expectedCount: source.total,
              gameVersion: data.gameVersion,
              revision: data.revision,
              active: source.active,
              removed: source.removed,
            });
          }}
        >
          Review {merge ? 'category merge' : 'category rename'}
        </button>
      </fieldset>
      {pending && (
        <Dialog
          title={`Move “${pending.from}” to “${pending.to}”`}
          onClose={() => !busy && setPending(null)}
        >
        <div className="review-panel" aria-label="Review category changes">
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <p>
            {pending.active} active cards and {pending.removed} removed cards
            will change category. Their content and feedback stay as they are.
            Previously exported card versions will become stale.
          </p>
          <div className="button-row">
            <button
              className="btn-primary"
              disabled={busy || loading}
              onClick={save}
            >
              {busy ? 'Saving…' : 'Confirm category changes'}
            </button>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel category change
            </button>
          </div>
        </div>
        </Dialog>
      )}
    </div>
  );
}
