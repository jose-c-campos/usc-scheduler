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

    const collectDiffNodes = (): HTMLElement[] => {
      const root = containerRef.current!;
      let nodes: HTMLElement[] = [];
      // primary: robust by data attribute
      root
        .querySelectorAll<HTMLElement>('div.rounded-md[data-course-code]')
        .forEach((block) => {
          const code = block.getAttribute('data-course-code')?.trim() || '';
          if (targetCodes.has(code)) nodes.push(block);
        });

      // fallback: older markup (span.font-bold with course code)
      if (nodes.length === 0) {
        root.querySelectorAll('span.font-bold').forEach((el) => {
          const text = (el.textContent || '').trim();
          if (targetCodes.has(text)) {
            const block = (el as HTMLElement).closest('div.rounded-md') as HTMLElement | null;
            if (block) nodes.push(block);
          }
        });
      }
      return nodes;
    };

    const diffNodes = collectDiffNodes();

    // Build a dedicated blink timeline we can insert, ensuring the main TL waits for it
    const blinkTl = gsap.timeline();
    if (diffNodes.length) {
      // Evenly space 3 slower pulses across ~4.0s after fade-in
  const pulseOn = 0.6;   // slower, steadier in
  const pulseOff = 0.6;  // slower, steadier out
  const totalPulse = (pulseOn + pulseOff) * 3; // 3.6s
      const totalWindow = 4.0;
  const gap = Math.max(0, (totalWindow - totalPulse) / 4); // small gaps before, between, after

      // initial gap
      if (gap > 0) blinkTl.to({}, { duration: gap });

      for (let i = 0; i < 3; i++) {
        // add ring at pulse start
        blinkTl.call(() => {
          diffNodes.forEach((n) => n.classList.add('ring-2', 'ring-yellow-400', 'ring-opacity-100'));
        });
        // glow on (steady, smooth)
        blinkTl.to(diffNodes, {
          filter: 'drop-shadow(0 0 18px rgba(255,199,0,0.95)) drop-shadow(0 0 10px rgba(255,199,0,0.85))',
          scale: 1.02,
          duration: pulseOn,
          ease: 'power1.inOut',
          overwrite: true,
          force3D: true,
        });
        // remove ring + glow off
        blinkTl.call(() => {
          diffNodes.forEach((n) => n.classList.remove('ring-2', 'ring-yellow-400', 'ring-opacity-100'));
        });
        blinkTl.to(diffNodes, {
          filter: 'drop-shadow(0 0 0 rgba(0,0,0,0))',
          scale: 1.0,
          duration: pulseOff,
          ease: 'power1.inOut',
          overwrite: true,
          force3D: true,
        });
        // gap between pulses (and an ending gap after the last)
        if (gap > 0) blinkTl.to({}, { duration: gap });
      }
      // cleanup any remaining glow/ring
      blinkTl.set(diffNodes, { filter: 'none' });
      blinkTl.call(() => {
        diffNodes.forEach((n) => n.classList.remove('ring-2', 'ring-yellow-400', 'ring-opacity-100'));
      });
    } else {
      // Fallback hold to keep step duration similar
      blinkTl.to({}, { duration: 1.0 });
    }

  // Ensure outer container won't clip glows and sits above neighbors
  tl.set(containerRef.current, { overflow: 'visible', zIndex: 5, position: 'relative' }, 0);
  // Insert the blink timeline slightly after fade-in so DOM is definitely ready
  tl.add(blinkTl, '+=0.1');
  // Wait for the blink timeline to finish before proceeding to fade out
  tl.addLabel('afterBlink');

  // Fade out UI; clear caption 0.3s before fade completes
  tl.to(containerRef.current, { autoAlpha: 0, duration: 0.6, ease: 'power2.out' });
  tl.call(() => captionCbRef.current?.(''), [], '-=0.3');

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
