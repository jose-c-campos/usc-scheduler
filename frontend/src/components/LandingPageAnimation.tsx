import React, { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import ScheduleFrame from './ScheduleFrame';

// Step 1: Focused animation only
// - Two class spots on the left (type + select)
// - Schedule frame on the right updates live as selections happen

type DayCode = 'M' | 'Tu' | 'W' | 'Th' | 'F';

// Local shape only for our mock library
interface AnimScheduleBlock {
  id: string;
  code: string;
  title?: string;
  days: DayCode[];
  startTime: string; // e.g. "10:00 AM"
  endTime: string;   // e.g. "11:50 AM"
  color: string;
  seats_registered?: number;
  seats_total?: number;
}

interface ClassOption {
  code: string;
  label: string;
}

// (times are handled by the real ScheduleFrame)

// Mock catalog for this step
const CLASS_OPTIONS: ClassOption[] = [
  { code: 'CSCI 270', label: 'CSCI 270 – Introduction to Algorithms' },
  { code: 'MATH 225', label: 'MATH 225 – Linear Algebra and Differential Equations' },
  { code: 'BISC 120', label: 'BISC 120 – General Biology: Organismal Biology and Evolution' },
  { code: 'BUAD 310', label: 'BUAD 310 – Applied Business Statistics' },
];

// Mock schedule blocks per code (kept tiny for the demo)
const SCHEDULE_LIBRARY: Record<string, AnimScheduleBlock[]> = {
  'CSCI 270': [
    {
      id: 'csci270-1',
      code: 'CSCI 270',
      title: 'Introduction to Algorithms',
      days: ['M', 'W'],
      startTime: '10:00 AM',
      endTime: '11:50 AM',
      color: 'rgba(239, 68, 68, 0.85)',
      seats_registered: 18,
      seats_total: 30,
    },
  ],
  'MATH 225': [
    {
      id: 'math225-1',
      code: 'MATH 225',
      title: 'Linear Algebra',
      days: ['Tu', 'Th'],
      startTime: '2:00 PM',
      endTime: '3:20 PM',
      color: 'rgba(59, 130, 246, 0.85)',
      seats_registered: 27,
      seats_total: 35,
    },
  ],
  'BISC 120': [
    {
      id: 'bisc120-1',
      code: 'BISC 120',
      title: 'General Biology',
      days: ['M', 'W', 'F'],
      startTime: '1:00 PM',
      endTime: '1:50 PM',
      color: 'rgba(16, 185, 129, 0.85)',
      seats_registered: 45,
      seats_total: 60,
    },
  ],
  'BUAD 310': [
    {
      id: 'buad310-1',
      code: 'BUAD 310',
      title: 'Applied Business Statistics',
      days: ['Tu', 'Th'],
      startTime: '9:30 AM',
      endTime: '10:50 AM',
      color: 'rgba(234, 179, 8, 0.9)',
      seats_registered: 40,
      seats_total: 40,
    },
  ],
};

/* ────────────────────────── helpers ────────────────────────── */
// no-op helper placeholders retained for future steps

// (unused helper retained for potential future steps)
// const minutesSinceStart = (time: string) => {
//   const { h, m } = to24h(time);
//   return (h - START_HOUR) * 60 + m;
// };

/* using the real ScheduleFrame component for exact styling */

/* ───────────────────────── Class Spot (local) ───────────────────────── */
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
      {/* Match ClassSpot header spacing/size */}
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

/* ───────────────────────── LandingPageAnimation ───────────────────────── */
interface LandingPageAnimationProps {
  onCaptionChange?: (caption: string) => void;
  onComplete?: () => void; // notify parent when this step fully fades out
}

const LandingPageAnimation: React.FC<LandingPageAnimationProps> = ({ onCaptionChange, onComplete }) => {
  // Input values and dropdown visibility
  const [inputs, setInputs] = useState<string[]>(['', '', '', '']);
  const [showDropdown, setShowDropdown] = useState<boolean[]>([false, false, false, false]);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [showSave, setShowSave] = useState<boolean>(false);
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);
  const [modalName, setModalName] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [modalSuccess, setModalSuccess] = useState<boolean>(false);
  // caption managed by parent via onCaptionChange

  // Transform selections into real ScheduleFrame props for exact visuals
  const scheduleFrameInput = useMemo(() => {
    return selectedCodes.map((code) => {
      const blocks = SCHEDULE_LIBRARY[code] || [];
      // Merge multiple day blocks for same lecture into separate sections
      return {
        code,
        sections: blocks.map((b) => ({
          type: 'lecture',
          days: b.days.join(', '),
          time: `${b.startTime}-${b.endTime}`,
          instructor: 'TBA',
          seats_registered: b.seats_registered,
          seats_total: b.seats_total,
        })),
      };
    });
  }, [selectedCodes]);

  // Refs for targeting in animation
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRefs = [
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
  ];
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const blockCountRef = useRef<number>(0);
  const modalInputRef = useRef<HTMLInputElement | null>(null);

  const resetState = () => {
    setInputs(['', '', '', '']);
    setShowDropdown([false, false, false, false]);
    setSelectedCodes([]);
  setShowSave(false);
  setShowSaveModal(false);
  setModalName('');
  setIsSaving(false);
  setModalSuccess(false);
    blockCountRef.current = 0;
  onCaptionChange?.('Type a class code and pick a match');
  };

  const typeText = (index: number, text: string, charDelay = 0.06) => {
    const tl = gsap.timeline();
    for (let i = 1; i <= text.length; i++) {
      tl.call(() => {
        setInputs((prev) => {
          const next = [...prev];
          next[index] = text.slice(0, i);
          return next;
        });
      }, [], `+=${i === 1 ? 0 : charDelay}`);
    }
    return tl;
  };

  const openDropdown = (index: number) => {
    setShowDropdown((prev) => {
      const next = [...prev];
      next[index] = true;
      return next;
    });
  };

  const closeDropdown = (index: number) => {
    setShowDropdown((prev) => {
      const next = [...prev];
      next[index] = false;
      return next;
    });
  };

  const selectCode = (index: number, code: string) => {
    // Set input value to selected code, close dropdown, add to schedule
    setInputs((prev) => {
      const next = [...prev];
      next[index] = code;
      return next;
    });
    setSelectedCodes((prev) => {
      const next = prev.includes(code) ? prev : [...prev, code];
      if (next.length >= 4) setShowSave(true);
      return next;
    });
    closeDropdown(index);
  };

  const animateNewBlocks = () => {
    // target last N newly added blocks from real ScheduleFrame
  const nodes = containerRef.current?.querySelectorAll('.rounded-md.text-gray-800');
    if (!nodes) return;
    const prev = blockCountRef.current;
    const total = nodes.length;
    if (total <= prev) return;
    const newNodes = Array.from(nodes).slice(prev);
  // Ensure they start hidden to avoid any flicker, then fade+scale in once
  gsap.set(newNodes, { autoAlpha: 0, scale: 0.98 });
  gsap.to(newNodes, { autoAlpha: 1, scale: 1, duration: 0.45, stagger: 0.06, ease: 'power2.out' });
    blockCountRef.current = total;
  };

  const typeModalName = (text: string, charDelay = 0.08) => {
    const tl = gsap.timeline();
    for (let i = 1; i <= text.length; i++) {
      tl.call(() => setModalName(text.slice(0, i)), [], `+=${i === 1 ? 0 : charDelay}`);
    }
    return tl;
  };

  // Animate Save button when it appears and update caption
  useEffect(() => {
    if (!showSave) return;
    const btn = containerRef.current?.querySelector('[data-anim="save-btn"]') as HTMLElement | null;
    if (btn) {
      gsap.fromTo(btn, { autoAlpha: 0, y: 8, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.35, ease: 'power2.out' });
    }
    onCaptionChange?.('Save your schedule');
  }, [showSave]);

  // Main animation timeline
  useEffect(() => {
    if (!containerRef.current) return;

    // Kill previous timeline on hot-reload/unmount
    tlRef.current?.kill();

    // Ensure fresh state before starting
    resetState();

    const tl = gsap.timeline({
      defaults: { ease: 'power1.out' },
    });

  // Focus input 1
  tl.call(() => inputRefs[0].current?.focus());
  // Type "CSCI 270"
  tl.add(typeText(0, 'CSCI 270', 0.12), '+=0.2');
    // Open dropdown 1
    tl.call(() => openDropdown(0), [], '+=0.1');
    // Briefly highlight the option and select
    tl.call(() => {
      // Optionally pulse the matching item
      const el = containerRef.current?.querySelector('[data-option="CSCI 270"]') as HTMLElement | null;
      if (el) {
        gsap.fromTo(
          el,
          { backgroundColor: 'rgba(255,255,255,0.0)' },
          { backgroundColor: 'rgba(255,255,255,0.08)', duration: 0.25, yoyo: true, repeat: 1 }
        );
      }
    }, [], '+=0.2');
    tl.call(() => selectCode(0, 'CSCI 270'));
    // Fire caption after 1s so the initial caption lingers longer and this one is shorter
    tl.call(() => {
      setTimeout(() => onCaptionChange?.('Your schedule updates in real time'), 1000);
    });
  // Animate newly added schedule blocks (after DOM updates)
  tl.call(() => {
      setTimeout(() => animateNewBlocks(), 0);
    }, [], '+=0.1');

    // Focus input 2
  tl.call(() => inputRefs[1].current?.focus(), [], '+=0.9');
    // Type "MATH 225"
    tl.add(typeText(1, 'MATH 225', 0.12));
    // Open dropdown 2 and select
    tl.call(() => openDropdown(1), [], '+=0.1');
    tl.call(() => {
      const el = containerRef.current?.querySelector('[data-option="MATH 225"]') as HTMLElement | null;
      if (el) {
        gsap.fromTo(
          el,
          { backgroundColor: 'rgba(255,255,255,0.0)' },
          { backgroundColor: 'rgba(255,255,255,0.08)', duration: 0.25, yoyo: true, repeat: 1 }
        );
      }
    }, [], '+=0.2');
  tl.call(() => selectCode(1, 'MATH 225'));
  tl.call(() => {
      setTimeout(() => animateNewBlocks(), 0);
    }, [], '+=0.1');

    // Focus input 3
    tl.call(() => inputRefs[2].current?.focus(), [], '+=0.9');
    // Type "BISC 120"
    tl.add(typeText(2, 'BISC 120', 0.12));
    tl.call(() => openDropdown(2), [], '+=0.1');
    tl.call(() => {
      const el = containerRef.current?.querySelector('[data-option="BISC 120"]') as HTMLElement | null;
      if (el) {
        gsap.fromTo(
          el,
          { backgroundColor: 'rgba(255,255,255,0.0)' },
          { backgroundColor: 'rgba(255,255,255,0.08)', duration: 0.25, yoyo: true, repeat: 1 }
        );
      }
    }, [], '+=0.2');
    tl.call(() => selectCode(2, 'BISC 120'));
  tl.call(() => {
      setTimeout(() => animateNewBlocks(), 0);
    }, [], '+=0.1');
    // Show the full-class caption a bit earlier to shorten the previous caption's dwell
    tl.call(() => {
      onCaptionChange?.('Full classes are flagged in red');
    }, [], '+=0.0');

  // Focus input 4 (full class showcase)
  tl.call(() => inputRefs[3].current?.focus(), [], '+=0.9');
    tl.add(typeText(3, 'BUAD 310', 0.12));
    tl.call(() => openDropdown(3), [], '+=0.1');
    tl.call(() => {
      const el = containerRef.current?.querySelector('[data-option="BUAD 310"]') as HTMLElement | null;
      if (el) {
        gsap.fromTo(
          el,
          { backgroundColor: 'rgba(255,255,255,0.0)' },
          { backgroundColor: 'rgba(255,255,255,0.08)', duration: 0.25, yoyo: true, repeat: 1 }
        );
      }
    }, [], '+=0.2');
    tl.call(() => selectCode(3, 'BUAD 310'));
    tl.call(() => {
      setTimeout(() => animateNewBlocks(), 0);
    }, [], '+=0.1');

  // After Save button appears, wait ~1.5s so users can read the caption
  tl.to({}, { duration: 1.5 });
    tl.call(() => {
      const btn = containerRef.current?.querySelector('[data-anim="save-btn"] button') as HTMLElement | null;
      if (btn) {
        gsap.fromTo(btn, { scale: 1 }, { scale: 0.96, duration: 0.08, yoyo: true, repeat: 1 });
      }
  setShowSaveModal(true);
    });

    // Animate modal appearing
    tl.call(() => {
      const modal = document.querySelector('[data-anim="save-modal"]') as HTMLElement | null;
      if (modal) gsap.fromTo(modal, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 });
  // focus the input for realism
  setTimeout(() => modalInputRef.current?.focus(), 50);
    }, [], '+=0.05');

    // Type the name into the modal input
    tl.add(typeModalName('Fall 2025', 0.1), '+=0.1');

    // Click Save in the modal
    tl.call(() => {
      const btn = document.querySelector('[data-anim="save-confirm"]') as HTMLElement | null;
      if (btn) {
        gsap.fromTo(btn, { scale: 1 }, { scale: 0.96, duration: 0.08, yoyo: true, repeat: 1 });
      }
      setIsSaving(true);
    }, [], '+=0.1');

  // Show success inside the modal, then fade everything out
    tl.call(() => {
      setTimeout(() => {
        setIsSaving(false);
    setModalSuccess(true);
      }, 500);
    });

  // Keep success message visible briefly inside the modal
  tl.to({}, { duration: 1.5 });

  // Fade out UI and clear caption 0.3s before fade completes to sync disappearance
  tl.to(containerRef.current, { autoAlpha: 0, duration: 0.6, ease: 'power2.out' });
  tl.call(() => onCaptionChange?.(''), [], '-=0.3');

  // Signal completion so parent can start next step
  tl.call(() => onComplete?.());

    tlRef.current = tl;
    return () => {
      tl.kill();
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full">
  <div className="grid grid-cols-1 md:grid-cols-2 gap-px items-start">
        {/* Left: Class spots (styled like real ClassSpot) */}
  <div className="md:ml-12 w-fit">
          <ClassSpotInput
            idx={0}
            value={inputs[0]}
            onChange={(v) => {
              setInputs((prev) => [v, prev[1], prev[2] ?? '', prev[3] ?? '']);
              setShowDropdown((prev) => [true, prev[1], prev[2] ?? false, prev[3] ?? false]);
            }}
            onSelect={(code) => selectCode(0, code)}
            inputRef={inputRefs[0]}
            showDropdown={showDropdown[0]}
          />

          <ClassSpotInput
            idx={1}
            value={inputs[1]}
            onChange={(v) => {
              setInputs((prev) => [prev[0], v, prev[2] ?? '', prev[3] ?? '']);
              setShowDropdown((prev) => [prev[0], true, prev[2] ?? false, prev[3] ?? false]);
            }}
            onSelect={(code) => selectCode(1, code)}
            inputRef={inputRefs[1]}
            showDropdown={showDropdown[1]}
          />

          <ClassSpotInput
            idx={2}
            value={inputs[2]}
            onChange={(v) => {
              setInputs((prev) => [prev[0], prev[1], v, prev[3] ?? '']);
              setShowDropdown((prev) => [prev[0], prev[1], true, prev[3] ?? false]);
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
        </div>

        {/* Right: Live schedule frame (real component) */}
        <div>
          <ScheduleFrame classes={scheduleFrameInput} />
          {showSave && (
      <div className="mt-4 flex" data-anim="save-btn">
              <button
                className="w-56 h-10 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold rounded-lg flex items-center justify-center shadow"
                onClick={(e) => e.preventDefault()}
              >
                Save Schedule
              </button>
            </div>
          )}
        </div>
        {/* Save Schedule Modal (styled to match existing) */}
        {showSaveModal && (
          <div className="fixed inset-0 flex items-center justify-center z-50 -translate-y-8 md:-translate-y-12" data-anim="save-modal">
            <div className="bg-gray-900 p-6 rounded-lg w-full max-w-md">
              <h2 className="text-xl font-bold text-white mb-4">Save Schedule</h2>
              {!modalSuccess ? (
                <>
                  <div className="mb-4">
                    <label htmlFor="schedule-name" className="block text-white mb-2">
                      Schedule Name
                    </label>
                    <input
                      ref={modalInputRef}
                      type="text"
                      id="schedule-name"
                      value={modalName}
                      onChange={(e) => setModalName(e.target.value)}
                      placeholder="My Fall 2025 Schedule"
                      className="w-full p-3 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-usc-red"
                    />
                  </div>
                  <div className="flex justify-end space-x-3">
                    <button
                      className="px-4 py-2 border border-white/30 text-white rounded-lg hover:border-white/50"
                      disabled={isSaving}
                      onClick={() => setShowSaveModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      data-anim="save-confirm"
                      className="px-4 py-2 bg-usc-red text-white rounded-lg hover:bg-red-800 disabled:opacity-50"
                      disabled={!modalName.trim() || isSaving}
                      onClick={() => {
                        if (!modalName.trim()) return;
                        setIsSaving(true);
                      }}
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-2 p-3 bg-green-800/30 border border-green-600 text-white rounded-lg text-center">
                  Schedule saved successfully!
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LandingPageAnimation;
