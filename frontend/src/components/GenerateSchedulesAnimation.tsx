import React, { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import PreferencePanel from './PreferencePanel';

// Local types for tiny mock usage
interface ClassOption { code: string; label: string; }

// Keep options small; mirror earlier step for visual consistency
const CLASS_OPTIONS: ClassOption[] = [
  { code: 'CSCI 270', label: 'CSCI 270 – Introduction to Algorithms' },
  { code: 'MATH 225', label: 'MATH 225 – Linear Algebra and Differential Equations' },
  { code: 'BISC 120', label: 'BISC 120 – General Biology: Organismal Biology and Evolution' },
  { code: 'BUAD 310', label: 'BUAD 310 – Applied Business Statistics' },
];

// Local ClassSpotInput (copied style from the Landing step to avoid touching production ClassSpot)
const ClassSpotInput: React.FC<{
  idx: number;
  value: string;
  onChange: (v: string) => void;
  onSelect: (code: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  showDropdown: boolean;
}> = ({ idx, value, onChange, onSelect, inputRef, showDropdown }) => {
  const filtered = useMemo(() => {
    if (!value) return CLASS_OPTIONS;
    const v = value.toLowerCase();
    return CLASS_OPTIONS.filter((o) =>
      o.code.toLowerCase().includes(v) || o.label.toLowerCase().includes(v)
    );
  }, [value]);

  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-4">
        <div className="text-lg font-semibold text-white">Class Spot {idx + 1}</div>
      </div>
      <div className="relative">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          placeholder="Class code"
          className="w-40 p-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/30"
          autoComplete="off"
        />
        {showDropdown && filtered.length > 0 && (
          <ul
            className="absolute z-10 mt-1 w-40 bg-black/90 border border-white/20 rounded-lg overflow-hidden shadow-xl"
            role="listbox"
          >
            {filtered.map((opt) => (
              <li
                key={opt.code}
                className="px-3 py-2 text-sm text-white hover:bg-white/10 cursor-pointer"
                onClick={() => onSelect(opt.code)}
                data-option={`${opt.code}`}
              >
                <div className="font-medium">{opt.code}</div>
                <div className="text-white/70 text-xs">{opt.label}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

interface GenerateSchedulesAnimationProps {
  onCaptionChange?: (caption: string) => void;
  onComplete?: () => void;
}

const GenerateSchedulesAnimation: React.FC<GenerateSchedulesAnimationProps> = ({ onCaptionChange, onComplete }) => {
  // Two pre-filled; type remaining two
  const [inputs, setInputs] = useState<string[]>(['CSCI 270', 'MATH 225', '', '']);
  const [showDropdown, setShowDropdown] = useState<boolean[]>([false, false, false, false]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRefs = [
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
  ];

  // PreferencePanel state (mirrors production shape)
  const [preferences, setPreferences] = useState({
    timeOfDay: [] as string[],
    daysOff: [] as string[],
    classLength: 'shorter-frequent',
    avoidLabs: false,
    avoidDiscussions: false,
    excludeFullSections: false,
  });
  const updatePreference = (key: string, value: any) => setPreferences((p) => ({ ...p, [key]: value }));

  // Helpers
  const openDropdown = (index: number) => setShowDropdown((prev) => { const n = [...prev]; n[index] = true; return n; });
  const closeDropdown = (index: number) => setShowDropdown((prev) => { const n = [...prev]; n[index] = false; return n; });
  const selectCode = (index: number, code: string) => {
    setInputs((prev) => { const n = [...prev]; n[index] = code; return n; });
    closeDropdown(index);
  };
  const typeText = (index: number, text: string, charDelay = 0.08) => {
    const tl = gsap.timeline();
    for (let i = 1; i <= text.length; i++) {
      tl.call(() => {
        setInputs((prev) => { const n = [...prev]; n[index] = text.slice(0, i); return n; });
      }, [], `+=${i === 1 ? 0 : charDelay}`);
    }
    return tl;
  };

  useEffect(() => {
    if (!containerRef.current) return;

  const tl = gsap.timeline({ defaults: { ease: 'power1.out' } });

  // Start invisible; parent fades caption separately
  gsap.set(containerRef.current, { autoAlpha: 0, y: 6 });

  // Start: show caption for typing (parent will fade caption)
  tl.call(() => onCaptionChange?.('Generate Top Schedules'));
  // Reveal the UI 1s after caption change
  tl.to(containerRef.current, { autoAlpha: 1, y: 0, duration: 0.6 }, '+=1.0');

    // Focus input 3 and type BISC 120
  tl.call(() => inputRefs[2].current?.focus(), [], '+=0.2');
    tl.add(typeText(2, 'BISC 120', 0.12));
    tl.call(() => openDropdown(2), [], '+=0.1');
    tl.call(() => {
      const el = containerRef.current?.querySelector('[data-option="BISC 120"]') as HTMLElement | null;
      if (el) gsap.fromTo(el, { backgroundColor: 'rgba(255,255,255,0.0)' }, { backgroundColor: 'rgba(255,255,255,0.08)', duration: 0.25, yoyo: true, repeat: 1 });
    }, [], '+=0.2');
    tl.call(() => selectCode(2, 'BISC 120'));

    // Focus input 4 and type BUAD 310
    tl.call(() => inputRefs[3].current?.focus(), [], '+=0.8');
    tl.add(typeText(3, 'BUAD 310', 0.12));
    tl.call(() => openDropdown(3), [], '+=0.1');
    tl.call(() => {
      const el = containerRef.current?.querySelector('[data-option="BUAD 310"]') as HTMLElement | null;
      if (el) gsap.fromTo(el, { backgroundColor: 'rgba(255,255,255,0.0)' }, { backgroundColor: 'rgba(255,255,255,0.08)', duration: 0.25, yoyo: true, repeat: 1 });
    }, [], '+=0.2');
    tl.call(() => selectCode(3, 'BUAD 310'));

  // Switch caption to preferences and showcase toggles
    tl.call(() => onCaptionChange?.('Toggle Preferences to your liking'));
    // Toggle some preferences slower with a bit more breathing room
    tl.call(() => updatePreference('timeOfDay', ['morning', 'afternoon']));
    tl.call(() => updatePreference('daysOff', ['Friday']), [], '+=0.4');
    tl.call(() => updatePreference('avoidLabs', true), [], '+=0.4');
    tl.call(() => updatePreference('excludeFullSections', true), [], '+=0.4');
    tl.fromTo(
      '[data-anim="pref-panel"]',
      { scale: 0.992, filter: 'brightness(0.95)' },
      { scale: 1, filter: 'brightness(1)', duration: 0.6, ease: 'power2.out' },
      '<'
    );

    // Hold on this state twice as long
    tl.to({}, { duration: 2.4 });

    // Now press the Generate button visually to proceed
    tl.call(() => {
      const btn = containerRef.current?.querySelector('[data-anim="gen-btn"] button') as HTMLElement | null;
      if (btn) gsap.fromTo(btn, { scale: 1 }, { scale: 0.96, duration: 0.1, yoyo: true, repeat: 1 });
    });

  // Fade this stage out; clear caption 0.3s before fade completes
  tl.to(containerRef.current, { autoAlpha: 0, duration: 0.6, ease: 'power2.out' });
  tl.call(() => onCaptionChange?.(''), [], '-=0.3');
    tl.call(() => onComplete?.());

    return () => { tl.kill(); };
  }, []);

  return (
    <div ref={containerRef} className="w-full">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        {/* Left: Preferences */}
        <div className="md:col-span-1" data-anim="pref-panel">
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <PreferencePanel preferences={preferences} updatePreference={updatePreference} />
          </div>
        </div>

        {/* Right: Class spots + Generate button (span 2 columns on md) */}
        <div className="md:col-span-2 md:ml-6">
          <div className="flex flex-col">
            <ClassSpotInput
              idx={0}
              value={inputs[0]}
              onChange={(v) => {
                setInputs((prev) => [v, prev[1], prev[2], prev[3]]);
                setShowDropdown((prev) => [true, prev[1], prev[2], prev[3]]);
              }}
              onSelect={(code) => selectCode(0, code)}
              inputRef={inputRefs[0]}
              showDropdown={showDropdown[0]}
            />
            <ClassSpotInput
              idx={1}
              value={inputs[1]}
              onChange={(v) => {
                setInputs((prev) => [prev[0], v, prev[2], prev[3]]);
                setShowDropdown((prev) => [prev[0], true, prev[2], prev[3]]);
              }}
              onSelect={(code) => selectCode(1, code)}
              inputRef={inputRefs[1]}
              showDropdown={showDropdown[1]}
            />
            <ClassSpotInput
              idx={2}
              value={inputs[2]}
              onChange={(v) => {
                setInputs((prev) => [prev[0], prev[1], v, prev[3]]);
                setShowDropdown((prev) => [prev[0], prev[1], true, prev[3]]);
              }}
              onSelect={(code) => selectCode(2, code)}
              inputRef={inputRefs[2]}
              showDropdown={showDropdown[2]}
            />
            <ClassSpotInput
              idx={3}
              value={inputs[3]}
              onChange={(v) => {
                setInputs((prev) => [prev[0], prev[1], prev[2], v]);
                setShowDropdown((prev) => [prev[0], prev[1], prev[2], true]);
              }}
              onSelect={(code) => selectCode(3, code)}
              inputRef={inputRefs[3]}
              showDropdown={showDropdown[3]}
            />

            <div className="mt-2" data-anim="gen-btn">
              <button
                className="w-56 h-10 bg-usc-red hover:bg-red-800 text-white font-semibold rounded-lg flex items-center justify-center shadow"
                onClick={(e) => e.preventDefault()}
              >
                Generate Schedules
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GenerateSchedulesAnimation;
