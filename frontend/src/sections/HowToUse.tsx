import { useRef } from 'react';
import ScheduleAnimation from '../components/ScheduleAnimation';
import '../components/ScheduleAnimation.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const HowToUse = () => {
  const sectionRef = useRef<HTMLElement | null>(null);

  return (
    <section
      ref={sectionRef}
      id="howto"
      className="relative z-10 py-16 md:py-24 bg-black text-white overflow-hidden"
    >
      <ScheduleAnimation />
    </section>
  );
};

export default HowToUse;
