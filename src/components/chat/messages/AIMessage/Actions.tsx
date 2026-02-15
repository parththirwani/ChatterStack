import MessageActions from "../../actions/MessageActions";

interface AIMessageActionsProps {
  content: string;
  filename?: string;
}

export const AIMessageActions: React.FC<AIMessageActionsProps> = ({ 
  content, 
  filename 
}) => {
  return (
    <div className="mt-3">
      <MessageActions content={content} filename={filename} />
    </div>
  );
};