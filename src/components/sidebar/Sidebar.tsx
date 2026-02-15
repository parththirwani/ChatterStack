import { SidebarHeader } from './header/SidebarHeader';
import { ActionButtons } from './actions/ActionButtons';
import { ChatHistory } from './history/ChatHistory';
import { UserSection } from './user/UserSection';

export const Sidebar = ({ collapsed, onToggleCollapse, user }) => {
  return (
    <div className={collapsed ? 'w-20' : 'w-80'}>
      <SidebarHeader collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
      <ActionButtons collapsed={collapsed} />
      {!collapsed && <ChatHistory />}
      <UserSection user={user} collapsed={collapsed} />
    </div>
  );
};