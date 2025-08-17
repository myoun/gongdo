import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import './ResultDisplay.css';

export interface Source {
  subject: string;
  source: string;
  page_num: number;
  text: string;
  original_index: number;
}

interface ResultDisplayProps {
  answer: string;
  sources: Source[];
  onSourceClick: (source: Source) => void;
}

const ResultDisplay: React.FC<ResultDisplayProps> = ({ answer, sources, onSourceClick }) => {
  // Render only the answer part if answer exists
  if (answer) {
    return <ReactMarkdown rehypePlugins={[rehypeRaw]}>{answer}</ReactMarkdown>;
  }

  // Render only the sources part if sources exist
  if (sources.length > 0) {
    return (
      <div className="source-icons-container">
        <strong>출처:</strong>
        {sources.map((source) => (
          <button 
            key={source.original_index} 
            className="source-icon"
            onClick={() => onSourceClick(source)}
          >
            [{source.original_index}]
          </button>
        ))}
      </div>
    );
  }

  return null; // Render nothing if both are empty
};

export default ResultDisplay;


