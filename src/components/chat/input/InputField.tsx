import { useRef } from 'react';

interface InputFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
}

export const InputField: React.FC<InputFieldProps> = ({ 
  value, 
  onChange, 
  onSend, 
  disabled 
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };
  
  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
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