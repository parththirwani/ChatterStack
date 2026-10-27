import React from 'react';
import { GitBranch, MoreHorizontal } from 'lucide-react';
import Menu from '@/src/components/customize/Menu';
import { isSavedMessageId } from '@/src/lib/client/message-id';

interface MessageMenuProps {
  /** Message this menu acts on. A fork point has to be a row the database saved. */
  messageId?: string;
  onFork: (messageId: string) => void;
  /** A fork of this message is being created. */
  forking?: boolean;
  /** Which edge of the menu lines up with the button. */
  align?: 'start' | 'end';
  className?: string;
}

const TRIGGER = 'flex h-8 w-8 items-center justify-center rounded-md text-[#aaa6a2] transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-white';

/**
 * More actions for one saved message. Both roles get the same entry point, so
 * the fork choice never depends on who wrote the message.
 */
const MessageMenu: React.FC<MessageMenuProps> = ({ messageId, onFork, forking = false, align = 'end', className = '' }) => {
  // The cut point is a saved row id, so a message that only exists in this tab
  // (or is still being written) gets no menu at all.
  if (!isSavedMessageId(messageId)) return null;

  return (
      <div className={className}>
        <Menu
          label="More message actions"
          portal
          align={align}
          disabled={forking}
          trigger={<MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
          triggerClassName={TRIGGER}
          items={[{
            label: 'Fork in new chat',
            icon: <GitBranch className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />,
            onSelect: () => onFork(messageId),
            disabled: forking,
          }]}
        />
      </div>
  );
};

export default MessageMenu;
