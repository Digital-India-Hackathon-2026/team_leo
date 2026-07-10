import { useEffect, useState } from "react";
import type { Note } from "@personacode/contracts";
import { timeAgo } from "../utils/timeAgo";

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/notes")
      .then((r) => r.json())
      .then((data) => setNotes(Array.isArray(data) ? data : []))
      .catch(() => setError("Could not load notes. Endpoint may not be available yet."))
      .finally(() => setLoading(false));
  }, []);

  async function createNote() {
    if (!title.trim()) return;
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      const note = await res.json();
      if (note.id) {
        setNotes((n) => [note, ...n]);
        setTitle("");
        setBody("");
        setTags("");
        setShowForm(false);
      }
    } catch {
      setError("Failed to create note.");
    }
  }

  async function deleteNote(id: string) {
    await fetch(`/api/notes/${id}`, { method: "DELETE" }).catch(() => {});
    setNotes((n) => n.filter((x) => x.id !== id));
  }

  const filtered = filter
    ? notes.filter(
        (n) =>
          n.title.toLowerCase().includes(filter.toLowerCase()) ||
          n.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase()))
      )
    : notes;

  return (
    <div className="notes-page">
      <div className="notes-header">
        <h2>📝 Notes</h2>
        <button className="notes-add" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New Note"}
        </button>
      </div>

      {error && <div className="notes-error">⚠ {error}</div>}

      {showForm && (
        <div className="notes-form">
          <input
            className="notes-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title…"
          />
          <textarea
            className="notes-textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Note body (markdown supported)…"
            rows={4}
          />
          <input
            className="notes-input small"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Tags (comma-separated)…"
          />
          <button className="notes-submit" onClick={createNote} disabled={!title.trim()}>
            Save Note
          </button>
        </div>
      )}

      {notes.length > 0 && (
        <input
          className="notes-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="🔍 Filter by title or tag…"
        />
      )}

      {loading ? (
        <p className="notes-empty">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="notes-empty-state">
          <p className="notes-empty">
            {notes.length === 0 ? "No notes yet — create one above!" : "No notes match your filter."}
          </p>
        </div>
      ) : (
        <div className="notes-list">
          {filtered.map((n) => (
            <div key={n.id} className="note-card">
              <div className="note-top">
                <span className="note-title">{n.title}</span>
                <button className="note-delete" onClick={() => deleteNote(n.id)} title="Delete note">✕</button>
              </div>
              {n.body && <p className="note-body">{n.body.slice(0, 180)}{n.body.length > 180 ? "…" : ""}</p>}
              <div className="note-meta">
                {n.tags.length > 0 && (
                  <div className="note-tags">
                    {n.tags.map((t) => (
                      <span key={t} className="note-tag">{t}</span>
                    ))}
                  </div>
                )}
                <span className="note-time">{timeAgo(n.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
