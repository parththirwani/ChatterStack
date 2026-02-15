import { InputField } from './InputField';
import { SendButton } from './SendButton';
import { ModelSelector } from './ModelSelector';

export const MessageInput = ({ message, onMessageChange, onSendMessage, loading }) => {
  return (
    <div className="relative bg-[#282230] rounded-2xl">
      <div className="relative p-3 flex items-end gap-2">
        <ModelSelector />
        <InputField 
          value={message}
          onChange={onMessageChange}
          onSend={onSendMessage}
          disabled={loading}
        />
        <SendButton onClick={onSendMessage} disabled={loading} />
      </div>
    </div>
  );
};