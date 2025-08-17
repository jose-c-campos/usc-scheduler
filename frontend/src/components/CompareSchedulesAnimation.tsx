import React, { useEffect, useMemo, useRef } from 'react';
import { gsap } from 'gsap';
import { CSSPlugin } from 'gsap/CSSPlugin';
gsap.registerPlugin(CSSPlugin);
import ScheduleFrame from './ScheduleFrame';

interface CompareSchedulesAnimationProps {
  onCaptionChange?: (caption: string) => void;
  onComplete?: () => void;
}

const CompareSchedulesAnimation: React.FC<CompareSchedulesAnimationProps> = ({ onCaptionChange, onComplete }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const captionCbRef = useRef<typeof onCaptionChange>(onCaptionChange);
  const completeCbRef = useRef<typeof onComplete>(onComplete);

  // keep latest callbacks without retriggering the animation
  useEffect(() => { captionCbRef.current = onCaptionChange; }, [onCaptionChange]);
  useEffect(() => { completeCbRef.current = onComplete; }, [onComplete]);

  // Prepare two mock schedules: two shared classes, two different
  const leftSchedule = useMemo(() => (
    [
      {
        code: 'CSCI 270',
        sections: [
          { type: 'lecture', days: 'M, W', time: '10:00 am-11:50 am', instructor: 'TBA' },
        ],
      },
      {
        code: 'MATH 225',
        sections: [
          { type: 'lecture', days: 'Tu, Th', time: '2:00 pm-3:20 pm', instructor: 'TBA' },
        ],
      },
      {
        code: 'BISC 120',
        sections: [
          { type: 'lecture', days: 'M, W, F', time: '1:00 pm-1:50 pm', instructor: 'TBA' },
        ],
      },
      {
        code: 'BUAD 310',
        sections: [
          { type: 'lecture', days: 'Tu, Th', time: '9:30 am-10:50 am', instructor: 'TBA' },
        ],
      },
    ]
  ), []);

  const rightSchedule = useMemo(() => (
    [
      {
        code: 'CSCI 270',
        sections: [
          { type: 'lecture', days: 'M, W', time: '10:00 am-11:50 am', instructor: 'TBA' },
        ],
      },
      {
        code: 'MATH 225',
        sections: [
          { type: 'lecture', days: 'Tu, Th', time: '2:00 pm-3:20 pm', instructor: 'TBA' },
        ],
      },
      // Different ones on the right schedule
      {
        code: 'PHYS 135',
        sections: [
          { type: 'lecture', days: 'M, W, F', time: '9:00 am-9:50 am', instructor: 'TBA' },
        ],
      },
      {
        code: 'BUAD 307',
        sections: [
          { type: 'lecture', days: 'Tu, Th', time: '11:00 am-12:20 pm', instructor: 'TBA' },
        ],
      },
    ]
  ), []);

  useEffect(() => {
    if (!containerRef.current) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

  // Ensure container starts hidden to avoid pre-reveal flicker
  gsap.set(containerRef.current, { autoAlpha: 0, y: 6 });

  // Set caption first, wait ~1s, then fade in schedules
  captionCbRef.current?.('Compare schedules side-by-side');
  tl.to({}, { duration: 1.0 });
  // Fade in schedules (robust fromTo avoids stuck opacity)
  tl.fromTo(
    containerRef.current,
    { autoAlpha: 0, y: 6 },
    { autoAlpha: 1, y: 0, duration: 0.6 }
  );

  // After visible, blink-glow the different courses on both schedules (all at once, 3 blinks)
    const targetCodes = new Set(['PHYS 135', 'BUAD 307', 'BISC 120', 'BUAD 310']);
  let diffNodes: HTMLElement[] = [];
  // Resolve differing blocks slightly after fade-in to ensure DOM is ready
  tl.add(() => {
      const root = containerRef.current!;
      diffNodes = [];
      root.querySelectorAll('span.font-bold').forEach((el) => {
        const text = (el.textContent || '').trim();
        if (targetCodes.has(text)) {
          const block = (el as HTMLElement).closest('div.rounded-md');
          if (block) diffNodes.push(block as HTMLElement);
        }
      });
      // Create blink tween now that nodes are available: 3 visible peaks with yoyo + repeat: 2
      if (diffNodes.length) {
        // We want exactly 3 visible "ON" peaks. With yoyo, forward passes happen at iterations 0,2,4 → repeat: 4
        const blinkHalfDuration = 0.5; // seconds per half-cycle
        const blinkRepeats = 4;         // produces 3 visible peaks
        const totalBlinkTime = (blinkRepeats + 1) * blinkHalfDuration; // 5 * 0.5 = 2.5s
        tl.fromTo(
          diffNodes,
          { boxShadow: '0 0 0 0 rgba(255, 199, 0, 0)', scale: 1 },
          {
            boxShadow: '0 0 0 6px rgba(255,199,0,0.9), 0 0 18px rgba(255,199,0,0.4)',
            scale: 1.045,
            duration: blinkHalfDuration,
            yoyo: true,
            repeat: blinkRepeats,
            ease: 'sine.inOut',
            overwrite: true,
            force3D: true,
          }
        );
        // Hold on-screen so total visible time ≈ 4s after fade-in
        const desiredVisibleSeconds = 4.0;
        const extraHold = Math.max(0, desiredVisibleSeconds - totalBlinkTime);
        if (extraHold > 0) {
          tl.to({}, { duration: extraHold });
        }
        // Clear the temporary glow styles
        tl.set(diffNodes, { clearProps: 'boxShadow,transform' });
        tl.set(containerRef.current, { autoAlpha: 1 });
      }
  }, '+=0.1');

    // After blinking completes, fade caption, then fade out to blank
    tl.call(() => captionCbRef.current?.(''));
    tl.to(containerRef.current, { autoAlpha: 0, duration: 0.6, ease: 'power2.out' });

    // Notify completion
    tl.call(() => completeCbRef.current?.());
    }, containerRef);

    return () => {
      ctx.revert();
    };
  }, []);

  return (
  <div ref={containerRef} className="w-full min-h-[300px] opacity-0">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <div>
          <ScheduleFrame classes={leftSchedule} />
        </div>
        <div>
          <ScheduleFrame classes={rightSchedule} />
        </div>
      </div>
    </div>
  );
};

export default CompareSchedulesAnimation;
