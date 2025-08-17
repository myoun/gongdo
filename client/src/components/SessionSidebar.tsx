import React, { useState } from 'react';
import './SessionSidebar.css';

interface Session {
  id: string;
  name: string;
}

interface SessionSidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newName: string) => void;
}

const SessionSidebar: React.FC<SessionSidebarProps> = ({ sessions, activeSessionId, onNewChat, onSelectSession, onDeleteSession, onRenameSession }) => {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleRenameStart = (session: Session) => {
    setEditingSessionId(session.id);
    setRenameValue(session.name);
  };

  const handleRenameConfirm = () => {
    if (editingSessionId && renameValue.trim()) {
      onRenameSession(editingSessionId, renameValue.trim());
    }
    setEditingSessionId(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleRenameConfirm();
    } else if (event.key === 'Escape') {
      setEditingSessionId(null);
    }
  };

  return (
    <div className="session-sidebar">
      <button className="new-chat-btn" onClick={onNewChat}>
        + New Chat
      </button>
      <nav className="session-list">
        {sessions.map(session => (
          <div 
            key={session.id} 
            className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
          >
            {editingSessionId === session.id ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleRenameConfirm}
                onKeyDown={handleKeyDown}
                className="rename-input"
                autoFocus
              />
            ) : (
              <>
                <a className="session-link" onClick={() => onSelectSession(session.id)}>
                  {session.name}
                </a>
                <div className="session-actions">
                  <button onClick={() => handleRenameStart(session)} className="action-btn">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                    </svg>
                  </button>
                  <button onClick={() => onDeleteSession(session.id)} className="action-btn">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </nav>
    </div>
  );
};

export default SessionSidebar;