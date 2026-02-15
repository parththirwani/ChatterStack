import { MessageActions } from '../../actions/MessageActions';

export const AIMessageActions = ({ content, filename }) => {
  return (
    <div className="mt-3">
      <MessageActions content={content} filename={filename} />
    </div>
  );
};