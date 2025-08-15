import React from 'react';

export interface ClassSchedule {
  id: string;
  code: string;
  title: string;
  instructor: string;
  location: string;
  days: string[];
  startTime: string;
  endTime: string;
  backgroundColor?: string;
}

interface AnimationScheduleFrameProps {
  classes: ClassSchedule[];
  activeClass?: string;
  isHighlighting?: boolean;
}

const DAYS = ['M', 'Tu', 'W', 'Th', 'F'];
const TIME_SLOTS = [
  '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', 
  '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', 
  '4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM'
];

export const AnimationScheduleFrame: React.FC<AnimationScheduleFrameProps> = ({
  classes,
  activeClass,
  isHighlighting = false
}) => {
  // Helper function to get position in the schedule grid
  const getPositionStyle = (classItem: ClassSchedule) => {
    // Extract hour and convert to 24-hour format for positioning
    const getHour = (timeString: string) => {
      const [time, period] = timeString.split(' ');
      let [hours] = time.split(':').map(Number);
      
      if (period === 'PM' && hours !== 12) {
        hours += 12;
      } else if (period === 'AM' && hours === 12) {
        hours = 0;
      }
      
      return hours;
    };
    
    const startHour = getHour(classItem.startTime);
    const endHour = getHour(classItem.endTime);
    
    // Calculate position based on time (each hour is 60px height)
    const startPosition = (startHour - 8) * 60; // 8AM is our starting time
    const height = (endHour - startHour) * 60;
    
    // Assign a random but consistent color for the class
    const backgroundColor = classItem.backgroundColor || getRandomColor(classItem.code);
    
    return { 
      top: `${startPosition}px`, 
      height: `${height}px`,
      backgroundColor
    };
  };
  
  // Function to generate a deterministic color based on class code
  const getRandomColor = (code: string) => {
    const colors = [
      'rgba(239, 68, 68, 0.8)',   // red
      'rgba(249, 115, 22, 0.8)',  // orange
      'rgba(59, 130, 246, 0.8)',  // blue
      'rgba(16, 185, 129, 0.8)',  // green
      'rgba(139, 92, 246, 0.8)',  // purple
      'rgba(236, 72, 153, 0.8)',  // pink
    ];
    
    // Simple hash function to get consistent color for same class code
    let hash = 0;
    for (let i = 0; i < code.length; i++) {
      hash = code.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    return colors[Math.abs(hash) % colors.length];
  };
  
  return (
    <div className="bg-white/5 rounded-lg p-4 shadow-md">
      <h3 className="text-lg font-medium mb-4 text-white">Schedule</h3>
      
      <div className="relative overflow-x-auto rounded-lg">
        <div className="flex">
          {/* Time column */}
          <div className="w-16 flex-shrink-0">
            <div className="h-10"></div> {/* Header spacer */}
            {TIME_SLOTS.map((time, index) => (
              <div key={index} className="h-[60px] border-t border-zinc-700 px-2 text-xs text-zinc-400">
                <div className="relative -top-2">{time}</div>
              </div>
            ))}
          </div>
          
          {/* Days grid */}
          <div className="flex-grow grid grid-cols-5 gap-1">
            {/* Header row with days */}
            <div className="col-span-5 grid grid-cols-5 h-10">
              {DAYS.map((day, idx) => (
                <div 
                  key={idx} 
                  className="flex items-center justify-center text-sm font-medium text-zinc-300"
                >
                  {day}
                </div>
              ))}
            </div>
            
            {/* Time grid cells */}
            {DAYS.map((day, dayIdx) => (
              <div key={dayIdx} className="relative min-h-[780px] border-r border-zinc-700 bg-white/5">
                {/* Class blocks */}
                {classes
                  .filter(cls => cls.days.includes(day))
                  .map((cls, idx) => {
                    const style = getPositionStyle(cls);
                    return (
                      <div
                        key={`${cls.id}-${idx}`}
                        className={`absolute left-0 right-0 mx-1 rounded-sm p-1 overflow-hidden text-white text-xs
                          ${cls.id === activeClass ? 'ring-2 ring-white' : ''}
                          ${isHighlighting && cls.id === activeClass ? 'animate-pulse' : ''}
                        `}
                        style={style}
                      >
                        <div className="font-medium">{cls.code}</div>
                        <div className="text-[10px] opacity-80 truncate">{cls.location}</div>
                        <div className="text-[10px] opacity-80 truncate">
                          {cls.startTime} - {cls.endTime}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
