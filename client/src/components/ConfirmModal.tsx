import React from 'react';
import './ConfirmModal.css';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ isOpen, onClose, onConfirm, title, message }) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="confirm-modal-overlay" onClick={onClose}>
      <div className="confirm-modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="confirm-modal-actions">
          <button className="confirm-modal-btn cancel" onClick={onClose}>
            취소
          </button>
          <button className="confirm-modal-btn confirm" onClick={onConfirm}>
            삭제
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
