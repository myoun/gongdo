import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import SearchForm from './components/SearchForm';
import ResultDisplay from './components/ResultDisplay';
import type { Source } from './components/ResultDisplay';
import SourceSidebar from './components/SourceSidebar';
import SessionSidebar from './components/SessionSidebar';
import ConfirmModal from './components/ConfirmModal';
import { 
  loadDataFromDB, 
  saveSession, 
  deleteSession as dbDeleteSession, 
  saveActiveSessionId
} from './db';
import SplashScreen from './components/SplashScreen';
import type { ChatMessage, Session } from './db';

// Helper function moved outside the component to prevent re-creation on every render
const createNewChatSession = (currentSessions: Session[]): Session => {
  const newChatNumbers = currentSessions
    .map(s => {
      const match = s.name.match(/^(?:New Chat|새로운 채팅) (\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter(num => num > 0);
  const nextChatNumber = newChatNumbers.length > 0 ? Math.max(...newChatNumbers) + 1 : 1;

  return {
    id: `session-${Date.now()}`,
    name: `새로운 채팅 ${nextChatNumber}`,
    history: [],
    createdAt: new Date(),
  };
};

// Helper function to convert Data URL to File object
const dataURLtoFile = (dataurl: string, filename: string): File | undefined => {
  const arr = dataurl.split(',');
  if (arr.length < 2) {
    return undefined;
  }
  const mimeMatch = arr[0].match(/:(.*?);/);
  if (!mimeMatch) {
    return undefined;
  }
  const mime = mimeMatch[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(window.innerWidth < 768);
  const [isInitializing, setIsInitializing] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState('');

  const toggleSidebar = () => setIsSidebarCollapsed(prev => !prev);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setIsSidebarCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleNewChat = useCallback(async () => {
    const newSession = createNewChatSession(sessions);
    await saveSession(newSession);
    await saveActiveSessionId(newSession.id);
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setStreamingMessage(null);
    setError('');
    setStatus('');
  }, [sessions]);

  // --- Effects ---
  useEffect(() => {
    const init = async () => {
      try {
        setError('');
        setIsInitializing(true);
        const { sessions: loadedSessions, activeSessionId: loadedActiveId } = await loadDataFromDB();
        
        if (loadedSessions.length > 0) {
          setSessions(loadedSessions);
          setActiveSessionId(loadedActiveId ?? loadedSessions[0]?.id ?? null);
        } else {
          // Directly create the first session without relying on component state
          const newSession = createNewChatSession([]);
          await saveSession(newSession);
          await saveActiveSessionId(newSession.id);
          setSessions([newSession]);
          setActiveSessionId(newSession.id);
        }
      } catch (e) {
        console.error("Failed to initialize the application:", e);
        setError("앱을 초기화하는 데 실패했습니다. IndexedDB를 사용할 수 없는 환경일 수 있습니다.");
      } finally {
        setIsInitializing(false);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [sessions, streamingMessage, status]);

  // --- Handlers ---
  const handleSelectSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    await saveActiveSessionId(sessionId);
    setStreamingMessage(null);
    setError('');
    setStatus('');
  };

  const handleDeleteSession = (sessionIdToDelete: string) => {
    setSessionToDelete(sessionIdToDelete);
    setIsModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!sessionToDelete) return;

    await dbDeleteSession(sessionToDelete);
    
    let finalSessions = sessions.filter(s => s.id !== sessionToDelete);

    if (activeSessionId === sessionToDelete) {
      if (finalSessions.length > 0) {
        await handleSelectSession(finalSessions[0].id);
      } else {
        const newSession = createNewChatSession([]);
        await saveSession(newSession);
        await saveActiveSessionId(newSession.id);
        finalSessions = [newSession];
        setActiveSessionId(newSession.id);
      }
    }
    
    setSessions(finalSessions);
    setIsModalOpen(false);
    setSessionToDelete(null);
  };

  const handleRenameSession = async (sessionIdToRename: string, newName: string) => {
    const sessionToUpdate = sessions.find(s => s.id === sessionIdToRename);
    if (sessionToUpdate) {
      const updatedSession = { ...sessionToUpdate, name: newName };
      await saveSession(updatedSession);
      setSessions(prev => prev.map(s => s.id === sessionIdToRename ? updatedSession : s));
    }
  };

  const handleSourceClick = (source: Source) => setSelectedSource(source);
  const handleCloseSidebar = () => setSelectedSource(null);

  const handleDeleteMessage = async (messageId: string) => {
    if (!activeSessionId) return;

    const activeSession = sessions.find(s => s.id === activeSessionId);
    if (!activeSession) return;

    const messageIndex = activeSession.history.findIndex(m => m.id === messageId);

    if (messageIndex === -1 || activeSession.history[messageIndex].role !== 'user') {
        return;
    }

    const newHistory = [...activeSession.history];
    const nextMessage = newHistory[messageIndex + 1];

    if (nextMessage && nextMessage.role === 'assistant') {
        newHistory.splice(messageIndex, 2);
    } else {
        newHistory.splice(messageIndex, 1);
    }

    const updatedSession = { ...activeSession, history: newHistory };
    await saveSession(updatedSession);
    setSessions(prev => prev.map(s => s.id === activeSessionId ? updatedSession : s));
  };

  const executeSearchAndStream = async (sessionForSearch: Session, imageFile?: File) => {
    setStreamingMessage({ id: `assistant-${Date.now()}`, role: 'assistant', content: '', sources: [] });

    try {
      const query = sessionForSearch.history[sessionForSearch.history.length - 1].content;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const historyForAPI = sessionForSearch.history.slice(0, -1).map(({id, image, ...rest}) => rest);

      const formData = new FormData();
      formData.append('query', query);
      formData.append('chat_history', JSON.stringify(historyForAPI));
      if (imageFile) {
        formData.append('image', imageFile);
      }

      const response = await fetch('http://localhost:8000/api/search', {
        method: 'POST',
        body: formData,
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
          setStreamingMessage((currentStreamingMsg) => {
            if (currentStreamingMsg) {
              setSessions(prevSessions => {
                const finalSession = prevSessions.find(s => s.id === activeSessionId);
                if (finalSession) {
                  const finalHistory = [...finalSession.history, currentStreamingMsg];
                  const finalUpdatedSession = { ...finalSession, history: finalHistory };
                  saveSession(finalUpdatedSession);
                  return prevSessions.map(s => s.id === activeSessionId ? finalUpdatedSession : s);
                }
                return prevSessions;
              });
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
      else setError('알 수 없는 오류가 발��했습니다.');
    }
  };

  const handleRegenerate = async () => {
    if (loading || !activeSessionId) return;
    const activeSession = sessions.find(s => s.id === activeSessionId);
    if (!activeSession || activeSession.history.length === 0) return;

    const lastUserMessageIndex = activeSession.history.findLastIndex(m => m.role === 'user');
    if (lastUserMessageIndex === -1) return;
        
    // Keep history up to the last user message, removing the assistant's response
    const historyForResubmit = activeSession.history.slice(0, lastUserMessageIndex + 1);
    const lastUserMessage = historyForResubmit[historyForResubmit.length - 1];

    const updatedSession = { ...activeSession, history: historyForResubmit };
    await saveSession(updatedSession);
    setSessions(prev => prev.map(s => s.id === activeSessionId ? updatedSession : s));

    const imageFile = lastUserMessage.image && typeof lastUserMessage.image === 'string' 
      ? dataURLtoFile(lastUserMessage.image, 'image.png') 
      : undefined;

    await executeSearchAndStream(updatedSession, imageFile);
  };

  const handleEditStart = (message: ChatMessage) => {
    setEditingMessageId(message.id);
    setEditedContent(message.content);
  };

  const handleEditCancel = () => {
    setEditingMessageId(null);
    setEditedContent('');
  };

  const handleEditSave = async () => {
    if (loading || !editingMessageId || !activeSessionId) return;

    const activeSession = sessions.find(s => s.id === activeSessionId);
    if (!activeSession) return;

    const messageIndex = activeSession.history.findIndex(m => m.id === editingMessageId);
    if (messageIndex === -1) return;

    const originalMessage = activeSession.history[messageIndex];

    if (originalMessage.content.trim() === editedContent.trim()) {
      handleEditCancel();
      return;
    }
    
    const historyForResubmit = activeSession.history.slice(0, messageIndex);
    const updatedMessage = { ...originalMessage, content: editedContent };
    historyForResubmit.push(updatedMessage);

    const updatedSession = { ...activeSession, history: historyForResubmit };
    await saveSession(updatedSession);
    setSessions(prev => prev.map(s => s.id === activeSessionId ? updatedSession : s));

    handleEditCancel();
    
    const imageFile = originalMessage.image && typeof originalMessage.image === 'string'
      ? dataURLtoFile(originalMessage.image, 'image.png')
      : undefined;

    await executeSearchAndStream(updatedSession, imageFile);
  };

  const handleSearch = async (query: string, imageFile?: File) => {
    if (loading || !activeSessionId) return;

    setLoading(true);
    setError('');
    setStatus('');
    setSelectedSource(null);

    let imageDataUrl: string | ArrayBuffer | null = null;
    if (imageFile) {
      imageDataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(imageFile);
      });
    }

    const userMessage: ChatMessage = { 
      id: `user-${Date.now()}`, 
      role: 'user', 
      content: query,
      image: imageDataUrl
    };
    
    const activeSession = sessions.find(s => s.id === activeSessionId);
    if (!activeSession) return;

    const updatedHistory = [...activeSession.history, userMessage];
    const updatedSession = { ...activeSession, history: updatedHistory };
    
    await saveSession(updatedSession);
    setSessions(prev => prev.map(s => s.id === activeSessionId ? updatedSession : s));
    
    await executeSearchAndStream(updatedSession, imageFile);
  };

  const activeChatHistory = sessions.find(s => s.id === activeSessionId)?.history || [];

  if (isInitializing) {
    return <SplashScreen />;
  }
  return (
    <div className={`App ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <SessionSidebar 
        sessions={sessions}
        activeSessionId={activeSessionId}
        isCollapsed={isSidebarCollapsed}
        onToggle={toggleSidebar}
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
      />
      <div className="main-content">
        <button className="mobile-menu-toggle" onClick={toggleSidebar}>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
        <div className="chat-container" ref={chatContainerRef}>
          {error && <p style={{ color: 'red', textAlign: 'center' }}>{error}</p>}
          {activeChatHistory.length === 0 && !streamingMessage && !error && (
            <div className="initial-view"><h1>Gongdo</h1></div>
          )}

          {activeChatHistory.map((msg, index) => {
            const isLastAssistantMessage = index === activeChatHistory.length - 1 && msg.role === 'assistant';

            const messageContent = (
              <div className="chat-message">
                {editingMessageId === msg.id ? (
                  <div className="edit-form">
                    <textarea 
                      value={editedContent} 
                      onChange={(e) => setEditedContent(e.target.value)} 
                      className="edit-textarea"
                      autoFocus 
                    />
                    <div className="edit-form-actions">
                      <button onClick={handleEditSave}>저장 및 제출</button>
                      <button onClick={handleEditCancel}>취소</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {msg.image && typeof msg.image === 'string' && <img src={msg.image} alt="attachment" style={{maxWidth: '100%', borderRadius: '1rem', marginBottom: '0.5rem'}} />}
                    {msg.content && (msg.role === 'user' ? <p>{msg.content}</p> : (
                      <ResultDisplay 
                        answer={msg.content} 
                        sources={msg.sources || []} 
                        onSourceClick={handleSourceClick} 
                      />
                    ))}
                  </>
                )}
              </div>
            );

            return (
              <div key={msg.id} className={`chat-message-wrapper ${msg.role}`}>
                {msg.role === 'user' ? (
                  <div className="user-message-container">
                    <div className="message-actions on-hover">
                      <button onClick={() => handleDeleteMessage(msg.id)} className="action-button" title="삭제">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                    {messageContent}
                  </div>
                ) : (
                  <>
                    {messageContent}
                    {msg.sources && msg.sources.length > 0 && (
                      <ResultDisplay answer="" sources={msg.sources} onSourceClick={handleSourceClick} />
                    )}
                    {isLastAssistantMessage && !streamingMessage && !loading && (
                      <div className="message-actions">
                        <button onClick={() => handleEditStart(activeChatHistory[index - 1])} className="action-button" title="수정">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                          </svg>
                        </button>
                        <button onClick={handleRegenerate} className="action-button" title="재생성">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

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
        </div>
        
        <div className="search-form-container">
          <div className="search-form-inner">
            <SearchForm onSearch={handleSearch} loading={loading} />
          </div>
        </div>
      </div>

      <div className="app-overlay" onClick={toggleSidebar}></div>

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