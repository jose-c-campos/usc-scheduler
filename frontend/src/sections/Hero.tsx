import React, { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';

/**
 * Hero – final version (arrow fix)
 * -----------------------------------------------------------
 * • Text animations as before.
 * • Scroll arrow now uses `strokeLinecap="butt"` and resets with +4 px offset
 *   so absolutely no residual pixels remain.
 */

const Hero: React.FC = () => {
  const heroRef = useRef<HTMLDivElement>(null);
  const leadingWhiteRef = useRef<HTMLSpanElement>(null);
  const perfectRef = useRef<HTMLSpanElement>(null);
  const uscRef = useRef<HTMLSpanElement>(null);
  const subRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const stemRef = useRef<SVGPathElement>(null);
  const headRef = useRef<SVGPathElement>(null);

  useLayoutEffect(() => {
    /* ---------------- TEXT ANIMATIONS ---------------- */
        const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      // lead phrase + subtitle + button slide‑in and fade
      tl.fromTo(
        [leadingWhiteRef.current, subRef.current, buttonRef.current],
        { x: 150, opacity: 0 },
        { x: 0, opacity: 1, stagger: 0.1, duration: 1 }
      )
        // "Perfect" flip
        .from(
          perfectRef.current,
          {
            y: -90,
            rotationX: 130,
            opacity: 0,
            duration: 0.9,
            transformOrigin: '50% 0%',
          },
          '-=0.6'
        )
        // "USC Schedule" rise
        .fromTo(
          uscRef.current,
          { y: 90, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8 },
          '-=0.4'
        );

      /* ARROW ANIMATION unchanged */
      const stem = stemRef.current;
      const head = headRef.current;
      if (stem && head) {
        const offsetExtra = 4;
        const lenStem = stem.getTotalLength() + offsetExtra;
        const lenHead = head.getTotalLength() + offsetExtra;

        gsap.set(stem, { strokeDasharray: lenStem, strokeDashoffset: lenStem });
        gsap.set(head, { strokeDasharray: lenHead, strokeDashoffset: lenHead });

        gsap.timeline({ repeat: -1, repeatDelay: 1 })
          .to(stem, { strokeDashoffset: 0, duration: 0.8, ease: 'power1.inOut' })
          .to(head, { strokeDashoffset: 0, duration: 0.4, ease: 'power1.inOut' }, '-=0.2')
          .to([head, stem], {
            strokeDashoffset: (i: number) => (i === 0 ? lenHead : lenStem),
            duration: 0.6,
            ease: 'power1.in',
          }, '+=0.6');
      }
    }, heroRef);

    return () => ctx.revert();

    tl.from([leadingWhiteRef.current, subRef.current, buttonRef.current], {
      x: 150,
      opacity: 0,
      stagger: 0.1,
      duration: 1,
    })
      .from(
        perfectRef.current,
        {
          y: -90,
          rotationX: 130,
          opacity: 0,
          duration: 0.9,
          transformOrigin: '50% 0%',
        },
        '-=0.6'
      )
      .from(
        uscRef.current,
        {
          y: 90,
          opacity: 0,
          duration: 0.8,
        },
        '-=0.4'
      );

    /* ---------------- ARROW DRAW ANIMATION ---------------- */
    const stem = stemRef.current;
    const head = headRef.current;
    if (stem && head) {
      const offsetExtra = 4; // extra px to push path fully off
      const lenStem = stem.getTotalLength() + offsetExtra;
      const lenHead = head.getTotalLength() + offsetExtra;

      gsap.set(stem, { strokeDasharray: lenStem, strokeDashoffset: lenStem });
      gsap.set(head, { strokeDasharray: lenHead, strokeDashoffset: lenHead });

      gsap.timeline({ repeat: -1, repeatDelay: 1 })
        .to(stem, { strokeDashoffset: 0, duration: 0.8, ease: 'power1.inOut' })
        .to(head, { strokeDashoffset: 0, duration: 0.4, ease: 'power1.inOut' }, '-=0.2')
        .to([head, stem], {
          strokeDashoffset: (i: number, t: SVGPathElement) => (i === 0 ? lenHead : lenStem),
          duration: 0.6,
          ease: 'power1.in',
        }, '+=0.6');
    }
  }, []);

  return (
    <section className="relative h-screen flex items-center justify-center bg-dark-bg text-white overflow-hidden select-none">
      {/* scroll prompt bottom‑left */}
      <div className="absolute left-6 bottom-8 flex items-center space-x-2 text-gray-400 text-sm">
        <svg width="12" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="butt" strokeLinejoin="miter">
          <path ref={stemRef} d="M6 0v18" />
          <path ref={headRef} d="M2 14l4 4 4-4" />
        </svg>
        <span>Scroll</span>
      </div>

      <div ref={heroRef} className="text-center space-y-6 px-6">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-tight">
          <span ref={leadingWhiteRef}>Build Your </span>
          <span ref={perfectRef} className="text-[#FFC700] inline-block">Perfect</span>{' '}
          <span ref={uscRef} className="text-[#990000] inline-block">USC Schedule</span>
        </h1>
        <p ref={subRef} className="text-gray-100 text-lg md:text-xl">
          Generate conflict‑free timetables in under&nbsp;200&nbsp;ms.
        </p>
        <button ref={buttonRef} className="mt-6 bg-[#990000] hover:bg-[#b31b1b] text-white transition-colors font-bold py-3 px-8 rounded-full text-lg">
          Try it now
        </button>
      </div>
    </section>
  );
};

export default Hero;
