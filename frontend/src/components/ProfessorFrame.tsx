import React from 'react';
import SkillBar from './SkillBar';

interface Professor {
  name: string;
  classCodes: string[];
  overallRating: number;
  courseRating: number;
  difficulty: number;
  wouldTakeAgain: number;
}

interface ProfessorFrameProps {
  professors: Professor[];
}

const ProfessorFrame = ({ professors }: ProfessorFrameProps) => {
  return (
    <div className="bg-white/10 rounded-lg p-2">
      <h3 className="text-lg font-medium mb-2 text-white">Professors</h3>
      
      {/* Two-column grid for professors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[450px] overflow-y-auto pr-1">
        {professors.map((professor) => (
          <div key={professor.name} className="bg-white/5 rounded p-2">
            {/* Professor name in bigger font */}
            <div className="font-medium text-base mb-0.5 text-white">
              {professor.name}
            </div>
            
            {/* Classes taught in smaller font */}
            <div className="text-xs text-white/70 mb-2">
              {professor.classCodes.join(', ')}
            </div>
            
            {/* Compact skill bars */}
            <div className="space-y-1">
              <SkillBar 
                label="Overall" 
                value={professor.overallRating} 
                maxValue={5} 
                color="bg-white" 
              />
              <SkillBar 
                label="Course" 
                value={professor.courseRating} 
                maxValue={5} 
                color="bg-white" 
              />
              <SkillBar 
                label="Difficulty" 
                value={professor.difficulty} 
                maxValue={5} 
                color="bg-white" 
              />
              <SkillBar 
                label="Would Take" 
                value={professor.wouldTakeAgain} 
                maxValue={100} 
                color="bg-white" 
                showAsPercentage={true}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProfessorFrame;