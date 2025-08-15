import React from 'react';

interface AnimationPreferenceOption {
  id: string;
  label: string;
  selected: boolean;
}

interface AnimationPreferencePanelProps {
  timeOptions: AnimationPreferenceOption[];
  daysOffOptions: AnimationPreferenceOption[];
  avoidLabs: boolean;
  avoidDiscussions: boolean;
  excludeFullSections: boolean;
  activeSetting?: string;
}

export const AnimationPreferencePanel: React.FC<AnimationPreferencePanelProps> = ({
  timeOptions,
  daysOffOptions,
  avoidLabs,
  avoidDiscussions,
  excludeFullSections,
  activeSetting
}) => {
  return (
    <div className="bg-white/5 rounded-lg p-4 mb-4 shadow-md">
      <div className="mb-3 text-white text-lg font-medium">Preferences</div>
      
      {/* Time of Day */}
      <div className={`mb-4 ${activeSetting === 'time' ? 'animate-pulse' : ''}`}>
        <h3 className="font-bold text-white mb-2">Time of Day <span className="text-xs font-normal text-zinc-400">(Choose up to 2)</span></h3>
        <div className="flex flex-col gap-2">
          {timeOptions.map(option => (
            <label key={option.id} className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
              <span
                className={`w-5 h-5 flex items-center justify-center border-2 rounded bg-transparent transition-colors
                  ${option.selected ? "border-usc-red bg-usc-red" : "border-zinc-400"}
                `}
              >
                {option.selected && (
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </span>
              <span className="capitalize">{option.label}</span>
            </label>
          ))}
        </div>
      </div>
      
      {/* Days Off */}
      <div className={`mb-4 ${activeSetting === 'days' ? 'animate-pulse' : ''}`}>
        <h3 className="font-bold text-white mb-2">Preferred Days Off <span className="text-xs font-normal text-zinc-400">(Max 4)</span></h3>
        <div className="flex flex-col gap-2">
          {daysOffOptions.map(option => (
            <label key={option.id} className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
              <span
                className={`w-5 h-5 flex items-center justify-center border-2 rounded bg-transparent transition-colors
                  ${option.selected ? "border-usc-red bg-usc-red" : "border-zinc-400"}
                `}
              >
                {option.selected && (
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </span>
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>
      
      {/* Section Type */}
      <div className={`mb-4 ${activeSetting === 'sections' ? 'animate-pulse' : ''}`}>
        <h3 className="font-bold text-white mb-2">Section Type</h3>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
            <span
              className={`w-5 h-5 flex items-center justify-center border-2 rounded bg-transparent transition-colors
                ${avoidLabs ? "border-usc-red bg-usc-red" : "border-zinc-400"}
              `}
            >
              {avoidLabs && (
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </span>
            Avoid Labs
          </label>
          <label className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
            <span
              className={`w-5 h-5 flex items-center justify-center border-2 rounded bg-transparent transition-colors
                ${avoidDiscussions ? "border-usc-red bg-usc-red" : "border-zinc-400"}
              `}
            >
              {avoidDiscussions && (
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </span>
            Avoid Discussions
          </label>
        </div>
      </div>
      
      {/* Availability */}
      <div className={`mb-4 ${activeSetting === 'full' ? 'animate-pulse' : ''}`}>
        <h3 className="font-bold text-white mb-2">Availability</h3>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
            <span
              className={`w-5 h-5 flex items-center justify-center border-2 rounded bg-transparent transition-colors
                ${excludeFullSections ? "border-usc-red bg-usc-red" : "border-zinc-400"}
              `}
            >
              {excludeFullSections && (
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </span>
            Only Show Available Sections
          </label>
        </div>
      </div>
    </div>
  );
};
