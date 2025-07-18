import { useState, useEffect, useRef } from 'react';
import { FaPlus, FaTimes } from 'react-icons/fa';
import axios from 'axios';

/* fallback mocks – unchanged */
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
  }, [classes, availableClasses]);

  /* reset dropdown visibility when class count changes */
  useEffect(() => {
    const init: Record<number,boolean> = {};
    classes.forEach((_, idx) => { init[idx] = false; });
    setShowDropdown(init);
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

    const matches = availableClasses
      .filter(c => c.includes(val.toUpperCase()))
      .slice(0, 8);

    setFilteredClasses(matches);
    setShowDropdown(prev => ({ ...prev, [idx]: matches.length > 0 }));
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
                /* reopen dropdown if we still have matches */
                const q = cls.classCode.toUpperCase();
                const matches = availableClasses.filter(c => c.includes(q)).slice(0,8);
                setFilteredClasses(matches);
                setShowDropdown(prev => ({ ...prev, [idx]: matches.length > 0 }));
              }}
              onBlur={() => setTimeout(
                () => setShowDropdown(prev => ({ ...prev, [idx]: false })), 200
              )}
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


// import { useState, useEffect, useRef } from "react";
// import { FaPlus, FaTimes } from "react-icons/fa";
// import axios from "axios";

// // Keep MOCK_SECTIONS as fallback
// const MOCK_SECTIONS = {
//   "CSCI 170": {
//     lecture: [
//       { id: "12345", professor: "Cote", days: "MWF", time: "2:00pm - 3:00pm", seats: "11/14" },
//       { id: "12346", professor: "Smith", days: "TR", time: "10:00am - 11:20am", seats: "5/14" }
//     ],
//     lab: [
//       { id: "22345", professor: "TA Lee", days: "F", time: "3:00pm - 4:00pm", seats: "8/10" }
//     ]
//   },
//   "MATH 126": {
//     lecture: [
//       { id: "54321", professor: "Warner", days: "MWF", time: "9:00am - 9:50am", seats: "20/25" }
//     ],
//     discussion: [
//       { id: "64321", professor: "TA Kim", days: "T", time: "1:00pm - 1:50pm", seats: "12/15" }
//     ]
//   }
// };

// export interface ClassSectionSelection {
//   classCode: string;
//   selectedSections: {
//     lecture?: string;
//     lab?: string;
//     discussion?: string;
//   };
// }

// interface ClassSpotProps {
//   index: number;
//   classes: ClassSectionSelection[];
//   onUpdate: (classes: ClassSectionSelection[]) => void;
//   onRemove: () => void;
// }

// const sectionLabel = {
//   lecture: "Lecture",
//   lab: "Lab",
//   discussion: "Discussion",
//   quiz: "Quiz"
// };

// const ClassSpot = ({ index, classes, onUpdate, onRemove }: ClassSpotProps) => {
//   const [availableClasses, setAvailableClasses] = useState<string[]>([]);
//   const [classSections, setClassSections] = useState<Record<string, any>>({});
//   const [loading, setLoading] = useState<Record<string, boolean>>({});
//   const [showDropdown, setShowDropdown] = useState<{[key: number]: boolean}>({});
//   const [filteredClasses, setFilteredClasses] = useState<string[]>([]);
//   const inputRefs = useRef<{[key: number]: HTMLInputElement | null}>({});

//   // Fetch available classes on component mount
//   useEffect(() => {
//     axios.get('http://localhost:3001/api/available-classes')
//       .then(response => {
//         setAvailableClasses(response.data.classes || []);
//       })
//       .catch(error => {
//         console.error('Error fetching class list:', error);
//         // Fallback to mock data
//         setAvailableClasses(Object.keys(MOCK_SECTIONS));
//       });
//   }, []);

//   // Fetch sections when a class is selected
//   useEffect(() => {
//     classes.forEach(cls => {
//       if (cls.classCode && !classSections[cls.classCode] && !loading[cls.classCode]) {
//         setLoading(prev => ({ ...prev, [cls.classCode]: true }));
        
//         axios.get(`http://localhost:3001/api/class-sections/${encodeURIComponent(cls.classCode)}`)
//           .then(response => {
//             setClassSections(prev => ({
//               ...prev,
//               [cls.classCode]: response.data
//             }));
//           })
//           .catch(error => {
//             console.error(`Error fetching sections for ${cls.classCode}:`, error);
//             // Fallback to mock data if available
//             if (MOCK_SECTIONS[cls.classCode]) {
//               setClassSections(prev => ({
//                 ...prev,
//                 [cls.classCode]: MOCK_SECTIONS[cls.classCode]
//               }));
//             }
//           })
//           .finally(() => {
//             setLoading(prev => ({ ...prev, [cls.classCode]: false }));
//           });
//       }
//     });
//   }, [classes]);

//   // Filtered classes dropdown logic
//   useEffect(() => {
//     classes.forEach(cls => {
//       if (cls.classCode) {
//         const matchingClasses = availableClasses.filter(ac => 
//           ac.toLowerCase().includes(cls.classCode.toLowerCase())
//         );
        
//         // Only show dropdown when we have 10 or fewer matches
//         if (matchingClasses.length <= 10 && matchingClasses.length > 0) {
//           setFilteredClasses(matchingClasses);
//           setShowDropdown(prev => ({ ...prev, [idx]: true }));
//         } else {
//           setShowDropdown(prev => ({ ...prev, [cls.classCode]: false }));
//         }
//       } else {
//         setShowDropdown(prev => ({ ...prev, [cls.classCode]: false }));
//       }
//     });
//   }, [classes, availableClasses]);

//   // Reset function to clear dropdowns when starting over
//   useEffect(() => {
//     // This will run when classes array changes (like after a reset)
//     const newShowDropdown = {};
//     classes.forEach((_, idx) => {
//       newShowDropdown[idx] = false;
//     });
//     setShowDropdown(newShowDropdown);
//   }, [classes.length]); // Only reset when number of classes changes

//   // Add a new class input
//   const addClassInput = () => {
//     onUpdate([...classes, { classCode: "", selectedSections: {} }]);
//   };

//   // Remove a class input
//   const removeClassInput = (idx: number) => {
//     if (classes.length === 1) return; // Prevent removing the last input
//     onUpdate(classes.filter((_, i) => i !== idx));
//   };

//   // Update class code for a specific input
//   const updateClassCode = (idx: number, code: string) => {
//     const updated = [...classes];
//     updated[idx] = { classCode: code, selectedSections: {} };
//     onUpdate(updated);
//   };

//   // Update section selection for a specific input
//   const updateSection = (idx: number, type: string, sectionId: string) => {
//     const updated = [...classes];
//     updated[idx] = {
//       ...updated[idx],
//       selectedSections: {
//         ...updated[idx].selectedSections,
//         [type]: sectionId
//       }
//     };
//     onUpdate(updated);
//   };

//   // Function to handle input changes
//   const handleInputChange = (idx: number, value: string) => {
//     updateClassCode(idx, value.toUpperCase());
    
//     // Always show dropdown when typing, with max 8 items
//     const matches = availableClasses.filter(ac => 
//       ac.toLowerCase().includes(value.toUpperCase().toLowerCase())
//     ).slice(0, 8); // Limit to 8 items
    
//     setFilteredClasses(matches);
    
//     // Use object to track dropdown visibility per input
//     setShowDropdown(prev => ({
//       ...prev,
//       [idx]: matches.length > 0
//     }));
//   };

//   if (!classes || !Array.isArray(classes)) return null;

//   return (
//     <div className="mb-2">
//       <div className="flex justify-between items-center mb-4">
//         <div className="text-lg font-semibold">Class Spot {index + 1}</div>
//         {index > 0 && (
//           <button
//             className="text-white/80 hover:text-white transition-colors"
//             onClick={onRemove}
//           >
//             Remove Spot
//           </button>
//         )}
//       </div>
//       {classes.map((cls, idx2) => cls && (
//         <div key={idx2} className="flex items-center gap-2 mb-4">
//           {/* Class Code Input */}
//           <div className="relative">
//             <input
//               ref={el => inputRefs.current[idx2] = el}
//               type="text"
//               value={cls.classCode}
//               onChange={e => handleInputChange(idx2, e.target.value)}
//               onFocus={() => {
//                 // Show dropdown on focus if we have matches for what's already typed
//                 if (cls.classCode) {
//                   const matches = availableClasses.filter(ac => 
//                     ac.toLowerCase().includes(cls.classCode.toLowerCase())
//                   ).slice(0, 8);
                  
//                   if (matches.length > 0) {
//                     const newShowDropdown = {...showDropdown};
//                     newShowDropdown[idx2] = true;
//                     setShowDropdown(newShowDropdown);
//                     setFilteredClasses(matches);
//                   }
//                 }
//               }}
//               onBlur={() => {
//                 // Small delay to allow for option selection
//                 setTimeout(() => {
//                   const newShowDropdown = {...showDropdown};
//                   newShowDropdown[idx2] = false;
//                   setShowDropdown(newShowDropdown);
//                 }, 200);
//               }}
//               placeholder="Class code"
//               className="w-40 p-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/30"
//               autoComplete="off"
//             />
            
//             {/* Dropdown positioned below input */}
//             {showDropdown[idx2] && filteredClasses.length > 0 && (
//               <div className="absolute z-50 left-0 top-full mt-1 w-60 max-h-60 overflow-y-auto bg-gray-800 border border-white/20 rounded-lg shadow-lg">
//                 {filteredClasses.map(option => (
//                   <div
//                     key={option}
//                     className="p-2 hover:bg-white/10 cursor-pointer text-white text-sm"
//                     onMouseDown={() => { // Use mouseDown to fire before blur
//                       updateClassCode(idx2, option);
//                       setShowDropdown(prev => ({...prev, [idx2]: false}));
//                     }}
//                   >
//                     {option}
//                   </div>
//                 ))}
//               </div>
//             )}
//           </div>
          
//           {/* Section Dropdowns */}
//           {loading[cls.classCode] ? (
//             <div className="text-white/60 text-sm">Loading sections...</div>
//           ) : (
//             classSections[cls.classCode] &&
//             Object.entries(classSections[cls.classCode]).map(([type, sections]) => (
//               <select
//                 key={type}
//                 value={cls.selectedSections[type as keyof typeof cls.selectedSections] || ""}
//                 onChange={e => updateSection(idx2, type, e.target.value)}
//                 className="w-56 p-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm"
//               >
//                 <option value="">Select {sectionLabel[type as keyof typeof sectionLabel] || type} (optional)</option>
//                 {(sections as any[]).map(section => (
//                   <option key={section.id} value={section.id}>
//                     {`${section.professor}, ${section.days}, ${section.time}, ${section.seats} seats`}
//                   </option>
//                 ))}
//               </select>
//             ))
//           )}
          
//           {/* Remove class input */}
//           {(cls.classCode || classes.length > 1) && (
//             <button
//               className="ml-1 text-white/60 hover:text-white"
//               onClick={() => {
//                 if (classes.length === 1) {
//                   // Clear the fields for the only class input
//                   onUpdate([{ classCode: "", selectedSections: {} }]);
//                 } else {
//                   // Remove this class input
//                   removeClassInput(idx2);
//                 }
//               }}
//               title="Clear or remove class"
//             >
//               <FaTimes />
//             </button>
//           )}
//         </div>
//       ))}
      
//       {/* Add class input (+) button */}
//       <div className="mt-1 mb-8 flex items-center">
//         {classes.length > 0 &&
//           (availableClasses.includes(classes[classes.length - 1].classCode) || 
//            Object.keys(MOCK_SECTIONS).includes(classes[classes.length - 1].classCode)) && (
//             <button
//               className="flex items-center text-white/60 hover:text-white text-xs"
//               onClick={addClassInput}
//             >
//               <FaPlus className="mr-1" /> Add another class
//             </button>
//           )
//         }
//       </div>
//     </div>
//   );
// };

// export default ClassSpot;