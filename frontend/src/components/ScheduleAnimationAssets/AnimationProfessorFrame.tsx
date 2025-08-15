import React from 'react';

interface Professor {
  name: string;
  classCodes: string[];
  overallRating: number;
  courseRating: number;
  difficulty: number;
  wouldTakeAgain: number;
}

interface AnimationProfessorFrameProps {
  professors: Professor[];
  activeRating?: string;
}

export const AnimationProfessorFrame: React.FC<AnimationProfessorFrameProps> = ({ 
  professors,
  activeRating
}) => {
  return (
    <div className="bg-white/10 rounded-lg p-3 shadow-md" style={{ minHeight: '300px' }}>
      <h3 className="text-lg font-medium mb-2 text-white">Professors</h3>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto pr-1">
        {professors.map((professor) => (
          <div key={professor.name} className="bg-white/5 rounded p-2">
            <div className="font-medium text-base mb-0.5 text-white">
              {professor.name}
            </div>
            
            <div className="text-xs text-white/70 mb-2">
              {professor.classCodes.join(', ')}
            </div>
            
            <div className="space-y-1">
              {/* Overall Rating */}
              <div className={`${activeRating === 'overall' ? 'animate-pulse' : ''}`}>
                <div className="flex justify-between text-[11px] mb-[2px] text-white">
                  <span>Overall</span>
                  <span>{professor.overallRating.toFixed(1)}</span>
                </div>
                <div className="h-[6px] w-full bg-white/20 rounded">
                  <div
                    style={{ width: `${(professor.overallRating / 5) * 100}%` }}
                    className="h-full bg-white rounded"
                  />
                </div>
              </div>
              
              {/* Course Rating */}
              <div className={`${activeRating === 'course' ? 'animate-pulse' : ''}`}>
                <div className="flex justify-between text-[11px] mb-[2px] text-white">
                  <span>Course</span>
                  <span>{professor.courseRating.toFixed(1)}</span>
                </div>
                <div className="h-[6px] w-full bg-white/20 rounded">
                  <div
                    style={{ width: `${(professor.courseRating / 5) * 100}%` }}
                    className="h-full bg-white rounded"
                  />
                </div>
              </div>
              
              {/* Difficulty */}
              <div className={`${activeRating === 'difficulty' ? 'animate-pulse' : ''}`}>
                <div className="flex justify-between text-[11px] mb-[2px] text-white">
                  <span>Difficulty</span>
                  <span>{professor.difficulty.toFixed(1)}</span>
                </div>
                <div className="h-[6px] w-full bg-white/20 rounded">
                  <div
                    style={{ width: `${(professor.difficulty / 5) * 100}%` }}
                    className="h-full bg-white rounded"
                  />
                </div>
              </div>
              
              {/* Would Take Again */}
              <div className={`${activeRating === 'wouldTake' ? 'animate-pulse' : ''}`}>
                <div className="flex justify-between text-[11px] mb-[2px] text-white">
                  <span>Would Take</span>
                  <span>{professor.wouldTakeAgain.toFixed(0)}%</span>
                </div>
                <div className="h-[6px] w-full bg-white/20 rounded">
                  <div
                    style={{ width: `${professor.wouldTakeAgain}%` }}
                    className="h-full bg-white rounded"
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
