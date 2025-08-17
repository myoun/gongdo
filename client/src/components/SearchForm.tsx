import React, { useState, useRef, useCallback } from 'react';
import './SearchForm.css';

interface SearchFormProps {
  onSearch: (query: string, imageFile?: File) => void;
  loading: boolean;
}

const SearchForm: React.FC<SearchFormProps> = ({ onSearch, loading }) => {
  const [query, setQuery] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (file && file.type.startsWith('image/')) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if(fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() && !imageFile) return;
    onSearch(query, imageFile ?? undefined);
    setQuery('');
    handleRemoveImage();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const file = e.clipboardData.files[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  };

  return (
    <form 
      onSubmit={handleSubmit} 
      className={`search-form ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {imagePreview && (
        <div className="image-preview-container">
          <img src={imagePreview} alt="Preview" className="preview-image" />
          <button type="button" onClick={handleRemoveImage} className="remove-image-btn">&times;</button>
        </div>
      )}
      <div className="input-wrapper">
        <input
          type="file"
          accept="image/*"
          onChange={handleImageChange}
          ref={fileInputRef}
          style={{ display: 'none' }}
          id="image-upload"
        />
        <label htmlFor="image-upload" className="attach-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
          </svg>
        </label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onPaste={handlePaste}
          placeholder="질문을 입력하거나 이미지를 붙여넣기 또는 드래그하세요..."
          className="query-input"
          disabled={loading}
        />
        <button type="submit" disabled={loading || (!query.trim() && !imageFile)} className="submit-btn">
          {loading ? '검색 중...' : '검색'}
        </button>
      </div>
      {isDragging && <div className="drop-overlay">이미지를 여기에 드롭하세요</div>}
    </form>
  );
};

export default SearchForm;
