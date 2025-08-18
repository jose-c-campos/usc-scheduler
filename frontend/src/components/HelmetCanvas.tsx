import { Canvas } from '@react-three/fiber';
import type { Group } from 'three';
import { Suspense, useRef, useLayoutEffect } from 'react';
import { OrbitControls, useGLTF } from '@react-three/drei';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import helmetModel from '../assets/trojan_helmet/scene.gltf?url';

gsap.registerPlugin(ScrollTrigger);

const RotatingHelmet = () => {
  const group = useRef<Group>(null);
  const { scene } = useGLTF(helmetModel);

  // Scroll‑controlled rotation
  useLayoutEffect(() => {
    if (!group.current) return;

    gsap.to(group.current.rotation, {
      y: 2 * Math.PI,            // one full turn
      ease: 'none',
      scrollTrigger: {
        trigger: '#howto',       // starts when How‑to‑Use enters viewport
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,             // ties rotation to scroll progress
      },
    });
  }, []);

  return (
    <primitive
      ref={group}
      object={scene}
      scale={0.15}                 // adjust size here
      position={[0, -0.8, 0]}     // lower so it sits behind cards
      dispose={null}
    />
  );
};

const HelmetCanvas = () => (
  <>
    <div className="absolute inset-0 -z-10 pointer-events-none">
      <Canvas camera={{ position: [0, 0, 8], fov: 45 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 10, 2]} intensity={1} />
        <Suspense fallback={null}>
          <RotatingHelmet />
        </Suspense>
        {/* lock camera controls */}
        <OrbitControls enablePan={false} enableZoom={false} enableRotate={false} />
      </Canvas>
    </div>
  </>
);

export default HelmetCanvas;

