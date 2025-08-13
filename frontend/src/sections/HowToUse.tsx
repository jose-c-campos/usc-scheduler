import { howToUseData } from '../data/howToUse';
import HelmetCanvas from '../components/HelmetCanvas';
import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const HowToUse = () => {
  const cardRefs = useRef<HTMLDivElement[]>([]);
  const sectionRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      cardRefs.current.forEach((el) => {
        if (!el) return;

        gsap.fromTo(
          el,
          { opacity: 0, y: 60 },
          {
            opacity: 1,
            y: 0,
            duration: 0.9,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: el,
              start: 'top 85%',   // adjust if you want it sooner/later
            },
          }
        );
      });

      ScrollTrigger.refresh();     // locks in positions after layout
    }, sectionRef);

    return () => ctx.revert();      // cleans inline styles on unmount
  }, []);

  return (
    <section
      ref={sectionRef}
      id="howto"
      className="relative z-10 py-32 md:py-40 bg-black text-white overflow-hidden"
    >

      <div className="w-full max-w-4xl mx-auto px-6 md:px-0 space-y-32">
        {howToUseData.map((card, idx) => (
          <div
            key={card.id}
            ref={(el) => (cardRefs.current[idx] = el!)}
            className="space-y-6 relative z-20"
          >
            <h2 className="text-3xl md:text-4xl font-bold text-[#FFC700]">
              {card.title}
            </h2>

            <p className="text-lg md:text-xl text-gray-100">{card.desc}</p>

            <ul className="list-disc list-inside space-y-2 text-gray-300">
              {card.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
};

export default HowToUse;
