import { useState, useEffect, useRef } from 'react';
import './App.css';
import SearchForm from './components/SearchForm';
import ResultDisplay from './components/ResultDisplay';
import type { Source } from './components/ResultDisplay';
import SourceSidebar from './components/SourceSidebar';
import SessionSidebar from './components/SessionSidebar'; // Import session sidebar
import ConfirmModal from './components/ConfirmModal';

// --- Data Structures ---
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}

interface Session {
  id: string;
  name: string;
  history: ChatMessage[];
}

// --- localStorage Utilities ---
const saveSessionsToLocalStorage = (sessions: Session[], activeId: string | null) => {
  localStorage.setItem('chatSessions', JSON.stringify({ sessions, activeSessionId: activeId }));
};

const loadSessionsFromLocalStorage = (): { sessions: Session[], activeSessionId: string | null } => {
  const saved = localStorage.getItem('chatSessions');
  if (saved) {
    return JSON.parse(saved);
  }
  return { sessions: [], activeSessionId: null };
};


function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  // --- Effects ---
  useEffect(() => {
    const { sessions: loadedSessions, activeSessionId: loadedActiveId } = loadSessionsFromLocalStorage();
    if (loadedSessions.length > 0) {
      setSessions(loadedSessions);
      setActiveSessionId(loadedActiveId);
    } else {
      handleNewChat(); // Create a default chat if none exist
    }
  }, []);

  useEffect(() => {
    saveSessionsToLocalStorage(sessions, activeSessionId);
  }, [sessions, activeSessionId]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [sessions, streamingMessage, status]);

  // --- Handlers ---
  const handleNewChat = () => {
    // Find the highest existing "New Chat" number to avoid duplicates
    const newChatNumbers = sessions
      .map(s => {
        const match = s.name.match(/^New Chat (\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(num => num > 0);
    const nextChatNumber = newChatNumbers.length > 0 ? Math.max(...newChatNumbers) + 1 : 1;

    const newSession: Session = {
      id: `session-${Date.now()}`,
      name: `New Chat ${nextChatNumber}`,
      history: [],
    };
    
    // Prepend the new session to the beginning of the array
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setStreamingMessage(null);
    setError('');
    setStatus('');
  };

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setStreamingMessage(null);
    setError('');
    setStatus('');
  };

  const handleDeleteSession = (sessionIdToDelete: string) => {
    setSessionToDelete(sessionIdToDelete);
    setIsModalOpen(true);
  };

  const confirmDelete = () => {
    if (!sessionToDelete) return;

    setSessions(prev => {
      const newSessions = prev.filter(s => s.id !== sessionToDelete);
      if (activeSessionId === sessionToDelete) {
        if (newSessions.length > 0) {
          setActiveSessionId(newSessions[0].id); // Switch to the new first session
        } else {
          handleNewChat(); // Create a new one if all are deleted
        }
      }
      return newSessions;
    });

    setIsModalOpen(false);
    setSessionToDelete(null);
  };

  const handleRenameSession = (sessionIdToRename: string, newName: string) => {
    setSessions(prev => 
      prev.map(s => 
        s.id === sessionIdToRename ? { ...s, name: newName } : s
      )
    );
  };

  const handleSourceClick = (source: Source) => setSelectedSource(source);
  const handleCloseSidebar = () => setSelectedSource(null);

  const handleSearch = async (query: string) => {
    if (loading || !activeSessionId) return;

    setLoading(true);
    setError('');
    setStatus('');
    setSelectedSource(null);

    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: query };
    
    // Update history for the active session
    const activeSession = sessions.find(s => s.id === activeSessionId);
    const historyForAPI = activeSession ? activeSession.history : [];
    
    setSessions(prev => prev.map(s => 
      s.id === activeSessionId ? { ...s, history: [...s.history, userMessage] } : s
    ));
    
    setStreamingMessage({ id: `assistant-${Date.now()}`, role: 'assistant', content: '', sources: [] });

    try {
      const response = await fetch('http://localhost:8000/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        body: JSON.stringify({ query, chat_history: historyForAPI.map(({id, ...rest}) => rest) }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      if (!response.body) throw new Error('Response body is null');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processStream = async () => {
        const { done, value } = await reader.read();
        if (done) {
          setLoading(false);
          setStatus('');
          setStreamingMessage(currentStreamingMsg => {
            if (currentStreamingMsg) {
              setSessions(prev => prev.map(s => 
                s.id === activeSessionId ? { ...s, history: [...s.history, currentStreamingMsg] } : s
              ));
            }
            return null;
          });
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        lines.forEach(line => {
          if (line.trim() === '') return;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'status') {
              setStatus(parsed.data);
              setLoading(false);
            } else if (parsed.type === 'error') {
              setError(parsed.data);
            } else {
              setStreamingMessage(prev => {
                if (!prev) return null;
                const updatedMsg = { ...prev };
                if (parsed.type === 'sources') updatedMsg.sources = parsed.data;
                if (parsed.type === 'token') {
                  if (status) setStatus('');
                  updatedMsg.content += parsed.data;
                }
                if (parsed.type === 'correction') {
                  const { invalid_indices } = parsed.data;
                  let correctedContent = updatedMsg.content;
                  invalid_indices.forEach((index: number) => {
                    const regex = new RegExp(`\\[\\s*${index}\\s*\\]`, 'g');
                    correctedContent = correctedContent.replace(regex, '');
                  });
                  updatedMsg.content = correctedContent;
                }
                return updatedMsg;
              });
            }
          } catch (e) {
            console.error('Failed to parse stream line:', line, e);
          }
        });
        await processStream();
      };
      await processStream();
    } catch (e: unknown) {
      setLoading(false);
      setStreamingMessage(null);
      if (e instanceof Error) setError(`검색에 실패했습니다: ${e.message}`);
      else setError('알 수 없는 오류가 발생했습니다.');
    }
  };

  const activeChatHistory = sessions.find(s => s.id === activeSessionId)?.history || [];

  return (
    <div className="App">
      <SessionSidebar 
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
      />
      <div className="main-content">
        <div className="chat-container" ref={chatContainerRef}>
          {activeChatHistory.length === 0 && !streamingMessage && (
            <div className="initial-view"><h1>Gongdo</h1></div>
          )}

          {activeChatHistory.map((msg) => (
            <div key={msg.id} className={`chat-message-wrapper ${msg.role}`}>
              <div className="chat-message">
                {msg.role === 'user' ? <p>{msg.content}</p> : (
                  <ResultDisplay 
                    answer={msg.content} 
                    sources={msg.sources || []} 
                    onSourceClick={handleSourceClick} 
                  />
                )}
              </div>
              {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                <ResultDisplay answer="" sources={msg.sources} onSourceClick={handleSourceClick} />
              )}
            </div>
          ))}

          {streamingMessage && (
            <div key={streamingMessage.id} className="chat-message-wrapper assistant">
              {status && <p className="status-message">{status}</p>}
              <div className="chat-message">
                <ResultDisplay answer={streamingMessage.content} sources={[]} onSourceClick={handleSourceClick} />
              </div>
              {streamingMessage.sources && streamingMessage.sources.length > 0 && (
                <ResultDisplay answer="" sources={streamingMessage.sources} onSourceClick={handleSourceClick} />
              )}
            </div>
          )}
          
          {error && <p style={{ color: 'red' }}>{error}</p>}
        </div>
        
        <div className="search-form-container">
          <div className="search-form-inner">
            <SearchForm onSearch={handleSearch} loading={loading} />
          </div>
        </div>
      </div>

      {selectedSource && <SourceSidebar source={selectedSource} onClose={handleCloseSidebar} />}
      
      <ConfirmModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={confirmDelete}
        title="대화 삭제"
        message="정말로 이 대화를 삭제하시겠습니까?"
      />
    </div>
  );
}

export default App;