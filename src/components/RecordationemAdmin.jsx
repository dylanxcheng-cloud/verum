/**
 * src/components/RecordationemAdmin.jsx
 * Recordationem editorial controls.
 *
 * Editors can: approve discovered stories, adjust importance scores, merge
 * duplicate topics, override AI summaries, add contextual notes, and archive
 * completed stories.
 *
 * Architecture note: Verum is a static front-end fed by a scheduled Python
 * pipeline (the same model as stories.json). This panel therefore edits the
 * `recordationem_editorial.json` overrides document in the browser and exports
 * it for commit — the discovery engine layers it on top of every run, so
 * editorial decisions persist without touching code. (If a write API is later
 * added at VITE_API_BASE_URL, `saveToApi` below will POST instead.)
 */
import React, { useState, useEffect } from 'react';
import { loadRecordationem, formatDecline } from '../utils/recordationem';

const EDITORIAL_URL = '/recordationem_editorial.json';

function blankOverride() {
  return { approved: true, archived: false, importanceScore: undefined, title: '', category: '', notes: [], summaries: {} };
}

export default function RecordationemAdmin() {
  const [data, setData] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [merges, setMerges] = useState({});
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    Promise.allSettled([loadRecordationem(), fetch(EDITORIAL_URL).then((r) => (r.ok ? r.json() : null))])
      .then(([rec, ed]) => {
        if (rec.status === 'fulfilled') setData(rec.value);
        if (ed.status === 'fulfilled' && ed.value) {
          setOverrides(ed.value.overrides || {});
          setMerges(ed.value.merges || {});
        }
        setLoading(false);
      });
  }, []);

  const ovFor = (id) => overrides[id] || blankOverride();
  const setOv = (id, patch) =>
    setOverrides((prev) => ({ ...prev, [id]: { ...blankOverride(), ...prev[id], ...patch } }));

  const editorialDoc = () => ({
    merges,
    overrides: Object.fromEntries(
      Object.entries(overrides).filter(([, ov]) => {
        // Only keep overrides that actually change something.
        return (
          ov.archived ||
          ov.approved === false ||
          ov.importanceScore != null ||
          (ov.title && ov.title.trim()) ||
          (ov.category && ov.category.trim()) ||
          (ov.notes && ov.notes.length) ||
          (ov.summaries && Object.keys(ov.summaries).length)
        );
      })
    ),
  });

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(editorialDoc(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recordationem_editorial.json';
    a.click();
    URL.revokeObjectURL(url);
    setSaved('Exported recordationem_editorial.json — commit it to apply on the next run.');
  };

  const saveToApi = async () => {
    const base = (import.meta.env && import.meta.env.VITE_API_BASE_URL) || '';
    if (!base) {
      exportJson();
      return;
    }
    try {
      const res = await fetch(`${base}/api/recordationem/editorial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editorialDoc()),
      });
      setSaved(res.ok ? 'Saved to API.' : `API error: HTTP ${res.status}`);
    } catch (e) {
      setSaved(`API unavailable — exported file instead. (${e.message})`);
      exportJson();
    }
  };

  if (loading) return <div className="loading"><div className="loading-spinner" />Loading topics…</div>;
  if (!data) return <div className="error-state"><div className="error-title">No discovery data available.</div></div>;

  return (
    <div className="rec-admin">
      <div className="rec-admin-bar">
        <div>
          <strong>{data.stories.length}</strong> discovered topics ·{' '}
          <strong>{Object.keys(overrides).length}</strong> edited
        </div>
        <div className="rec-admin-actions">
          <button className="rec-admin-btn" onClick={exportJson}>Export overrides</button>
          <button className="rec-admin-btn rec-admin-btn--primary" onClick={saveToApi}>Save</button>
        </div>
      </div>
      {saved && <div className="rec-admin-saved">{saved}</div>}

      {data.stories.map((t) => {
        const ov = ovFor(t.id);
        return (
          <div className={`rec-admin-card ${ov.archived ? 'is-archived' : ''} ${ov.approved === false ? 'is-rejected' : ''}`} key={t.id}>
            <div className="rec-admin-head">
              <div>
                <div className="rec-admin-title">{ov.title || t.title}</div>
                <div className="rec-admin-sub">
                  {ov.category || t.category} · score {ov.importanceScore ?? t.recordationemScore} ·
                  coverage {formatDecline(t.coverageDeclinePct)} · {t.articleCount} sources
                </div>
              </div>
              <div className="rec-admin-toggles">
                <label className="rec-admin-check">
                  <input type="checkbox" checked={ov.approved !== false}
                         onChange={(e) => setOv(t.id, { approved: e.target.checked })} />
                  Approved
                </label>
                <label className="rec-admin-check">
                  <input type="checkbox" checked={!!ov.archived}
                         onChange={(e) => setOv(t.id, { archived: e.target.checked })} />
                  Archived
                </label>
              </div>
            </div>

            <div className="rec-admin-grid">
              <label>Importance score override
                <input type="number" placeholder={String(t.recordationemScore)}
                       value={ov.importanceScore ?? ''}
                       onChange={(e) => setOv(t.id, { importanceScore: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </label>
              <label>Title override
                <input type="text" placeholder={t.title} value={ov.title || ''}
                       onChange={(e) => setOv(t.id, { title: e.target.value })} />
              </label>
              <label>Category override
                <input type="text" placeholder={t.category} value={ov.category || ''}
                       onChange={(e) => setOv(t.id, { category: e.target.value })} />
              </label>
              <label>Merge into topic id
                <input type="text" placeholder="parent topic id"
                       value={merges[t.id] || ''}
                       onChange={(e) => {
                         const v = e.target.value.trim();
                         setMerges((prev) => {
                           const next = { ...prev };
                           if (v) next[t.id] = v; else delete next[t.id];
                           return next;
                         });
                       }} />
              </label>
            </div>

            <label className="rec-admin-full">Override “Why This Is Still Important”
              <textarea rows={2} placeholder={t.whyStillImportant}
                        value={(ov.summaries && ov.summaries.whyStillImportant) || ''}
                        onChange={(e) => setOv(t.id, { summaries: { ...ov.summaries, whyStillImportant: e.target.value } })} />
            </label>

            <label className="rec-admin-full">Contextual note
              <textarea rows={2} placeholder="Add an editor note shown on the story page…"
                        value={(ov.notes && ov.notes[0]) || ''}
                        onChange={(e) => setOv(t.id, { notes: e.target.value ? [e.target.value] : [] })} />
            </label>
          </div>
        );
      })}
    </div>
  );
}
