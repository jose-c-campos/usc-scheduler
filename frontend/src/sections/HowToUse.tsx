import { useRef, useEffect, useState } from 'react';
// Using the new component with a different name
import LandingPageAnimation from '../components/LandingPageAnimation';
import CompareSchedulesAnimation from '../components/CompareSchedulesAnimation';
import CompareProfessorsAnimation from '../components/CompareProfessorsAnimation';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import GenerateSchedulesAnimation from '../components/GenerateSchedulesAnimation';
import GeneratedResultsAnimation from '../components/GeneratedResultsAnimation';
import Hero from './Hero';

gsap.registerPlugin(ScrollTrigger);

const HowToUse = () => {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [caption, setCaption] = useState<string>('');
  const [displayCaption, setDisplayCaption] = useState<string>('');
  const [showCompare, setShowCompare] = useState(false);
  const [showProfessors, setShowProfessors] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // New: hero gating + replay
  const heroRef = useRef<HTMLDivElement | null>(null);
  const [showHero, setShowHero] = useState(true);
  const [hasAutoplayed, setHasAutoplayed] = useState(false);

  // Convenience: reset all flow flags and caption before a new run
  const resetFlow = () => {
    setCaption('');
    setDisplayCaption('');
    setShowCompare(false);
    setShowProfessors(false);
    setShowGenerate(false);
    setShowResults(false);
  };

  // Start the full sequence: fade out hero, then run the 4 steps
  const startFlow = () => {
    if (heroRef.current) {
      const tl = gsap.timeline();
      tl.to(heroRef.current, { autoAlpha: 0, y: -8, duration: 0.45, ease: 'power2.inOut' });
      tl.call(() => {
        setShowHero(false);
        resetFlow();
      });
    } else {
      setShowHero(false);
      resetFlow();
    }
  };

  // Animate hero in on mount and on re-show
  useEffect(() => {
    if (!sectionRef.current) return;

    // Intro reveal animations for static title/description if present
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

  // Hero show/hide handling with autoplay on first load
  useEffect(() => {
    if (!heroRef.current || !showHero) return;
    // Autoplay once after Hero has fully animated in + ~1s dwell
    if (!hasAutoplayed) {
      const tl = gsap.timeline();
      // ~1.5–1.6s for Hero intro + 1s dwell → total ~2.6s before fade out
      tl.to({}, { duration: 2.6 });
      tl.call(() => {
        setHasAutoplayed(true);
        startFlow();
      });
      return () => { tl.kill(); };
    }
  }, [showHero, hasAutoplayed]);

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
    if (!displayCaption || showHero) return null; // hide while hero is visible
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

    // Special case: Browse Your Recommended Schedules
    if (text.toLowerCase().includes('browse your recommended schedules')) {
      const m = text.match(/(.*)browse\s+your\s+recommended\s+schedules(.*)/i);
      const before = m?.[1] ?? '';
      const after = m?.[2] ?? '';
      return (
        <>
          {before}
          Browse <span className="text-usc-red">Your</span> <span className="text-yellow-400">Recommended Schedules</span>
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
      // New highlights
      { key: 'top schedules', className: 'text-yellow-400' },
      { key: 'toggle preferences', className: 'text-usc-red' },
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
        {/* Hero overlay inside same section footprint */}
        {showHero && (
          <div ref={heroRef} className="flex-1 min-h-0 w-full -translate-y-4 md:-translate-y-6">
            <Hero
              buttonLabel="How it Works"
              onHowItWorks={() => {
                setHasAutoplayed(true);
                startFlow();
              }}
            />
          </div>
        )}

        {/* Caption + Animation translated down without affecting layout height */}
        {!showHero && (
          <div className="h-full flex flex-col translate-y-6 md:translate-y-10">
            <div className="max-w-4xl mx-auto mb-4 md:mb-6 text-center shrink-0">
              <h2 className="section-title text-3xl md:text-5xl font-bold tracking-tight">
                {displayCaption ? renderCaption() : '\u00A0'}
              </h2>
            </div>
            <div className="flex-1 min-h-0 flex items-start justify-center pt-4 md:pt-6">
              {!showCompare && !showProfessors && !showGenerate && !showResults && (
                <LandingPageAnimation
                  onCaptionChange={setCaption}
                  onComplete={() => {
                    setTimeout(() => setShowCompare(true), 500);
                  }}
                />
              )}
              {showCompare && !showProfessors && !showGenerate && !showResults && (
                <CompareSchedulesAnimation
                  onCaptionChange={setCaption}
                  onComplete={() => {
                    setTimeout(() => setShowProfessors(true), 200);
                  }}
                />
              )}
              {showProfessors && !showGenerate && !showResults && (
                <CompareProfessorsAnimation
                  onCaptionChange={setCaption}
                  onComplete={() => {
                    setTimeout(() => setShowGenerate(true), 300);
                  }}
                />
              )}
              {showGenerate && !showResults && (
                <GenerateSchedulesAnimation
                  onCaptionChange={setCaption}
                  onComplete={() => {
                    setTimeout(() => setShowResults(true), 250);
                  }}
                />
              )}
              {showResults && (
                <GeneratedResultsAnimation
                  onCaptionChange={setCaption}
                  onComplete={() => {
                    // Bring hero back and keep it
                    setCaption('');
                    setDisplayCaption('');
                    setShowHero(true);
                    // reset flow flags so replay will restart from the beginning
                    resetFlow();
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default HowToUse;
