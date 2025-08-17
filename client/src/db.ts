import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { Source } from './components/ResultDisplay';

// --- Data Structures ---
// Re-define interfaces to be used in this module
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  image?: string | ArrayBuffer | null; // Can be base64 string or ArrayBuffer
}

export interface Session {
  id: string;
  name: string;
  history: ChatMessage[];
  createdAt: Date;
}

// --- IndexedDB Schema ---
interface ChatDBSchema extends DBSchema {
  sessions: {
    key: string;
    value: Session;
    indexes: { 'createdAt': Date };
  };
  activeSession: {
    key: 'active-session-id';
    value: string | null;
  };
}

const DB_NAME = 'ChatDB';
const DB_VERSION = 1;

// --- Database Initialization ---
let dbPromise: Promise<IDBPDatabase<ChatDBSchema>> | null = null;

const getDb = (): Promise<IDBPDatabase<ChatDBSchema>> => {
  if (!dbPromise) {
    dbPromise = openDB<ChatDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionStore.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('activeSession')) {
          db.createObjectStore('activeSession');
        }
      },
    });
  }
  return dbPromise;
};

// --- CRUD Operations for Sessions ---

export const saveSession = async (session: Session): Promise<void> => {
  const db = await getDb();
  await db.put('sessions', session);
};

export const getAllSessions = async (): Promise<Session[]> => {
  const db = await getDb();
  const sessions = await db.getAllFromIndex('sessions', 'createdAt');
  return sessions.reverse(); // Show newest first
};

export const deleteSession = async (sessionId: string): Promise<void> => {
  const db = await getDb();
  await db.delete('sessions', sessionId);
};

export const saveActiveSessionId = async (sessionId: string | null): Promise<void> => {
  const db = await getDb();
  await db.put('activeSession', sessionId, 'active-session-id');
};

export const getActiveSessionId = async (): Promise<string | null> => {
  const db = await getDb();
  return db.get('activeSession', 'active-session-id');
};

// --- Combined Load Function ---
export const loadDataFromDB = async (): Promise<{ sessions: Session[], activeSessionId: string | null }> => {
  const [sessions, activeSessionId] = await Promise.all([
    getAllSessions(),
    getActiveSessionId()
  ]);
  return { sessions, activeSessionId };
};
