import React from 'react';

interface QuickToolButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
}

const QuickToolButton: React.FC<QuickToolButtonProps> = ({ icon, label, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="group relative px-5 py-3 bg-gray-800/30 hover:bg-gray-800/50 border border-gray-700/30 hover:border-yellow-500/30 rounded-xl transition-all duration-200 hover:scale-105 hover:-translate-y-0.5 cursor-pointer"
    >
      <div className="flex items-center gap-2.5">
        <span className="text-lg">{icon}</span>
        <span className="text-sm font-medium text-gray-300 group-hover:text-yellow-400 transition-colors">
          {label}
        </span>
      </div>
    </button>
  );
};

export default QuickToolButton;