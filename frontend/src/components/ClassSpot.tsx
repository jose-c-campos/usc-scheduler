import { useState, useEffect, useRef } from 'react';
import { FaPlus, FaTimes } from 'react-icons/fa';
import axios from 'axios';

/* fallback mocks – unchanged */
const MOCK_SECTIONS = { /* … */ };

export interface ClassSectionSelection {
  classCode: string;
  selectedSections: {
    lecture?: string;
    lab?: string;
    discussion?: string;
    quiz?: string;
  };
}

interface ClassSpotProps {
  index:    number;
  classes:  ClassSectionSelection[];
  onUpdate: (classes: ClassSectionSelection[]) => void;
  onRemove: () => void;
}

const sectionLabel: Record<string,string> = {
  lecture: 'Lecture', lab: 'Lab', discussion: 'Discussion', quiz: 'Quiz'
};

const ClassSpot = ({ index, classes, onUpdate, onRemove }: ClassSpotProps) => {
  const [availableClasses, setAvailableClasses] = useState<string[]>([]);
  const [classSections,    setClassSections]    = useState<Record<string, any>>({});
  const [loading,          setLoading]          = useState<Record<string, boolean>>({});
  const [showDropdown,     setShowDropdown]     = useState<Record<number, boolean>>({});
  const [filteredClasses,  setFilteredClasses]  = useState<string[]>([]);
  const [inputFocused,     setInputFocused]     = useState<Record<number, boolean>>({});
  const inputRefs = useRef<Record<number, HTMLInputElement|null>>({});

  /* ─── fetch class list once ─── */
  useEffect(() => {
    axios.get('http://localhost:3001/api/available-classes')
      .then(r => setAvailableClasses(r.data.classes || []))
      .catch(err => {
        console.error('Error fetching class list:', err);
        setAvailableClasses(Object.keys(MOCK_SECTIONS));
      });
  }, []);

  /* ─── fetch sections when a class is chosen ─── */
  useEffect(() => {
    classes.forEach(cls => {
      if (!cls.classCode || classSections[cls.classCode] || loading[cls.classCode]) return;

      setLoading(prev => ({ ...prev, [cls.classCode]: true }));
      axios.get(`http://localhost:3001/api/class-sections/${encodeURIComponent(cls.classCode)}`)
        .then(r => setClassSections(prev => ({ ...prev, [cls.classCode]: r.data })))
        .catch(err => {
          console.error(`Error fetching sections for ${cls.classCode}:`, err);
          if (MOCK_SECTIONS[cls.classCode]) {
            setClassSections(prev => ({ ...prev, [cls.classCode]: MOCK_SECTIONS[cls.classCode] }));
          }
        })
        .finally(() => setLoading(prev => ({ ...prev, [cls.classCode]: false })));
    });
  }, [classes, classSections, loading]);

  /* ─── type‑ahead dropdown logic ─── */
  useEffect(() => {
    classes.forEach((cls, idx) => {
      // Only filter and show dropdown if input is focused
      if (!inputFocused[idx]) {
        return;
      }
      
      const query = cls.classCode.toUpperCase();
      if (!query) {
        setShowDropdown(prev => ({ ...prev, [idx]: false }));
        return;
      }

      const matches = availableClasses
        .filter(c => c.includes(query))
        .slice(0, 8);                               // max 8 options

      setFilteredClasses(matches);
      setShowDropdown(prev => ({ ...prev, [idx]: matches.length > 0 }));
    });
  }, [classes, availableClasses, inputFocused]);

  /* reset dropdown visibility when class count changes */
  useEffect(() => {
    const init: Record<number,boolean> = {};
    classes.forEach((_, idx) => { init[idx] = false; });
    setShowDropdown(init);
    setInputFocused(init); // Also reset focused state
  }, [classes.length]);

  /* helpers -------------------------------------------------- */
  const addClassInput    = () =>
    onUpdate([...classes, { classCode: '', selectedSections: {} }]);

  const removeClassInput = (idx: number) =>
    onUpdate(classes.filter((_, i) => i !== idx));

  const updateClassCode  = (idx: number, code: string) => {
    const updated        = [...classes];
    updated[idx]         = { classCode: code, selectedSections: {} };
    onUpdate(updated);
  };

  const updateSection    = (idx: number, type: string, sectionId: string) => {
    const updated   = [...classes];
    updated[idx]    = {
      ...updated[idx],
      selectedSections: { ...updated[idx].selectedSections, [type]: sectionId }
    };
    onUpdate(updated);
  };

  const handleInputChange = (idx: number, val: string) => {
    updateClassCode(idx, val.toUpperCase());

    // Only filter and update if input is focused
    if (inputFocused[idx]) {
      const matches = availableClasses
        .filter(c => c.includes(val.toUpperCase()))
        .slice(0, 8);

      setFilteredClasses(matches);
      setShowDropdown(prev => ({ ...prev, [idx]: matches.length > 0 }));
    }
  };

  /* ---------------------------------------------------------- */
  if (!Array.isArray(classes) || !classes.length) return null;

  return (
    <div className="mb-2">
      {/* header / remove spot */}
      <div className="flex justify-between items-center mb-4">
        <div className="text-lg font-semibold">Class Spot {index + 1}</div>
        {index > 0 && (
          <button
            className="text-white/80 hover:text-white"
            onClick={onRemove}
          >
            Remove Spot
          </button>
        )}
      </div>

      {/* each class input row */}
      {classes.map((cls, idx) => (
        <div key={idx} className="flex items-center gap-2 mb-4">
          {/* class‑code input + dropdown */}
          <div className="relative">
            <input
              ref={el => (inputRefs.current[idx] = el)}
              type="text"
              value={cls.classCode}
              onChange={e => handleInputChange(idx, e.target.value)}
              onFocus={() => {
                setInputFocused(prev => ({ ...prev, [idx]: true }));
                /* reopen dropdown if we still have matches */
                const q = cls.classCode.toUpperCase();
                const matches = availableClasses.filter(c => c.includes(q)).slice(0,8);
                setFilteredClasses(matches);
                setShowDropdown(prev => ({ ...prev, [idx]: matches.length > 0 }));
              }}
              onBlur={() => {
                setTimeout(() => {
                  setInputFocused(prev => ({ ...prev, [idx]: false }));
                  setShowDropdown(prev => ({ ...prev, [idx]: false }));
                }, 200);
              }}
              placeholder="Class code"
              className="w-40 p-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/30"
              autoComplete="off"
            />

            {showDropdown[idx] && filteredClasses.length > 0 && inputFocused[idx] && (
              <div className="absolute z-50 left-0 top-full mt-1 w-60 max-h-60 overflow-y-auto bg-gray-800 border border-white/20 rounded-lg shadow-lg">
                {filteredClasses.map(opt => (
                  <div
                    key={opt}
                    className="p-2 hover:bg-white/10 cursor-pointer text-white text-sm"
                    onMouseDown={() => {
                      updateClassCode(idx, opt);
                      setShowDropdown(prev => ({ ...prev, [idx]: false }));
                    }}
                  >
                    {opt}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* section selectors */}
          {loading[cls.classCode] ? (
            <div className="text-white/60 text-sm">Loading sections…</div>
          ) : (
            classSections[cls.classCode] &&
            Object.entries(classSections[cls.classCode]).map(([type, secs]) => (
              <select
                key={type}
                value={cls.selectedSections[type as keyof typeof cls.selectedSections] || ''}
                onChange={e => updateSection(idx, type, e.target.value)}
                className="w-56 p-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm"
              >
                <option value="">
                  Select {sectionLabel[type] ?? type} (optional)
                </option>
                {(secs as any[]).map(sec => (
                  <option key={sec.id} value={sec.id}>
                    {`${sec.professor}, ${sec.days}, ${sec.time}, ${sec.seats} seats`}
                  </option>
                ))}
              </select>
            ))
          )}

          {/* remove class input */}
          {(cls.classCode || classes.length > 1) && (
            <button
              className="ml-1 text-white/60 hover:text-white"
              onClick={() =>
                classes.length === 1
                  ? onUpdate([{ classCode: '', selectedSections: {} }])
                  : removeClassInput(idx)
              }
            >
              <FaTimes />
            </button>
          )}
        </div>
      ))}

      {/* + Add another class */}
      <div className="mt-1 mb-8">
        {classes.length > 0 && (
          <button
            className="flex items-center text-white/60 hover:text-white text-xs"
            onClick={addClassInput}
          >
            <FaPlus className="mr-1" /> Add another class
          </button>
        )}
      </div>
    </div>
  );
};

export default ClassSpot;
