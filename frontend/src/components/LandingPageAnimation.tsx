import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AnimationClassSpot } from './ScheduleAnimationAssets/AnimationClassSpot';
import type { AnimationClassSelection } from './ScheduleAnimationAssets/AnimationClassSpot';
import { AnimationPreferencePanel } from './ScheduleAnimationAssets/AnimationPreferencePanel';
import { AnimationScheduleFrame } from './ScheduleAnimationAssets/AnimationScheduleFrame';
import type { ClassSchedule } from './ScheduleAnimationAssets/AnimationScheduleFrame';
import { AnimationProfessorFrame } from './ScheduleAnimationAssets/AnimationProfessorFrame';
import './ScheduleAnimation.css';

const LandingPageAnimation: React.FC = () => {
  // References for GSAP animations
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const activePreferenceRef = useRef<string | null>(null);
  const activeProfRatingRef = useRef<string | null>(null);
  const activeClassRef = useRef<string | null>(null);
  
  // Mock data for the animation
  const mockClasses: AnimationClassSelection[] = [
    { classCode: 'CSCI 270' },
    { classCode: 'MATH 225' },
    { classCode: 'BISC 120' }
  ];

  const mockPreferenceTimeOptions = [
    { id: 'morning', label: 'Morning (8AM - 12PM)', selected: false },
    { id: 'afternoon', label: 'Afternoon (12PM - 5PM)', selected: true },
    { id: 'evening', label: 'Evening (5PM - 10PM)', selected: false }
  ];

  const mockPreferenceDaysOptions = [
    { id: 'monday', label: 'Monday', selected: false },
    { id: 'tuesday', label: 'Tuesday', selected: false },
    { id: 'wednesday', label: 'Wednesday', selected: false },
    { id: 'thursday', label: 'Thursday', selected: false },
    { id: 'friday', label: 'Friday', selected: true }
  ];

  const mockProfessors = [
    {
      name: 'Aaron Cote',
      classCodes: ['CSCI 270'],
      overallRating: 4.2,
      courseRating: 3.8,
      difficulty: 3.5,
      wouldTakeAgain: 85
    },
    {
      name: 'David Kempe',
      classCodes: ['CSCI 270'],
      overallRating: 3.9,
      courseRating: 4.0,
      difficulty: 4.2,
      wouldTakeAgain: 78
    }
  ];

  const mockSchedules: ClassSchedule[] = [
    {
      id: 'csci270',
      code: 'CSCI 270',
      title: 'Introduction to Algorithms',
      instructor: 'Aaron Cote',
      location: 'SAL 101',
      days: ['M', 'W'],
      startTime: '10:00 AM',
      endTime: '11:50 AM',
      backgroundColor: 'rgba(239, 68, 68, 0.8)'
    },
    {
      id: 'math225',
      code: 'MATH 225',
      title: 'Linear Algebra',
      instructor: 'Emily Roberts',
      location: 'KAP 145',
      days: ['Tu', 'Th'],
      startTime: '2:00 PM',
      endTime: '3:20 PM',
      backgroundColor: 'rgba(59, 130, 246, 0.8)'
    },
    {
      id: 'bisc120',
      code: 'BISC 120',
      title: 'General Biology',
      instructor: 'Michael Chen',
      location: 'ZHS 159',
      days: ['M', 'W', 'F'],
      startTime: '1:00 PM',
      endTime: '1:50 PM',
      backgroundColor: 'rgba(16, 185, 129, 0.8)'
    }
  ];

  // Set up GSAP animation
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Create a new timeline
    const tl = gsap.timeline({
      paused: true,
      repeat: -1,  // Loop the animation
      repeatDelay: 1  // Add a delay between repeats
    });
    
    timelineRef.current = tl;

    // Elements for animation
    const container = containerRef.current;
    const classSection = container.querySelector('.class-section');
    const prefSection = container.querySelector('.preference-section');
    const profSection = container.querySelector('.professor-section');
    const scheduleSection = container.querySelector('.schedule-section');
    
    // Initial state - only show class selection
    gsap.set([prefSection, profSection, scheduleSection], { autoAlpha: 0, display: 'none' });
    gsap.set(classSection, { autoAlpha: 1 });
    
    // Animation sequence
    tl
      // Step 1: Show and animate class selection
      .from(classSection, { 
        y: 20, 
        autoAlpha: 0, 
        duration: 0.7, 
        ease: 'power3.out' 
      })
      .to({}, { duration: 1.5 }) // Pause
      
      // Step 2: Bring in preferences panel
      .to(classSection, { 
        y: -10, 
        scale: 0.98, 
        duration: 0.5 
      })
      .set(prefSection, { display: 'block', autoAlpha: 0 })
      .to(prefSection, { 
        autoAlpha: 1, 
        y: 0, 
        duration: 0.7, 
        ease: 'power3.out',
        onStart: () => {
          activePreferenceRef.current = 'time';
        }
      })
      .to({}, { duration: 1.5 }) // Pause
      
      // Step 3: Animate preference selection (time of day)
      .to({}, { 
        duration: 0.5,
        onStart: () => {
          activePreferenceRef.current = 'time';
        }
      })
      .to({}, { duration: 1.0 }) // Pause
      
      // Step 4: Animate preference selection (days off)
      .to({}, { 
        duration: 0.5,
        onStart: () => {
          activePreferenceRef.current = 'days';
        }
      })
      .to({}, { duration: 1.0 }) // Pause
      
      // Step 5: Animate preference selection (section types)
      .to({}, { 
        duration: 0.5,
        onStart: () => {
          activePreferenceRef.current = 'sections';
        }
      })
      .to({}, { duration: 1.0 }) // Pause
      
      // Step 6: Bring in professor ratings
      .to([classSection, prefSection], { 
        y: -20, 
        scale: 0.95, 
        duration: 0.5 
      })
      .set(profSection, { display: 'block', autoAlpha: 0 })
      .to(profSection, { 
        autoAlpha: 1, 
        y: 0, 
        duration: 0.7, 
        ease: 'power3.out' 
      })
      .to({}, { duration: 1.0 }) // Pause
      
      // Step 7: Animate professor ratings (overall)
      .to({}, { 
        duration: 0.5,
        onStart: () => {
          activeProfRatingRef.current = 'overall';
        }
      })
      .to({}, { duration: 0.8 }) // Pause
      
      // Step 8: Animate professor ratings (course)
      .to({}, { 
        duration: 0.5,
        onStart: () => {
          activeProfRatingRef.current = 'course';
        }
      })
      .to({}, { duration: 0.8 }) // Pause
      
      // Step 9: Bring in schedule view
      .to([classSection, prefSection, profSection], { 
        y: -30, 
        scale: 0.9, 
        duration: 0.5 
      })
      .set(scheduleSection, { display: 'block', autoAlpha: 0 })
      .to(scheduleSection, { 
        autoAlpha: 1, 
        y: 0, 
        duration: 0.7, 
        ease: 'power3.out' 
      })
      .to({}, { duration: 1.5 }) // Pause
      
      // Step 10: Highlight different classes in the schedule
      .to({}, { 
        duration: 0.5,
        onStart: () => {
          activeClassRef.current = 'csci270';
        }
      })
      .to({}, { duration: 1.0 }) // Pause
      
      // Step 11: Highlight second class in the schedule
      .to({}, { 
        duration: 0.5,
        onStart: () => {
          activeClassRef.current = 'math225';
        }
      })
      .to({}, { duration: 1.0 }) // Pause
      
      // Step 12: Highlight third class in the schedule
      .to({}, { 
        duration: 0.5,
        onStart: () => {
          activeClassRef.current = 'bisc120';
        }
      })
      .to({}, { duration: 1.0 }) // Pause
      
      // Reset everything for the next iteration
      .to([classSection, prefSection, profSection, scheduleSection], { 
        autoAlpha: 0, 
        y: 10,
        duration: 0.5, 
        ease: 'power2.in',
        onComplete: () => {
          activePreferenceRef.current = null;
          activeProfRatingRef.current = null;
          activeClassRef.current = null;
        }
      });
    
    // Start the animation
    tl.play();
    
    // Cleanup function
    return () => {
      if (timelineRef.current) {
        timelineRef.current.kill();
      }
    };
  }, []);
  
  return (
    <div ref={containerRef} className="w-full max-w-5xl mx-auto py-8 min-h-[600px]">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Class Selection */}
        <div className="class-section" data-section="classes">
          <AnimationClassSpot classes={mockClasses} isTyping={true} />
        </div>
        
        {/* Preferences */}
        <div className="preference-section" data-section="preferences">
          <AnimationPreferencePanel 
            timeOptions={mockPreferenceTimeOptions}
            daysOffOptions={mockPreferenceDaysOptions}
            avoidLabs={false}
            avoidDiscussions={true}
            excludeFullSections={true}
            activeSetting={activePreferenceRef.current || undefined}
          />
        </div>
        
        {/* Professor Ratings */}
        <div className="professor-section" data-section="professors">
          <AnimationProfessorFrame 
            professors={mockProfessors}
            activeRating={activeProfRatingRef.current || undefined}
          />
        </div>
        
        {/* Schedule View */}
        <div className="schedule-section" data-section="schedule">
          <AnimationScheduleFrame 
            classes={mockSchedules}
            activeClass={activeClassRef.current || undefined}
            isHighlighting={true}
          />
        </div>
      </div>
    </div>
  );
};

export default LandingPageAnimation;
