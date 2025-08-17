import { useState } from 'react';
import './App.css';
import SearchForm from './components/SearchForm';
import ResultDisplay from './components/ResultDisplay';
import type { Source } from "./components/ResultDisplay"

function App() {
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const handleSearch = async (query: string) => {
    setLoading(true);
    setError('');
    setAnswer('');
    setSources([]);
    setStatus('');

    try {
      const response = await fetch('http://localhost:8000/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processStream = async () => {
        const { done, value } = await reader.read();
        if (done) {
          setLoading(false);
          setStatus('');
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last partial line in buffer

        lines.forEach(line => {
          if (line.trim() === '') return;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'status') {
              setStatus(parsed.data);
              setLoading(false);
            } else if (parsed.type === 'sources') {
              setSources(parsed.data);
            } else if (parsed.type === 'token') {
              if (status) setStatus('');
              setAnswer(prev => prev + parsed.data);
            } else if (parsed.type === 'correction') {
              const { invalid_indices } = parsed.data;
              setAnswer(currentAnswer => {
                let correctedAnswer = currentAnswer;
                invalid_indices.forEach((index: number) => {
                  // Regex to find [index], [ index ], etc. and remove it
                  // eslint-disable-next-line no-useless-escape
                  const regex = new RegExp(`[\s*${index}\s*]`, 'g');
                  correctedAnswer = correctedAnswer.replace(regex, '');
                });
                return correctedAnswer;
              });
            } else if (parsed.type === 'error') {
              setError(parsed.data);
              setStatus('');
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
      if (e instanceof Error) {
        setError(`검색에 실패했습니다: ${e.message}`);
      } else {
        setError('알 수 없는 오류가 발생했습니다.');
      }
    }
  };

  return (
    <div className="App">
      <h1>궁금한 것을 물어보세요</h1>
      <SearchForm onSearch={handleSearch} loading={loading && !status} />
      {error && <p style={{ color: 'red' }}>{error}</p>}
      
      { (status || answer || sources.length > 0) &&
        <ResultDisplay 
          answer={answer} 
          sources={sources} 
          status={status}
        />
      }
    </div>
  );
}

export default App;
