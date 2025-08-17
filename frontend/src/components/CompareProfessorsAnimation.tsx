import React, { useEffect, useMemo, useRef } from 'react';
import { gsap } from 'gsap';
import { CSSPlugin } from 'gsap/CSSPlugin';
gsap.registerPlugin(CSSPlugin);

interface CompareProfessorsAnimationProps {
  onCaptionChange?: (caption: string) => void;
  onComplete?: () => void;
}

const CompareProfessorsAnimation: React.FC<CompareProfessorsAnimationProps> = ({ onCaptionChange, onComplete }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const professors = useMemo(() => (
    [
      {
        name: 'Dr. Alice Johnson',
        classCodes: ['CSCI 270', 'CSCI 310'],
        overallRating: 4.6,
        courseRating: 4.4,
        difficulty: 2.7,
        wouldTakeAgain: 88,
      },
      {
        name: 'Prof. Mark Rivera',
        classCodes: ['MATH 225'],
        overallRating: 4.1,
        courseRating: 3.9,
        difficulty: 3.1,
        wouldTakeAgain: 75,
      },
      {
        name: 'Dr. Emily Chen',
        classCodes: ['BUAD 310'],
        overallRating: 4.9,
        courseRating: 4.7,
        difficulty: 2.3,
        wouldTakeAgain: 94,
      },
    ]
  ), []);

  useEffect(() => {
    if (!containerRef.current) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

      // Start hidden to avoid flicker
      gsap.set(containerRef.current, { autoAlpha: 0, y: 6 });

      // Caption in sync with fade-in
      onCaptionChange?.('Compare RateMyProfessor scores');

      // Robust fade-in
      tl.fromTo(containerRef.current, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.6 });

      // Small pop for cards: resolve NodeList now (no function-based targets)
      const cards = containerRef.current?.querySelectorAll('[data-card]') || [];
      if ((cards as any).length) {
        tl.from(cards, {
          autoAlpha: 0,
          y: 8,
          scale: 0.98,
          duration: 0.35,
          stagger: 0.06,
          ease: 'power2.out'
        }, '-=0.1');
      }
      // Ensure visibility during the card intro
      tl.set(containerRef.current, { autoAlpha: 1 });

      // Keep on screen ~3s
      tl.to({}, { duration: 3.0 });

      // Fade out and clear caption
      tl.call(() => onCaptionChange?.(''));
      tl.to(containerRef.current, { autoAlpha: 0, duration: 0.6, ease: 'power2.out' });

      tl.call(() => onComplete?.());
    }, containerRef);

    return () => { ctx.revert(); };
  }, [onCaptionChange, onComplete]);

  return (
  <div ref={containerRef} className="w-full min-h-[360px] flex items-center justify-center relative z-10 opacity-0">
      <div className="w-full flex items-center justify-center">
        <div className="flex flex-row items-center justify-center gap-6 md:gap-10">
          {professors.map((p) => (
            <div
              key={p.name}
              data-card
              className="bg-white/10 rounded-lg p-4 shadow-md text-white w-40 md:w-52 aspect-square flex flex-col"
            >
              <div className="font-semibold text-sm md:text-base mb-1 line-clamp-2">{p.name}</div>
              <div className="text-[10px] md:text-xs text-white/70 mb-2 truncate">{p.classCodes.join(', ')}</div>

              <div className="space-y-2 text-[10px] md:text-xs">
                <div>
                  <div className="flex justify-between mb-0.5"><span>Overall</span><span>{p.overallRating.toFixed(1)}</span></div>
                  <div className="h-[6px] w-full bg-white/20 rounded"><div className="h-full bg-white rounded" style={{ width: `${(p.overallRating / 5) * 100}%` }} /></div>
                </div>
                <div>
                  <div className="flex justify-between mb-0.5"><span>Course</span><span>{p.courseRating.toFixed(1)}</span></div>
                  <div className="h-[6px] w-full bg-white/20 rounded"><div className="h-full bg-white rounded" style={{ width: `${(p.courseRating / 5) * 100}%` }} /></div>
                </div>
                <div>
                  <div className="flex justify-between mb-0.5"><span>Difficulty</span><span>{p.difficulty.toFixed(1)}</span></div>
                  <div className="h-[6px] w-full bg-white/20 rounded"><div className="h-full bg-white rounded" style={{ width: `${(p.difficulty / 5) * 100}%` }} /></div>
                </div>
                <div>
                  <div className="flex justify-between mb-0.5"><span>Would Take</span><span>{p.wouldTakeAgain}%</span></div>
                  <div className="h-[6px] w-full bg-white/20 rounded"><div className="h-full bg-white rounded" style={{ width: `${p.wouldTakeAgain}%` }} /></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CompareProfessorsAnimation;
