import React from 'react';

export interface AnimationClassSelection {
  classCode: string;
}

interface AnimationClassSpotProps {
  classes: AnimationClassSelection[];
  isTyping?: boolean;
  isAnimating?: boolean;
}

export const AnimationClassSpot: React.FC<AnimationClassSpotProps> = ({ 
  classes, 
  isTyping = false,
  isAnimating = false
}) => {
  return (
    <div className="bg-white/5 rounded-lg p-4 mb-4 shadow-md">
      <div className="mb-3 text-white text-lg font-medium">Select Classes</div>
      
      <div className="space-y-3">
        {classes.map((cls, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className={`relative flex-1 max-w-xs ${isAnimating ? 'animate-pulse' : ''}`}>
              <input
                type="text"
                value={cls.classCode}
                readOnly
                className="w-full px-3 py-2 bg-white/10 text-white rounded border border-white/20 focus:border-usc-red focus:outline-none"
                placeholder="Enter class code (e.g. CSCI 103)"
              />
              {isTyping && idx === classes.length - 1 && (
                <span className="absolute right-3 top-2.5 h-5 w-0.5 bg-usc-red animate-blink"></span>
              )}
            </div>
            
            {/* Dropdown simulation (visible during class selection animation) */}
            {isTyping && idx === classes.length - 1 && (
              <div className="absolute z-10 mt-1 w-full max-w-xs bg-zinc-800 border border-zinc-700 rounded-md shadow-lg py-1 max-h-60 overflow-auto">
                <div className="px-3 py-2 text-white/90 hover:bg-zinc-700">{cls.classCode}</div>
                <div className="px-3 py-2 text-white/60 hover:bg-zinc-700">{cls.classCode.split(' ')[0]} 104</div>
                <div className="px-3 py-2 text-white/60 hover:bg-zinc-700">{cls.classCode.split(' ')[0]} 270</div>
              </div>
            )}
          </div>
        ))}
      </div>
      
      {/* Add Another Class Button */}
      <button className="mt-3 text-sm text-white/80 hover:text-white flex items-center gap-1">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        Add Another Class
      </button>
    </div>
  );
};
