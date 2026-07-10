import { useEffect, useState } from "react";
import type { Task } from "@personacode/contracts";

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data) => setTasks(Array.isArray(data) ? data : []))
      .catch(() => setError("Could not load tasks. Endpoint may not be available yet."))
      .finally(() => setLoading(false));
  }, []);

  async function createTask() {
    if (!title.trim()) return;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      const task = await res.json();
      if (task.id) {
        setTasks((t) => [task, ...t]);
        setTitle("");
        setShowForm(false);
      }
    } catch {
      setError("Failed to create task.");
    }
  }

  async function toggleDone(task: Task) {
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ done: !task.done }),
      });
      const updated = await res.json();
      if (updated.id) {
        setTasks((ts) => ts.map((t) => (t.id === updated.id ? updated : t)));
      } else {
        // If PATCH isn't implemented, toggle locally
        setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)));
      }
    } catch {
      // Fallback: toggle locally
      setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)));
    }
  }

  async function deleteTask(id: string) {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" }).catch(() => {});
    setTasks((t) => t.filter((x) => x.id !== id));
  }

  const pending = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  return (
    <div className="tasks-page">
      <div className="tasks-header">
        <h2>☑ Tasks</h2>
        <button className="tasks-add" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New Task"}
        </button>
      </div>

      {error && <div className="tasks-error">⚠ {error}</div>}

      {showForm && (
        <div className="tasks-form">
          <input
            className="tasks-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title…"
            onKeyDown={(e) => { if (e.key === "Enter") createTask(); }}
          />
          <button className="tasks-submit" onClick={createTask} disabled={!title.trim()}>
            Add Task
          </button>
        </div>
      )}

      {loading ? (
        <p className="tasks-empty">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="tasks-empty">No tasks yet — create one above!</p>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="tasks-section">
              <div className="tasks-label">To Do ({pending.length})</div>
              {pending.map((t) => (
                <div key={t.id} className="task-item">
                  <button className="task-check" onClick={() => toggleDone(t)}>☐</button>
                  <div className="task-info">
                    <span className="task-title">{t.title}</span>
                    {t.schedule && <span className="task-badge cron">⏱ {t.schedule}</span>}
                    {t.agent && <span className="task-badge agent">🤖 {t.agent}</span>}
                  </div>
                  <button className="task-delete" onClick={() => deleteTask(t.id)} title="Delete">✕</button>
                </div>
              ))}
            </div>
          )}
          {done.length > 0 && (
            <div className="tasks-section">
              <div className="tasks-label">Done ({done.length})</div>
              {done.map((t) => (
                <div key={t.id} className="task-item done">
                  <button className="task-check done" onClick={() => toggleDone(t)}>☑</button>
                  <div className="task-info">
                    <span className="task-title">{t.title}</span>
                  </div>
                  <button className="task-delete" onClick={() => deleteTask(t.id)} title="Delete">✕</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
