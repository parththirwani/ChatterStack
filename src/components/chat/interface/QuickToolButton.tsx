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
      className="
        group relative
        px-3 py-2 sm:px-5 sm:py-3
        bg-white/[0.03] hover:bg-white/[0.055]
        border border-white/[0.09] hover:border-white/20
        rounded-lg sm:rounded-xl
        transition-all duration-200
        hover:scale-105 hover:-translate-y-0.5
        cursor-pointer
        touch-manipulation
        active:scale-95
        min-h-[44px] sm:min-h-0
        flex items-center justify-center
      "
    >
      <div className="flex items-center gap-1.5 sm:gap-2.5">
        <span className="text-base sm:text-lg">{icon}</span>
        <span className="text-xs sm:text-sm font-medium text-[#c4c0bb] group-hover:text-white transition-colors truncate">
          {label}
        </span>
      </div>
    </button>
  );
};

export default QuickToolButton;