import React, { useEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import AnimScheduleFrame from './ScheduleAnimationAssets/AnimScheduleFrame';
import ProfessorFrame from './ProfessorFrame';

interface GeneratedResultsAnimationProps {
  onCaptionChange?: (caption: string) => void;
  onComplete?: () => void;
}

type AnimSection = { type: string; days: string; time: string; instructor: string };
type AnimClass = { code: string; sections: AnimSection[] };

// 5 unique schedules, simple mock structure that ScheduleFrame can render
const useMockSchedules = () => {
  return useMemo(() => ([
  [
      { code: 'CSCI 270', sections: [ { type: 'lecture', days: 'M, W', time: '10:00 am-11:50 am', instructor: 'Dr. Alice Johnson' } ] },
      { code: 'MATH 225', sections: [ { type: 'lecture', days: 'Tu, Th', time: '2:00 pm-3:20 pm', instructor: 'Prof. Mark Rivera' } ] },
      { code: 'BISC 120', sections: [ { type: 'lecture', days: 'M, W, F', time: '1:00 pm-1:50 pm', instructor: 'Dr. Emily Chen' } ] },
      { code: 'BUAD 310', sections: [ { type: 'lecture', days: 'Tu, Th', time: '9:30 am-10:50 am', instructor: 'Dr. Emily Chen' } ] },
    ],
    [
      { code: 'CSCI 104', sections: [ { type: 'lecture', days: 'M, W', time: '9:00 am-10:20 am', instructor: 'Dr. Patel' } ] },
      { code: 'EE 109',  sections: [ { type: 'lecture', days: 'Tu, Th', time: '12:30 pm-1:50 pm', instructor: 'Dr. Lin' } ] },
      { code: 'WRIT 150', sections: [ { type: 'lecture', days: 'M, W, F', time: '11:00 am-11:50 am', instructor: 'TBA' } ] },
      { code: 'PHYS 151', sections: [ { type: 'lecture', days: 'Tu, Th', time: '3:30 pm-4:50 pm', instructor: 'Dr. Nguyen' } ] },
    ],
    [
      { code: 'PSYC 100', sections: [ { type: 'lecture', days: 'M, W', time: '2:00 pm-3:20 pm', instructor: 'Dr. Wu' } ] },
      { code: 'HIST 102', sections: [ { type: 'lecture', days: 'Tu, Th', time: '10:00 am-11:20 am', instructor: 'Dr. Gomez' } ] },
      { code: 'ECON 203', sections: [ { type: 'lecture', days: 'M, W, F', time: '12:00 pm-12:50 pm', instructor: 'Dr. Park' } ] },
      { code: 'CTIN 190', sections: [ { type: 'lecture', days: 'F', time: '2:00 pm-4:50 pm', instructor: 'TBA' } ] },
    ],
  ] as AnimClass[][]), []);
};

const professorsFrom = (sched: AnimClass[]) => {
  const set = new Map<string, { name: string; classCodes: string[]; overallRating: number; courseRating: number; difficulty: number; wouldTakeAgain: number }>();
  sched.forEach((cls: AnimClass) => {
    cls.sections.forEach((sec: AnimSection) => {
      const name = (sec.instructor || '').trim();
      if (!name || name.toLowerCase() === 'tba') return;
      const key = name;
      if (!set.has(key)) set.set(key, { name, classCodes: [cls.code], overallRating: 4.2, courseRating: 4.1, difficulty: 2.8, wouldTakeAgain: 85 });
      else {
        const p = set.get(key)!;
        if (!p.classCodes.includes(cls.code)) p.classCodes.push(cls.code);
      }
    });
  });
  return Array.from(set.values());
};

const GeneratedResultsAnimation: React.FC<GeneratedResultsAnimationProps> = ({ onCaptionChange, onComplete }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const schedules = useMockSchedules();
  const combined = useMemo(() => schedules.map((s) => ({ classes: s, professors: professorsFrom(s) })), [schedules]);

  useEffect(() => {
    if (!containerRef.current) return;

    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

    // Set caption and fade in container
    onCaptionChange?.('Browse Your Recommended Schedules');
  gsap.set(containerRef.current, { autoAlpha: 0, y: 8 });
  tl.to(containerRef.current, { autoAlpha: 1, y: 0, duration: 0.45 });

    // Vertical scroll through all items; total animation ~5s
    const viewport = containerRef.current.querySelector('[data-anim="results-viewport"]') as HTMLElement | null;
    const list = containerRef.current.querySelector('[data-anim="results-list"]') as HTMLElement | null;
    if (list && viewport) {
      const distance = Math.max(0, list.scrollHeight - viewport.clientHeight);
      // Aim for ~6s total: ~0.45 in + 5.0 scroll + ~0.55 out
      tl.to(list, { y: -distance, duration: 5.0, ease: 'none' }, '+=0.1');
    } else {
      tl.to({}, { duration: 5.0 });
    }

    tl.call(() => onCaptionChange?.(''));
  tl.to(containerRef.current, { autoAlpha: 0, duration: 0.55, ease: 'power2.out' });
    tl.call(() => onComplete?.());

  return () => { tl.kill(); };
  }, []);

  return (
    <div ref={containerRef} className="w-full">
      <div className="max-h-[620px] overflow-hidden" data-anim="results-viewport">
        <div data-anim="results-list" className="space-y-8 will-change-transform">
      {combined.map((item, idx) => (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div>
                <AnimScheduleFrame classes={item.classes as any} minHeight={560} />
              </div>
              <div>
                <ProfessorFrame professors={item.professors} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default GeneratedResultsAnimation;
