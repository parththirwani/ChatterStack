import React, { useState } from 'react';

interface TooltipButtonProps {
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
  className?: string;
}

const TooltipButton: React.FC<TooltipButtonProps> = ({
  icon,
  tooltip,
  onClick,
  className = '',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`w-12 h-12 flex items-center justify-center rounded-lg transition-all duration-200 hover:bg-white/10 hover:scale-105 active:scale-95 ${className}`}
      >
        {icon}
      </button>
      {showTooltip && (
        <div className="absolute left-16 top-1/2 transform -translate-y-1/2 z-50">
          <div className="bg-gray-800 text-white px-3 py-2 rounded-lg shadow-lg text-sm font-medium whitespace-nowrap border border-gray-600">
            {tooltip}
            <div className="absolute left-0 top-1/2 transform -translate-x-1 -translate-y-1/2 w-2 h-2 bg-gray-800 border-l border-b border-gray-600 rotate-45"></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TooltipButton;