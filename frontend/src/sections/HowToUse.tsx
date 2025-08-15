import { useRef, useEffect } from 'react';
// Using the new component with a different name
import LandingPageAnimation from '../components/LandingPageAnimation';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const HowToUse = () => {
  const sectionRef = useRef<HTMLElement | null>(null);
  
  useEffect(() => {
    if (!sectionRef.current) return;
    
    // Animate section title on scroll
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
    
    // Animate description text on scroll
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
  }, []);

  return (
    <section
      ref={sectionRef}
      id="howto"
      className="relative z-10 py-16 md:py-24 bg-black text-white overflow-hidden"
    >
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto mb-16 text-center">
          <h2 className="section-title text-4xl md:text-5xl font-bold mb-6">
            How It Works
          </h2>
          <p className="section-description text-xl text-gray-300 leading-relaxed">
            USC Scheduler makes it easy to build your perfect class schedule in just a few simple steps.
            Select your classes, set your preferences, and let our algorithm do the rest.
          </p>
        </div>
        
        <LandingPageAnimation />
      </div>
    </section>
  );
};

export default HowToUse;
