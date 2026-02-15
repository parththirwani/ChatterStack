import { useRef } from 'react';

export const InputField = ({ value, onChange, onSend, disabled }) => {
  const textareaRef = useRef(null);
  
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };
  
  const handleInput = (e) => {
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 200) + 'px';
  };
  
  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyPress={handleKeyPress}
      onInput={handleInput}
      disabled={disabled}
      className="flex-1 text-white bg-transparent resize-none"
    />
  );
};