import { useState, useEffect, useRef } from 'react';
import { FaPlus, FaTimes } from 'react-icons/fa';
import api from '../services/api';

/* fallback mocks – unchanged */
const MOCK_SECTIONS: Record<string, any> = { /* … */ };

// Make sure the export is explicitly declared
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
  onSectionsLoaded?: (sections: Record<string, any>) => void; // New prop for reporting sections
}

const sectionLabel: Record<string,string> = {
  lecture: 'Lecture', lab: 'Lab', discussion: 'Discussion', quiz: 'Quiz'
};

const ClassSpot = ({ index, classes, onUpdate, onRemove, onSectionsLoaded }: ClassSpotProps) => {
  const [availableClasses, setAvailableClasses] = useState<string[]>([]);
  const [classSections,    setClassSections]    = useState<Record<string, any>>({});
  const [loading,          setLoading]          = useState<Record<string, boolean>>({});
  const [showDropdown,     setShowDropdown]     = useState<Record<number, boolean>>({});
  const [filteredClasses,  setFilteredClasses]  = useState<string[]>([]);
  const [inputFocused,     setInputFocused]     = useState<Record<number, boolean>>({});
  const inputRefs = useRef<Record<number, HTMLInputElement|null>>({});

  /* ─── fetch class list once ─── */
  useEffect(() => {
    api.get('/api/available-classes')
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
      api.get(`/api/class-sections/${encodeURIComponent(cls.classCode)}`)
        .then(r => {
          // Process the data to ensure lecture sections are properly accessible
          let processedData = r.data;
          
          // If lectures are stored in a 'sections' array, restructure for consistency
          if (r.data.sections && Array.isArray(r.data.sections) && !r.data.lecture) {
            processedData = {
              ...r.data,
              lecture: r.data.sections // Add lecture sections under the key expected by the schedule preview
            };
          }
          
          const newSections = { [cls.classCode]: processedData };
          setClassSections(prev => ({ ...prev, ...newSections }));
          
          // Report sections to parent component if callback exists
          if (onSectionsLoaded) {
            onSectionsLoaded(newSections);
          }
        })
        .catch(err => {
          console.error(`Error fetching sections for ${cls.classCode}:`, err);
          if (MOCK_SECTIONS[cls.classCode]) {
            // Add lecture sections under the expected key
            const mockData = { 
              [cls.classCode]: {
                ...MOCK_SECTIONS[cls.classCode],
                // If lecture key doesn't exist but sections does, copy it
                ...(MOCK_SECTIONS[cls.classCode].sections && !MOCK_SECTIONS[cls.classCode].lecture 
                    ? { lecture: MOCK_SECTIONS[cls.classCode].sections } 
                    : {})
              } 
            };
            
            setClassSections(prev => ({ ...prev, ...mockData }));
            
            // Report mock sections to parent component if callback exists
            if (onSectionsLoaded) {
              onSectionsLoaded(mockData);
            }
          }
        })
        .finally(() => setLoading(prev => ({ ...prev, [cls.classCode]: false })));
    });
  }, [classes, classSections, loading, onSectionsLoaded]);

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
      setShowDropdown(prev => ({ ...prev, [idx]: matches.length > 0 && inputFocused[idx] }));
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
              ref={(el) => { inputRefs.current[idx] = el; }}
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
                
                // Force dropdown to show even if there are no matches initially
                if (!matches.length && q === '') {
                  const allMatches = availableClasses.slice(0, 8);
                  setFilteredClasses(allMatches);
                  setShowDropdown(prev => ({ ...prev, [idx]: allMatches.length > 0 }));
                }
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

            {showDropdown[idx] && filteredClasses.length > 0 && (
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
            Object.entries(classSections[cls.classCode]).map(([type, secs]) => {
              // Sort sections by professor last name, then by day, then by time
              const sortedSections = [...(secs as any[])].sort((a, b) => {
                // Get last names
                const getLastName = (professor: string) => {
                  if (!professor || professor === 'TBA') return 'zzzz'; // Put TBA at the end
                  return professor.split(' ').pop() || '';
                };
                
                const aLastName = getLastName(a.professor);
                const bLastName = getLastName(b.professor);
                
                // Primary sort: Professor's last name
                if (aLastName !== bLastName) return aLastName.localeCompare(bLastName);
                
                // If professor is the same or both TBA, sort by day then time
                if (a.days !== b.days) return a.days.localeCompare(b.days);
                return a.time.localeCompare(b.time);
              });
              
              // Helper to format professor name with abbreviated first name
              const formatProfName = (name: string) => {
                if (!name || name === 'TBA') return name;
                const parts = name.split(' ');
                if (parts.length === 1) return name;
                return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
              };
              
              // Helper to format days abbreviation
              const formatDays = (days: string) => {
                if (!days || days === 'TBA') return days;
                
                // Replace common day patterns
                let formatted = days;
                formatted = formatted.replace(/Monday/gi, 'M');
                formatted = formatted.replace(/Tuesday/gi, 'T');
                formatted = formatted.replace(/Wednesday/gi, 'W');
                formatted = formatted.replace(/Thursday/gi, 'Th');
                formatted = formatted.replace(/Friday/gi, 'F');
                
                // Also handle short forms
                formatted = formatted.replace(/Mon/gi, 'M');
                formatted = formatted.replace(/Tue/gi, 'T');
                formatted = formatted.replace(/Wed/gi, 'W');
                formatted = formatted.replace(/Thu/gi, 'Th');
                formatted = formatted.replace(/Fri/gi, 'F');
                
                return formatted;
              };
              
              // Helper to check if section is full
              const isSectionFull = (section: any) => {
                if (!section.seats) return false;
                
                const parts = section.seats.split('/');
                if (parts.length !== 2) return false;
                
                const registered = parseInt(parts[0], 10);
                const total = parseInt(parts[1], 10);
                
                return registered >= total;
              };
              
              return (
                <select
                  key={type}
                  value={cls.selectedSections[type as keyof typeof cls.selectedSections] || ''}
                  onChange={e => updateSection(idx, type, e.target.value)}
                  className="w-56 p-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm"
                >
                  <option value="">
                    Select {sectionLabel[type] ?? type} (optional)
                  </option>
                  {sortedSections.map(sec => {
                    const fullSection = isSectionFull(sec);
                    
                    return (
                      <option key={sec.id} value={sec.id}>
                        {`${formatProfName(sec.professor)}, ${formatDays(sec.days)}, ${sec.time}, `}
                        {fullSection ? `${sec.seats} seats (FULL)` : `${sec.seats} seats`}
                      </option>
                    );
                  })}
                </select>
              );
            })
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

  {/* + Add alternative class */}
      <div className="mt-1 mb-8">
        {classes.length > 0 && (
          <button
            className="flex items-center text-white/60 hover:text-white text-xs"
            onClick={addClassInput}
          >
            <FaPlus className="mr-1" /> Add alternative class (substitute)
          </button>
        )}
      </div>
    </div>
  );
};

export default ClassSpot;
