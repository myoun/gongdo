import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';

export interface Source {
  subject: string;
  source: string;
  page_num: number;
  text: string;
  original_index: number; // Add original_index to the type
}

interface ResultDisplayProps {
  answer: string;
  sources: Source[];
  status?: string;
}

const ResultDisplay: React.FC<ResultDisplayProps> = ({ answer, sources, status }) => {
  // Don't render anything if there's no activity
  if (!status && !answer && sources.length === 0) {
    return null;
  }

  return (
    <div style={{ textAlign: 'left', marginTop: '20px' }}>
      {/* Status Message */}
      {status && (
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px', backgroundColor: '#f0f0f0' }}>
          <p>{status}</p>
        </div>
      )}

      {/* Answer Section */}
      {answer && (
        <div style={{ marginBottom: '30px' }}>
          <h2>답변</h2>
          <div style={{ padding: '15px', border: '1px solid #eee', borderRadius: '5px', backgroundColor: '#f9f9f9' }}>
            <ReactMarkdown rehypePlugins={[rehypeRaw]}>{answer}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Sources Section */}
      {sources.length > 0 && (
        <div>
          <h2>출처</h2>
          {sources.map((source, index) => (
            <details key={index} style={{ marginBottom: '10px', border: '1px solid #eee', borderRadius: '5px', padding: '10px' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
                {/* Use original_index instead of index + 1 */}
                {`[${source.original_index}] ${source.source} (${source.page_num}쪽)`}
              </summary>
              <p style={{ marginTop: '10px' }}>{source.text}</p>
            </details>
          ))}
        </div>
      )}
    </div>
  );
};

export default ResultDisplay;


