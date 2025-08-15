import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { motion } from 'framer-motion';
import ScheduleFrame from './ScheduleFrame';

type Section = {
  type: string; days: string; time: string; instructor: string;
  seats_registered?: number; seats_total?: number;
};
type Cls = { code: string; sections: Section[] };

const useDemoSchedules = () => {
  // Two very similar schedules with 1-2 sections changing to illustrate "compare"
  const A: Cls[] = [
    { code: 'CSCI 103', sections: [{ type:'Lecture', days:'Mon, Wed', time:'9:00 am-10:20 am', instructor:'A. Nguyen', seats_registered:18, seats_total:25 }]},
    { code: 'MATH 225', sections: [{ type:'Lecture', days:'Tue, Thu', time:'10:00 am-11:20 am', instructor:'K. Patel', seats_registered:25, seats_total:25 }]},
    { code: 'EE 109',   sections: [{ type:'Lecture', days:'Mon, Wed', time:'1:00 pm-2:20 pm', instructor:'S. Kim', seats_registered:12, seats_total:25 }]},
  ];
  const B: Cls[] = [
    { code: 'CSCI 103', sections: [{ type:'Lecture', days:'Mon, Wed', time:'9:00 am-10:20 am', instructor:'A. Nguyen', seats_registered:18, seats_total:25 }]},
    // MATH moved later to show a subtle difference
    { code: 'MATH 225', sections: [{ type:'Lecture', days:'Tue, Thu', time:'12:00 pm-1:20 pm', instructor:'K. Patel', seats_registered:20, seats_total:25 }]},
    { code: 'EE 109',   sections: [{ type:'Lecture', days:'Mon, Wed', time:'1:00 pm-2:20 pm', instructor:'S. Kim', seats_registered:12, seats_total:25 }]},
  ];
  // Ghost block "manual build" target time/day is Tue 10:00–11:20
  const ghost: Cls = { code:'PHYS 151', sections:[{ type:'Lecture', days:'Tue, Thu', time:'10:00 am-11:20 am', instructor:'TBA' }]};
  return { A, B, ghost };
};

const ScheduleAnimation = () => {
  const { A, B, ghost } = useDemoSchedules();

  const rootRef = useRef<HTMLDivElement>(null);
  const wrapARef = useRef<HTMLDivElement>(null);
  const wrapBRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const starRef  = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' }, repeat: -1, repeatDelay: 1 });

      // Initial state - everything starts invisible
      gsap.set(titleRef.current, { opacity: 0, y: 20 });
      gsap.set([wrapARef.current, wrapBRef.current], { opacity: 0, y: 20 });
      gsap.set(wrapBRef.current, { xPercent: 20 }); // B is off to the right
      gsap.set(ghostRef.current, { opacity: 0, scale: 0.9 });
      gsap.set(starRef.current,  { opacity: 0, scale: 0.6 });

      // Step 1: Fade in title and Schedule A
      tl.to(titleRef.current, { opacity: 1, y: 0, duration: 0.6 }, 'start');
      tl.to(wrapARef.current, { opacity: 1, y: 0, duration: 0.6 }, 'start+=0.2');

      // Step 2: Stagger in Schedule A's class blocks
      tl.from(
        wrapARef.current?.querySelectorAll('.class-block') ?? [],
        { opacity: 0, y: 16, scale: 0.96, transformOrigin: '50% 50%', stagger: 0.06, duration: 0.4 },
        '-=0.2'
      );

      // Step 3: Compare - slide A left, bring in B
      tl.to(wrapARef.current, { xPercent: -10, duration: 0.6, ease: 'power2.inOut' }, 'compare');
      tl.to(wrapBRef.current, { opacity: 1, y: 0, xPercent: 0, duration: 0.6, ease: 'power2.inOut' }, 'compare+=0.02');

      // Step 4: Highlight the differences in Schedule B
      tl.to(
        wrapBRef.current?.querySelectorAll('.class-block') ?? [],
        { scale: 1.03, duration: 0.25, yoyo: true, repeat: 1, stagger: 0.08, ease: 'power1.inOut' },
        'compare+=0.4'
      );

      // Step 5: Manual build - animate the ghost class
      tl.to(ghostRef.current, { opacity: 1, scale: 1, y: -20, duration: 0.25 }, 'drag');
      tl.to(ghostRef.current, { y: 0, duration: 0.5, ease: 'power2.out' }, 'drag+=0.25');

      // Step 6: Conflict shake animation & resolution
      tl.to(ghostRef.current, { x: 6, duration: 0.05, yoyo: true, repeat: 5, ease: 'power1.inOut' }, 'drag+=0.6');
      tl.to(ghostRef.current, { y: 8, duration: 0.3, ease: 'power1.inOut' }, 'drag+=1');

      // Step 7: Star the preferred schedule
      tl.to(starRef.current, { opacity: 1, scale: 1, duration: 0.25, ease: 'back.out(2)' }, 'drag+=1.1');

      // Reset for loop
      tl.to([titleRef.current, wrapARef.current, wrapBRef.current, ghostRef.current, starRef.current], 
           { opacity: 0, duration: 0.4 }, '+=0.8');
      tl.set([titleRef.current, wrapARef.current, wrapBRef.current, ghostRef.current, starRef.current], 
            { clearProps: 'all' });
    }, rootRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={rootRef} className="relative bg-black text-white py-16 overflow-hidden">
      {/* Title */}
      <div ref={titleRef} className="text-center mb-8 px-6">
        <h2 className="text-3xl md:text-4xl font-bold text-[#FFC700] mb-2">
          See How It Works
        </h2>
        <p className="text-lg md:text-xl text-gray-100 mt-2">
          Generate, compare, and fine-tune — all in one place.
        </p>
      </div>

      {/* Two schedules side-by-side */}
      <div className="relative mx-auto max-w-6xl px-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Schedule A */}
        <div ref={wrapARef} data-schedule="A" className="relative bg-white/5 rounded-xl p-3">
          <div ref={starRef} className="absolute top-2 right-2">
            <motion.div
              initial={{ scale: 0 }}
              animate={{}}
              className="inline-flex items-center gap-1 bg-[#FFC700] text-black font-semibold px-2 py-1 rounded-full text-xs shadow"
            >
              ★ Top Pick
            </motion.div>
          </div>
          
          {/* Use the existing ScheduleFrame component */}
          <div className="schedule-wrapper">
            <ScheduleFrame classes={A} />
          </div>
        </div>

        {/* Schedule B */}
        <div ref={wrapBRef} data-schedule="B" className="relative bg-white/5 rounded-xl p-3">
          <div className="schedule-wrapper">
            <ScheduleFrame classes={B} />
          </div>
        </div>

        {/* Ghost block for manual build demonstration */}
        <div
          ref={ghostRef}
          className="absolute hidden md:block bg-yellow-400 text-gray-800 rounded-md text-[0.6rem] p-1"
          style={{
            left: 'calc(50% - 260px)', 
            top: '220px',
            width: '140px',
            height: '32px',
            zIndex: 50,
            pointerEvents: 'none',
            boxShadow: '0 6px 18px rgba(0,0,0,.25)'
          }}
        >
          <div className="font-bold truncate -mb-0.5">PHYS 151</div>
          <div className="truncate -mb-0.5">Lecture</div>
          <div className="truncate">10:00–11:20</div>
        </div>
      </div>

      {/* Workflow explanation */}
      <div className="mt-6 text-center text-white/60 text-sm">
        Auto-generate → Compare → Drag-and-drop to refine
      </div>
    </div>
  );
};

export default ScheduleAnimation;
