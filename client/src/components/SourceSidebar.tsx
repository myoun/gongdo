import React from 'react';
import './SourceSidebar.css';
import { Source } from './ResultDisplay';

interface SourceSidebarProps {
  source: Source;
  onClose: () => void;
}

const SourceSidebar: React.FC<SourceSidebarProps> = ({ source, onClose }) => {
  return (
    <div className="sidebar-overlay" onClick={onClose}>
      <div className="sidebar-panel" onClick={(e) => e.stopPropagation()}>
        <button className="sidebar-close-btn" onClick={onClose}>&times;</button>
        <h3>출처 상세 정보</h3>
        <div className="sidebar-content">
          <p><strong>과목:</strong> {source.subject}</p>
          <p><strong>출처:</strong> {source.source}</p>
          <p><strong>페이지:</strong> {source.page_num}쪽</p>
          <hr />
          <p className="source-text">{source.text}</p>
        </div>
      </div>
    </div>
  );
};

export default SourceSidebar;
