import React from 'react';
import { theme } from '../styles/theme';

interface UploadProgressModalProps {
  isOpen: boolean;
  progress: number;
  status: string;
  title?: string;
}

const UploadProgressModal: React.FC<UploadProgressModalProps> = ({
  isOpen,
  progress,
  status,
  title = '엑셀 업로드 중'
}) => {
  if (!isOpen) return null;

  return (
    <div style={{
      ...theme.modal.overlay,
      zIndex: 1000,
    }}>
      <div style={{
        ...theme.modal.content,
        width: '400px',
      }}>
        <h2 style={{
          fontSize: '20px',
          fontWeight: 'bold',
          marginBottom: '20px',
          textAlign: 'center',
          color: theme.colors.textPrimary,
        }}>{title}</h2>

        <div style={{
          width: '100%',
          height: '30px',
          backgroundColor: theme.colors.borderLight,
          borderRadius: theme.radius.full,
          overflow: 'hidden',
          marginBottom: '15px',
        }}>
          <div style={{
            width: `${progress}%`,
            height: '100%',
            backgroundColor: theme.colors.primary,
            transition: 'width 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {progress > 0 && (
              <span style={{
                color: 'white',
                fontSize: '14px',
                fontWeight: 'bold',
              }}>{progress}%</span>
            )}
          </div>
        </div>

        <p style={{
          textAlign: 'center',
          color: theme.colors.textSecondary,
          fontSize: '14px',
          margin: 0,
        }}>{status}</p>
      </div>
    </div>
  );
};

export default UploadProgressModal;