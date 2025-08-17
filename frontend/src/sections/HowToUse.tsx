import { useRef, useEffect, useState } from 'react';
// Using the new component with a different name
import LandingPageAnimation from '../components/LandingPageAnimation';
import CompareSchedulesAnimation from '../components/CompareSchedulesAnimation';
import CompareProfessorsAnimation from '../components/CompareProfessorsAnimation';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const HowToUse = () => {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [caption, setCaption] = useState<string>('');
  const [displayCaption, setDisplayCaption] = useState<string>('');
  const [showCompare, setShowCompare] = useState(false);
  const [showProfessors, setShowProfessors] = useState(false);
  
  useEffect(() => {
    if (!sectionRef.current) return;
    const hasTitle = !!document.querySelector('.section-title');
    if (hasTitle) {
      gsap.from('.section-title', {
        opacity: 0,
        y: 50,
        duration: 1,
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 80%',
          end: 'top 50%',
          toggleActions: 'play none none reverse'
        }
      });
    }
    const hasDesc = !!document.querySelector('.section-description');
    if (hasDesc) {
      gsap.from('.section-description', {
        opacity: 0,
        y: 30,
        duration: 1,
        delay: 0.3,
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 80%',
          end: 'top 50%',
          toggleActions: 'play none none reverse'
        }
      });
    }
  }, []);

  // Crossfade captions: fade out current, swap text, fade in new
  useEffect(() => {
    const el = document.querySelector('.section-title') as HTMLElement | null;
    if (!el || caption === displayCaption) {
      // First mount or no change
      if (!displayCaption && caption) setDisplayCaption(caption);
      return;
    }
    if (displayCaption) {
      gsap.to(el, {
        autoAlpha: 0,
        y: 6,
        duration: 0.25,
        ease: 'power1.out',
        onComplete: () => setDisplayCaption(caption),
      });
    } else {
      setDisplayCaption(caption);
    }
  }, [caption, displayCaption]);

  useEffect(() => {
    if (!displayCaption) return;
    const el = document.querySelector('.section-title');
    if (!el) return;
    gsap.fromTo(
      el,
      { autoAlpha: 0, y: 6 },
      { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power2.out' }
    );
  }, [displayCaption]);

  const renderCaption = () => {
    // light, tasteful highlights for key phrases
    if (!displayCaption) return null;
    const parts: React.ReactNode[] = [];
    const text = displayCaption;

    // Special-case styling for compare step: "Compare" yellow, "side-by-side" red
    if (text.toLowerCase().includes('compare schedules side-by-side')) {
      const before = text.split(/compare\s+schedules\s+side-by-side/i)[0] || '';
      const after = text.split(/compare\s+schedules\s+side-by-side/i)[1] || '';
      return (
        <>
          {before}
          <span className="text-yellow-400">Compare</span>
          {" schedules "}
          <span className="text-usc-red">side-by-side</span>
          {after}
        </>
      );
    }

    const replacements: Array<{ key: string; className: string }> = [
      { key: 'class code', className: 'text-yellow-400' },
      { key: 'real time', className: 'text-yellow-400' },
      { key: ' red', className: 'text-usc-red' },
      { key: 'save', className: 'text-yellow-400' },
      { key: 'compare', className: 'text-yellow-400' },
      { key: 'side-by-side', className: 'text-usc-red' },
    ];

    // Find the first occurrence of any keyword and wrap it; keep it minimal
  let replaced = false;
  for (const { key, className } of replacements) {
      const idx = text.toLowerCase().indexOf(key.toLowerCase());
      if (idx !== -1) {
        parts.push(text.slice(0, idx));
        parts.push(
          <span key={key} className={className}>
            {text.slice(idx, idx + key.length)}
          </span>
        );
        parts.push(text.slice(idx + key.length));
        replaced = true;
        break; // only one highlight per caption
      }
    }
    if (!replaced) parts.push(text);
    return parts;
  };

  return (
    <section
      ref={sectionRef}
      id="howto"
      className="relative h-screen bg-zinc-900 text-white overflow-hidden"
    >
  <div className="container mx-auto px-4 h-full flex flex-col">
        {/* Dynamic caption */}
  <div className="max-w-4xl mx-auto mb-4 md:mb-6 text-center shrink-0">
          {displayCaption && (
            <h2 className="section-title text-3xl md:text-5xl font-bold tracking-tight">
              {renderCaption()}
            </h2>
          )}
        </div>
  <div className="flex-1 min-h-0 flex items-start justify-center pt-4 md:pt-6">
          {!showCompare && !showProfessors && (
            <LandingPageAnimation
              onCaptionChange={setCaption}
              onComplete={() => {
                // Wait briefly before starting next step
                setTimeout(() => setShowCompare(true), 500);
              }}
            />
          )}
          {showCompare && !showProfessors && (
            <CompareSchedulesAnimation
              onCaptionChange={setCaption}
              onComplete={() => {
                // minimal gap before professor compare
                setTimeout(() => setShowProfessors(true), 200);
              }}
            />
          )}
          {showProfessors && (
            <CompareProfessorsAnimation onCaptionChange={setCaption} />
          )}
        </div>
      </div>
    </section>
  );
};

export default HowToUse;
