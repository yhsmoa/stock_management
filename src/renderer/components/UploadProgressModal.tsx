import React from 'react';

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
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '10px',
        padding: '30px',
        width: '400px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      }}>
        <h2 style={{
          fontSize: '20px',
          fontWeight: 'bold',
          marginBottom: '20px',
          textAlign: 'center',
          color: '#333',
        }}>{title}</h2>

        <div style={{
          width: '100%',
          height: '30px',
          backgroundColor: '#f0f0f0',
          borderRadius: '15px',
          overflow: 'hidden',
          marginBottom: '15px',
        }}>
          <div style={{
            width: `${progress}%`,
            height: '100%',
            backgroundColor: '#4CAF50',
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
          color: '#666',
          fontSize: '14px',
          margin: 0,
        }}>{status}</p>
      </div>
    </div>
  );
};

export default UploadProgressModal;