import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  NoteSchema,
  TaskSchema,
  type CreateNoteRequest,
  type CreateTaskRequest,
  type Note,
  type Task,
  type UpdateNoteRequest,
  type UpdateTaskRequest,
} from "@personacode/contracts";

function validId(id: string): boolean {
  return /^[\w-]+$/.test(id);
}

function readArray<T>(path: string, parse: (value: unknown) => T): T[] {
  if (!existsSync(path)) return [];
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(value)) throw new Error(`invalid data file: ${path}`);
  return value.map(parse);
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  renameSync(temporary, path);
}

export class NotesTasksStore {
  private readonly notesPath: string;
  private readonly tasksPath: string;

  constructor(root = process.cwd()) {
    const dataDir = join(root, ".personacode", "data");
    mkdirSync(dataDir, { recursive: true });
    this.notesPath = join(dataDir, "notes.json");
    this.tasksPath = join(dataDir, "tasks.json");
  }

  listNotes(): Note[] {
    return readArray(this.notesPath, (value) => NoteSchema.parse(value)).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  createNote(input: CreateNoteRequest): Note {
    const now = Date.now();
    const note = NoteSchema.parse({ id: randomUUID(), ...input, createdAt: now, updatedAt: now });
    const notes = this.listNotes();
    notes.push(note);
    writeAtomic(this.notesPath, notes);
    return note;
  }

  updateNote(id: string, input: UpdateNoteRequest): Note | undefined {
    if (!validId(id)) return undefined;
    const notes = this.listNotes();
    const index = notes.findIndex((note) => note.id === id);
    if (index < 0) return undefined;
    const note = NoteSchema.parse({ ...notes[index], ...input, id, updatedAt: Date.now() });
    notes[index] = note;
    writeAtomic(this.notesPath, notes);
    return note;
  }

  deleteNote(id: string): boolean {
    if (!validId(id)) return false;
    const notes = this.listNotes();
    const next = notes.filter((note) => note.id !== id);
    if (next.length === notes.length) return false;
    writeAtomic(this.notesPath, next);
    return true;
  }

  listTasks(): Task[] {
    return readArray(this.tasksPath, (value) => TaskSchema.parse(value)).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }

  createTask(input: CreateTaskRequest): Task {
    const task = TaskSchema.parse({ id: randomUUID(), ...input, done: false, createdAt: Date.now() });
    const tasks = this.listTasks();
    tasks.push(task);
    writeAtomic(this.tasksPath, tasks);
    return task;
  }

  updateTask(id: string, input: UpdateTaskRequest): Task | undefined {
    if (!validId(id)) return undefined;
    const tasks = this.listTasks();
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return undefined;
    const task = TaskSchema.parse({
      ...tasks[index],
      ...input,
      id,
      schedule: input.schedule === null ? undefined : input.schedule ?? tasks[index]?.schedule,
      agent: input.agent === null ? undefined : input.agent ?? tasks[index]?.agent,
    });
    tasks[index] = task;
    writeAtomic(this.tasksPath, tasks);
    return task;
  }

  deleteTask(id: string): boolean {
    if (!validId(id)) return false;
    const tasks = this.listTasks();
    const next = tasks.filter((task) => task.id !== id);
    if (next.length === tasks.length) return false;
    writeAtomic(this.tasksPath, next);
    return true;
  }
}

export class ChannelSessionStore {
  private readonly path: string;

  constructor(root = process.cwd()) {
    this.path = join(root, ".personacode", "data", "channel-sessions.json");
  }

  get(key: string): string | undefined {
    return this.read()[key];
  }

  set(key: string, sessionId: string): void {
    const mappings = this.read();
    mappings[key] = sessionId;
    writeAtomic(this.path, mappings);
  }

  private read(): Record<string, string> {
    if (!existsSync(this.path)) return {};
    const value = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && validId(entry[1]),
      ),
    );
  }
}
