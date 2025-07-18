import React, { useState } from 'react';
import ClassSpot, { type ClassSectionSelection } from '../components/ClassSpot';
import PreferencePanel from '../components/PreferencePanel';
import ScheduleFrame from '../components/ScheduleFrame';
import ProfessorFrame from '../components/ProfessorFrame';

/* -------------------------------------------------------------------------- *
 *  Scheduler page – fully self‑contained version
 *  ‑ Handles: class‑spot inputs, preferences, SSE schedule generation stream,
 *             rendering of results + professor cards
 * -------------------------------------------------------------------------- */

type LoadingStage = 'idle' | 'building' | 'scoring' | 'done';

type BuildStats = { total: number; ms: number };

// Helper – used by getProfessorsFromSchedule to smooth multiple sections
const runningAverage = (oldVal: number, newVal: number, n: number) =>
  (oldVal * (n - 1) + newVal) / n;

const Scheduler: React.FC = () => {
  /** ───────── State ───────── */
  const [classSpots, setClassSpots] = useState<
    Array<{ id: number; classes: ClassSectionSelection[] }>
  >([{ id: 1, classes: [{ classCode: '', selectedSections: {} }] }]);

  const [preferences, setPreferences] = useState({
    timeOfDay: [] as string[],
    daysOff: [] as string[],
    classLength: '',
    avoidLabs: false,
    avoidDiscussions: false,
    excludeFullSections: true
  });

  const [schedules, setSchedules]       = useState<any[]>([]);
  const [showResults, setShowResults]   = useState(false);
  const [error, setError]               = useState('');
  const [loadingStage, setLoadingStage] = useState<LoadingStage>('idle');

  // progress‑tracking numbers taken from SSE `log` lines
  const [buildStats, setBuildStats] = useState<BuildStats>({ total: 0, ms: 0 });
  const [scoreMs, setScoreMs]       = useState(0);

  /** ───────── Class‑spot helpers ───────── */
  const addClassSpot = () => {
    const newId = classSpots.length > 0 ? Math.max(...classSpots.map(s => s.id)) + 1 : 1;
    setClassSpots([...classSpots, { id: newId, classes: [{ classCode: '', selectedSections: {} }] }]);
  };

  const updateClassSpot = (id: number, classes: ClassSectionSelection[]) =>
    setClassSpots(spots => spots.map(s => (s.id === id ? { ...s, classes } : s)));

  const removeClassSpot = (id: number) =>
    setClassSpots(spots => spots.filter(s => s.id !== id));

  /** ───────── Preference helpers ───────── */
  const updatePreference = (key: keyof typeof preferences, value: any) =>
    setPreferences(p => ({ ...p, [key]: value }));

  /** ───────── Reset ("Start over") ───────── */
  const reset = () => {
    setSchedules([]);
    setShowResults(false);
    setLoadingStage('idle');
    setError('');
    setBuildStats({ total: 0, ms: 0 });
    setScoreMs(0);
  };

  /** ───────── SSE schedule generator ───────── */
  const generateSchedules = () => {
    // (1) validate – at least one class selected
    const validSpots = classSpots.filter(spot =>
      spot.classes.some(c => c.classCode.trim())
    );
    if (!validSpots.length) {
      setError('Please add at least one class.');
      return;
    }

    setError('');
    setLoadingStage('building');

    // (2) open EventSource – encode payload as a single URL param
    const payload = encodeURIComponent(JSON.stringify({ classSpots: validSpots, preferences }));
    const es = new EventSource(`http://localhost:3001/api/generate-schedules-stream?payload=${payload}`);

    // (3) listen for server log lines
    es.addEventListener('log', e => {
      const line = (e as MessageEvent<string>).data;

      const mBuild = line.match(/after spot .*: (\d+) schedules built \(total build time so far: (\d+)ms/);
      if (mBuild) setBuildStats({ total: +mBuild[1], ms: +mBuild[2] });

      if (line.startsWith('Scoring schedules')) setLoadingStage('scoring');

      const mScore = line.match(/Total scoring time: (\d+)ms/);
      if (mScore) setScoreMs(+mScore[1]);
    });

    // (4) done – JSON payload with schedules
    es.addEventListener('done', e => {
      const data = JSON.parse((e as MessageEvent<string>).data);
      setSchedules(data.schedules);
      setLoadingStage('done');
      setShowResults(true);
      es.close();
    });

    // (5) error – generic fallback
    es.addEventListener('error', () => {
      setError('Scheduler failed – please try again.');
      setLoadingStage('idle');
      es.close();
    });
  };

  /** ───────── Transform backend JSON → professor cards ───────── */
  const getProfessorsFromSchedule = (schedule: any) => {
    const map: Record<string, any> = {};

    schedule.classes.forEach((cls: any) => {
      cls.sections.forEach((sec: any) => {
        const name = sec.instructor?.trim();
        if (!name) return;                         // ignore TBA

        // make sure rating object exists & provide 0 defaults
        const r = {
          quality          : sec.ratings?.quality           ?? 0,
          difficulty       : sec.ratings?.difficulty        ?? 0,
          would_take_again : sec.ratings?.would_take_again  ?? 0,
          course_quality   : sec.ratings?.course_quality    ?? 0,
          course_difficulty: sec.ratings?.course_difficulty ?? 0
        };

        if (!map[name]) {
          map[name] = {
            name,
            classCodes: [cls.code],
            // prefer course‑specific metrics when available (> 0)
            overallRating : r.quality,
            courseRating  : r.course_quality   > 0 ? r.course_quality   : r.quality,
            difficulty    : r.course_difficulty> 0 ? r.course_difficulty: r.difficulty,
            wouldTakeAgain: r.would_take_again,
            _count        : 1                        // internal helper
          };
        } else {
          const p = map[name];
          if (!p.classCodes.includes(cls.code)) p.classCodes.push(cls.code);
          p._count += 1;
          p.overallRating  = runningAverage(p.overallRating,  r.quality,           p._count);
          p.courseRating   = runningAverage(p.courseRating,   r.course_quality>0? r.course_quality: r.quality, p._count);
          p.difficulty     = runningAverage(p.difficulty,     r.course_difficulty>0? r.course_difficulty: r.difficulty, p._count);
          p.wouldTakeAgain = runningAverage(p.wouldTakeAgain, r.would_take_again,   p._count);
        }
      });
    });

    // strip the private _count
    return Object.values(map).map(p => {
      const { _count, ...rest } = p as any;
      return rest;
    });
  };

  /** ───────── JSX ───────── */
  return (
    <div className="w-full py-8 px-4 md:px-6 text-white">
      <div className="flex flex-col md:flex-row gap-1 items-start">
        {/* ╭──────────────── Preferences (hidden once results show) */}
        {!showResults && (
          <div className="w-full md:w-1/4 md:pl-6">
            <h2 className="text-2xl font-semibold mb-6 mt-1">Preferences</h2>
            <PreferencePanel
              preferences={preferences}
              updatePreference={updatePreference}
            />
          </div>
        )}

        {/* ╰──────────────── Main column */}
        <div className={`w-full ${!showResults ? 'md:w-2/3' : 'md:w-full'}`}>
          {/* Overlay while building / scoring */}
          {loadingStage !== 'idle' && !showResults && (
            <div className="flex flex-col items-center justify-center h-80 bg-white/10 rounded-lg p-6">
              <div className="w-16 h-16 border-4 border-white/40 border-t-usc-red rounded-full animate-spin mb-4" />

              {loadingStage === 'building' && (
                <>
                  <p className="text-xl font-semibold">Building all possible schedules…</p>
                  {buildStats.total > 0 && (
                    <p className="text-sm mt-2 text-white/70">
                      {buildStats.total.toLocaleString()} built in {buildStats.ms} ms&nbsp;
                      ({Math.round(buildStats.total / Math.max(buildStats.ms, 1))}/ms)
                    </p>
                  )}
                </>
              )}

              {loadingStage === 'scoring' && (
                <>
                  <p className="text-xl font-semibold">Finding the optimal schedules…</p>
                  {scoreMs > 0 && (
                    <p className="text-sm mt-2 text-white/70">Scored in {scoreMs} ms</p>
                  )}
                </>
              )}
            </div>
          )}
          {/* RESULTS -------------------------------------------------- */}
          {showResults && (
            <>
              {/* header */}
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold">
                  Top {schedules.length} Schedules{' '}
                  <span className="text-white/50 font-normal">
                    (out of {buildStats.total.toLocaleString()}, scored {Math.round(buildStats.total / Math.max(scoreMs, 1)) || 0}/ms)
                  </span>
                </h2>

                <button className="text-white/80 hover:text-white underline" onClick={reset}>
                  Start Over
                </button>
              </div>

              <div className="space-y-8">
                {schedules.map(schedule => (
                  <div key={schedule.id} className="bg-white/10 rounded-lg p-4">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      {/* score */}
                      <div className="lg:col-span-2 flex flex-col items-center">
                        <div className="text-5xl font-bold mb-2">{schedule.score.toFixed(1)}</div>
                        <div className="text-xl mb-4">Score</div>
                      </div>

                      {/* calendar */}
                      <div className="lg:col-span-6">
                        <ScheduleFrame classes={schedule.classes} />
                      </div>

                      {/* professor cards */}
                      <div className="lg:col-span-4">
                        <ProfessorFrame professors={getProfessorsFromSchedule(schedule)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* INPUTS --------------------------------------------------- */}
          {!showResults && loadingStage === 'idle' && (
            <>
              <h2 className="text-2xl font-semibold mb-6 mt-1">Select Your Classes</h2>

              <div className="space-y-2">
                {classSpots.map((spot, idx) => (
                  <ClassSpot
                    key={spot.id}
                    index={idx}
                    classes={spot.classes.length ? spot.classes : [{ classCode: '', selectedSections: {} }]}
                    onUpdate={cls => updateClassSpot(spot.id, cls)}
                    onRemove={() => removeClassSpot(spot.id)}
                  />
                ))}
              </div>

              <div className="mt-10 flex gap-4">
                <button
                  onClick={addClassSpot}
                  className="w-56 h-10 border-2 border-dotted border-white rounded-lg hover:bg-white/10 flex items-center justify-center"
                >
                  <span className="mr-2 text-lg">+</span>Add Class Spot
                </button>
                <button
                  onClick={generateSchedules}
                  disabled={classSpots.some(s => !s.classes.length)}
                  className="w-56 h-10 bg-usc-red rounded-lg hover:bg-red-800 flex items-center justify-center"
                >
                  Generate Schedules
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* generic error banner */}
      {error && (
        <div className="mt-6 bg-red-700/80 p-3 rounded text-center font-medium">{error}</div>
      )}
    </div>
  );
};

export default Scheduler;







// import React, { useState } from 'react';
// import ClassSpot, { type ClassSectionSelection } from '../components/ClassSpot';
// import PreferencePanel   from '../components/PreferencePanel';
// import ScheduleFrame     from '../components/ScheduleFrame';
// import ProfessorFrame    from '../components/ProfessorFrame';
// import api               from '../services/api';

// /* ------------------------------------------------------------------ *
//  *  Scheduler page
//  * ------------------------------------------------------------------ */
// type LoadingStage = 'idle' | 'building' | 'scoring' | 'done';

// const Scheduler: React.FC = () => {
//   /** ───────── state ───────── */
//   const [classSpots, setClassSpots] = useState<
//     Array<{ id: number; classes: ClassSectionSelection[] }>
//   >([{ id: 1, classes: [{ classCode: '', selectedSections: {} }] }]);

//   const [preferences, setPreferences] = useState({
//     timeOfDay: [] as string[],
//     daysOff: []  as string[],
//     classLength: '',
//     avoidLabs: false,
//     avoidDiscussions: false,
//     excludeFullSections: true
//   });

//   const [schedules, setSchedules] = useState<any[]>([]);
//   const [showResults, setShowResults] = useState(false);
//   const [error, setError] = useState('');
//   const [loadingStage, setLoadingStage] = useState<LoadingStage>('idle');

//   // progress numbers
//   const [buildStats, setBuildStats] = useState({ total: 0, ms: 0 });
//   const [scoreMs, setScoreMs]       = useState(0);

//   /** ───────── handlers ───────── */
//   const addClassSpot = () => {
//     const newId =
//       classSpots.length > 0
//         ? Math.max(...classSpots.map(s => s.id)) + 1
//         : 1;
//     setClassSpots([...classSpots, { id: newId, classes: [{ classCode: '', selectedSections: {} }] }]);
//   };

//   const updateClassSpot = (id: number, classes: ClassSectionSelection[]) =>
//     setClassSpots(spots =>
//       spots.map(s => (s.id === id ? { ...s, classes } : s))
//     );

//   const removeClassSpot = (id: number) =>
//     setClassSpots(spots => spots.filter(s => s.id !== id));

//   const updatePreference = (key: string, value: any) =>
//     setPreferences(p => ({ ...p, [key]: value }));

//   const reset = () => {
//     setSchedules([]);
//     setShowResults(false);
//     setLoadingStage('idle');
//     setError('');
//     setBuildStats({ total: 0, ms: 0 });
//     setScoreMs(0);
//   };

//   /** ───────── generate (SSE) ───────── */
//   const generateSchedules = async () => {
//     // ensure at least one class
//     const validSpots = classSpots.filter(spot =>
//       spot.classes.some(c => c.classCode.trim())
//     );
//     if (!validSpots.length) {
//       setError('Please add at least one class.');
//       return;
//     }

//     setLoadingStage('building');

//     const payload = encodeURIComponent(
//       JSON.stringify({ classSpots: validSpots, preferences })
//     );

//     const es = new EventSource(
//       `http://localhost:3001/api/generate-schedules-stream?payload=${payload}`
//     );


//     es.addEventListener('log', e => {
//       const line = (e as MessageEvent<string>).data;

//       // generator progress
//       const mBuild = line.match(
//         /\[Generator] after spot .*: (\d+) schedules built \(total build time so far: (\d+)ms/
//       );
//       if (mBuild) {
//         setBuildStats({ total: +mBuild[1], ms: +mBuild[2] });
//       }

//       if (line.startsWith('Scoring schedules')) {
//         setLoadingStage('scoring');
//       }

//       const mScore = line.match(/Total scoring time: (\d+)ms/);
//       if (mScore) setScoreMs(+mScore[1]);
//     });

//     es.addEventListener('done', e => {
//       const data = JSON.parse(e.data);   // <- safe, this one *is* JSON
//       setSchedules(data.schedules);
//       setLoadingStage('done');
//       setShowResults(true);
//       es.close();
//     });

//     es.addEventListener('error', e => {
//       setError('Scheduler failed – please try again.');
//       setLoadingStage('idle');
//       es.close();
//     });
//   };

//   /** ───────── helpers ───────── */
//   const getProfessorsFromSchedule = (schedule: any) =>
//     schedule.classes
//       .flatMap((cls: any) =>
//         cls.sections
//           .filter((s: any) => s.instructor)
//           .map((s: any) => ({
//             name: s.instructor,
//             classCode: cls.code,
//             ratings: s.ratings
//           }))
//       )
//       .reduce((acc: any[], cur: any) => {
//         const existing = acc.find(p => p.name === cur.name);
//         if (existing) {
//           if (!existing.classCodes.includes(cur.classCode))
//             existing.classCodes.push(cur.classCode);
//           return acc;
//         }
//         const r = cur.ratings ?? {};
//         acc.push({
//           name: cur.name,
//           classCodes: [cur.classCode],
//           overallRating: r.quality ?? 0,
//           difficulty:   r.difficulty ?? 0,
//           wouldTakeAgain: r.would_take_again ?? 0
//         });
//         return acc;
//       }, []);

//   /** ───────── UI ───────── */
//   return (
//     <div className="w-full py-8 px-4 md:px-6 text-white">
//       {/* loading overlay */}
//       {loadingStage !== 'idle' && !showResults && (
//         <div className="flex flex-col items-center justify-center h-80 bg-white/10 rounded-lg p-6">
//           <div className="w-16 h-16 border-4 border-white/40 border-t-usc-red rounded-full animate-spin mb-4" />

//           {loadingStage === 'building' && (
//             <>
//               <p className="text-xl font-semibold">Building all possible schedules…</p>
//               {buildStats.total > 0 && (
//                 <p className="text-sm mt-2 text-white/70">
//                   {buildStats.total.toLocaleString()} built in {buildStats.ms} ms&nbsp;
//                   (
//                   {Math.round(buildStats.total / Math.max(buildStats.ms, 1))}
//                   &nbsp;per ms)
//                 </p>
//               )}
//             </>
//           )}

//           {loadingStage === 'scoring' && (
//             <>
//               <p className="text-xl font-semibold">Finding the optimal schedules…</p>
//               {scoreMs > 0 && (
//                 <p className="text-sm mt-2 text-white/70">
//                   Scored in {scoreMs} ms
//                 </p>
//               )}
//             </>
//           )}
//         </div>
//       )}

//       {/* main content (prefs + results / inputs) */}
//       <div className="flex flex-col md:flex-row gap-1 items-start">
//         {!showResults && (
//           <div className="w-full md:w-1/4 md:pl-6">
//             <h2 className="text-2xl font-semibold mb-6 mt-1">Preferences</h2>
//             <PreferencePanel
//               preferences={preferences}
//               updatePreference={updatePreference}
//             />
//           </div>
//         )}

//         <div className={`w-full ${!showResults ? 'md:w-2/3' : 'md:w-full'}`}>
//           {/* RESULTS ---------------------------------------------------- */}
//           {showResults && (
//             <>
//               <div className="flex justify-between items-center mb-6">
//                 <h2 className="text-xl font-semibold">
//                   Top {schedules.length} Schedules{' '}
//                   <span className="text-white/50 font-normal">
//                     (out of {buildStats.total.toLocaleString()}, scored&nbsp;
//                     {Math.round(
//                       buildStats.total / Math.max(scoreMs, 1)
//                     ) || 0}
//                     /ms)
//                   </span>
//                 </h2>

//                 <button
//                   className="text-white/80 hover:text-white underline"
//                   onClick={reset}
//                 >
//                   Start Over
//                 </button>
//               </div>

//               <div className="space-y-8">
//                 {schedules.map(schedule => (
//                   <div key={schedule.id} className="bg-white/10 rounded-lg p-4">
//                     {/* score / grid / profs (unchanged) */}
//                     <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
//                       <div className="lg:col-span-2 flex flex-col items-center">
//                         <div className="text-5xl font-bold mb-2">
//                           {schedule.score.toFixed(1)}
//                         </div>
//                         <div className="text-xl mb-4">Score</div>
//                       </div>

//                       <div className="lg:col-span-6">
//                         <ScheduleFrame classes={schedule.classes} />
//                       </div>

//                       <div className="lg:col-span-4">
//                         <ProfessorFrame
//                           professors={getProfessorsFromSchedule(schedule)}
//                         />
//                       </div>
//                     </div>
//                   </div>
//                 ))}
//               </div>
//             </>
//           )}

//           {/* INPUTS ----------------------------------------------------- */}
//           {!showResults && loadingStage === 'idle' && (
//             <>
//               <h2 className="text-2xl font-semibold mb-6 mt-1">
//                 Select Your Classes
//               </h2>

//               <div className="space-y-2">
//                 {classSpots.map((spot, idx) => (
//                   <ClassSpot
//                     key={spot.id}
//                     index={idx}
//                     classes={
//                       spot.classes.length
//                         ? spot.classes
//                         : [{ classCode: '', selectedSections: {} }]
//                     }
//                     onUpdate={cls => updateClassSpot(spot.id, cls)}
//                     onRemove={() => removeClassSpot(spot.id)}
//                   />
//                 ))}
//               </div>

//               <div className="mt-10 flex gap-4">
//                 <button
//                   onClick={addClassSpot}
//                   className="w-56 h-10 border-2 border-dotted border-white rounded-lg hover:bg-white/10 flex items-center justify-center"
//                 >
//                   <span className="mr-2 text-lg">+</span>Add Class Spot
//                 </button>
//                 <button
//                   onClick={generateSchedules}
//                   disabled={classSpots.some(s => !s.classes.length)}
//                   className="w-56 h-10 bg-usc-red rounded-lg hover:bg-red-800 flex items-center justify-center"
//                 >
//                   Generate Schedules
//                 </button>
//               </div>
//             </>
//           )}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default Scheduler;


// import { useState, useEffect } from 'react'
// import ClassSpot from '../components/ClassSpot'
// import type { ClassSectionSelection } from '../components/ClassSpot'
// import PreferencePanel from '../components/PreferencePanel'
// import ScheduleFrame from '../components/ScheduleFrame'
// // import SkillBar from '../components/SkillBar'
// import ProfessorFrame from '../components/ProfessorFrame'
// import api from '../services/api';

// type LoadingStage = 'idle' | 'building' | 'scoring' | 'done';

// const Scheduler: React.FC = () => {
//   // State for class spots
//   /** ───────── state ───────── */
//   const [classSpots, setClassSpots] = useState<
//     Array<{ id: number; classes: ClassSectionSelection[] }>
//   >([{ id: 1, classes: [{ classCode: '', selectedSections: {} }] }]);

  
//   // Cache to store
//   const syntheticRatingCache: Record<string, {
//   overall: number, difficulty: number, wouldTakeAgain: number
//   }> = {};

//   // State for preferences
//   const [preferences, setPreferences] = useState({
//     timeOfDay: [],
//     daysOff: [] as string[],
//     classLength: '',
//     avoidLabs: false,
//     avoidDiscussions: false,
//     excludeFullSections: true // Default to true
//   })
  
//   // State for generated schedules
//   const [schedules, setSchedules] = useState<any[]>([])
  
//   // Loading state
//   const [loading, setLoading] = useState(false)
  
//   // State to track if we're in the result view
//   const [showResults, setShowResults] = useState(false)
  
//   // Error state
//   const [error, setError] = useState("");
  
//   // Active schedule index for navigation
//   const [activeScheduleIndex, setActiveScheduleIndex] = useState(0);
//   const [loadingStage, setLoadingStage] = useState<LoadingStage>('idle');
//   const [buildStats, setBuildStats] = useState({ total: 0, ms: 0 });
//   const [scoreMs, setScoreMs]       = useState(0);
  
//   // Add a new class spot
//   const addClassSpot = () => {
//     const newId = classSpots.length > 0 ? Math.max(...classSpots.map(spot => spot.id)) + 1 : 1;
//     setClassSpots([
//       ...classSpots,
//       { id: newId, classes: [{ classCode: "", selectedSections: {} }] }
//     ]);
//   }
  
//   // Update classes for a specific spot
//   const updateClassSpot = (spotId: number, classes: ClassSectionSelection[]) => {
//     setClassSpots(classSpots.map(spot =>
//       spot.id === spotId ? { ...spot, classes } : spot
//     ));
//   }
  
//   // Remove a class spot
//   const removeClassSpot = (spotId: number) => {
//     setClassSpots(classSpots.filter(spot => spot.id !== spotId))
//   }
  
//   // Update preferences
//   const updatePreference = (key: string, value: any) => {
//     setPreferences(prev => ({
//       ...prev,
//       [key]: value
//     }))
//   }
  

//   // Generate schedules
//   const generateSchedules = async () => {
//     // ensure at least one class
//     const validSpots = classSpots.filter(spot =>
//       spot.classes.some(c => c.classCode.trim())
//     );
//     if (!validSpots.length) {
//       setError('Please add at least one class.');
//       return;
//     }

//     setLoadingStage('building');

//     const payload = encodeURIComponent(
//       JSON.stringify({ classSpots: validSpots, preferences })
//     );

//     const es = new EventSource(
//       `/api/generate-schedules-stream?payload=${payload}`
//     );

//     es.addEventListener('log', e => {
//       const line = (e as MessageEvent<string>).data;

//       // generator progress
//       const mBuild = line.match(
//         /\[Generator] after spot .*: (\d+) schedules built \(total build time so far: (\d+)ms/
//       );
//       if (mBuild) {
//         setBuildStats({ total: +mBuild[1], ms: +mBuild[2] });
//       }

//       if (line.startsWith('Scoring schedules')) {
//         setLoadingStage('scoring');
//       }

//       const mScore = line.match(/Total scoring time: (\d+)ms/);
//       if (mScore) setScoreMs(+mScore[1]);
//     });

//     es.addEventListener('done', e => {
//       const json = JSON.parse((e as MessageEvent<string>).data);
//       setSchedules(json.schedules);
//       setLoadingStage('done');
//       setShowResults(true);
//       es.close();
//     });

//     es.addEventListener('error', e => {
//       setError('Scheduler failed – please try again.');
//       setLoadingStage('idle');
//       es.close();
//     });;
//   }

//   // const generateSchedules = async () => {
//   //   setShowResults(false);
//   //   setLoading(true);
//   //   setError("");
    
//   //   // Filter out empty class spots
//   //   const validClassSpots = classSpots.filter(spot => 
//   //     spot.classes.some(cls => cls.classCode && cls.classCode.trim() !== "")
//   //   );
    
//   //   if (validClassSpots.length === 0) {
//   //     setError("Please add at least one class");
//   //     setLoading(false);
//   //     return;
//   //   }
    
//   //   try {
//   //     // Update this URL to point to your actual server
//   //     const response = await api.post('/api/generate-schedules', {
//   //       classSpots: validClassSpots,
//   //       preferences
//   //     });
      
//   //     setSchedules(response.data.schedules);
//   //     setShowResults(true);  // Add this line to show results after successful fetch
      
//   //     if (response.data.schedules.length === 0) {
//   //       setError("No valid schedules found. Try different classes or preferences.");
//   //     }
      
//   //   } catch (error) {
//   //     console.error("Error generating schedules:", error);
      
//   //     let errorMessage = "Failed to generate schedules";
      
//   //     if (error.response?.data) {
//   //       const { error: errorMsg, warnings, details } = error.response.data;
        
//   //       if (warnings && warnings.length > 0) {
//   //         errorMessage = `${errorMsg}: ${warnings.join(', ')}`;
//   //       } else if (errorMsg === 'Scheduler crashed due to a memory error') {
//   //         errorMessage = "The scheduler encountered a problem. We're working on a fix. Try with different classes for now.";
//   //       } else {
//   //         errorMessage = errorMsg || "Failed to generate schedules";
//   //       }
//   //     }
      
//   //     setError(errorMessage);
//   //     setLoading(false);
//   //   } finally {
//   //     setLoading(false);
//   //   }
//   // }
  
//   // Reset to input view
//   const resetScheduler = (clearInputs = false) => {
//     if (clearInputs) {
//     setClassSpots([
//       { id: 1, classes: [{ classCode: "", selectedSections: {} }] }
//     ]);
//     setPreferences({
//       timeOfDay: [],
//       daysOff: [],
//       classLength: "",
//       avoidLabs: false,
//       avoidDiscussions: false,
//       excludeFullSections: true
//     });
//   }

//     // 2️⃣ always clear results & related UI state
//     setSchedules([]);
//     setShowResults(false);          // ← this is the key line
//     setActiveScheduleIndex(0);
//     setLoading(false);
//     setError("");
//   }
  
//   // Function to extract and format professor data from a schedule
//   const getProfessorsFromSchedule = (schedule: any) => {
//   const profMap: Record<string, any> = {};

//   schedule.classes.forEach((cls: any) => {
//     cls.sections.forEach((sec: any) => {
//       const name = sec.instructor?.trim();
//       if (!name) return;                                 // skip TBA

//       let r = sec.ratings;                               // backend JSON
//       if (!r) return;

//       // guarantee required props exist
//       r = {
//         quality: r.quality ?? 0,
//         difficulty: r.difficulty ?? 0,
//         would_take_again: r.would_take_again ?? 0,
//         course_quality: r.course_quality ?? 0,
//       };

//       if (!profMap[name]) {
//         profMap[name] = {
//           name,
//           classCodes: [cls.code],
//           overallRating: r.quality,
//           courseRating: r.course_quality > 0 ? r.course_quality : r.quality,
//           difficulty: r.difficulty,
//           wouldTakeAgain: r.would_take_again,
//         };
//       } else {
//         const p = profMap[name];
//         if (!p.classCodes.includes(cls.code)) p.classCodes.push(cls.code);

//         // simple running average
//         p.overallRating = (p.overallRating + r.quality) / 2;
//         p.courseRating =
//           (p.courseRating +
//             (r.course_quality > 0 ? r.course_quality : r.quality)) /
//           2;
//         p.difficulty = (p.difficulty + r.difficulty) / 2;
//         p.wouldTakeAgain = (p.wouldTakeAgain + r.would_take_again) / 2;
//       }
//     });
//   });

//   return Object.values(profMap);
// };

//   const noValidSchedules = showResults && schedules.length === 0;

// return (
//   <div className="w-full py-8 px-4 md:px-6 text-white">
//     {/* loading overlay */}
//     {loadingStage !== 'idle' && !showResults && (
//       <div className="flex flex-col items-center justify-center h-80 bg-white/10 rounded-lg p-6">
//         <div className="w-16 h-16 border-4 border-white/40 border-t-usc-red rounded-full animate-spin mb-4" />

//         {loadingStage === 'building' && (
//           <>
//             <p className="text-xl font-semibold">Building all possible schedules…</p>
//             {buildStats.total > 0 && (
//               <p className="text-sm mt-2 text-white/70">
//                 {buildStats.total.toLocaleString()} built in {buildStats.ms} ms&nbsp;
//                 (
//                 {Math.round(buildStats.total / Math.max(buildStats.ms, 1))}
//                 &nbsp;per ms)
//               </p>
//             )}
//           </>
//         )}

//         {loadingStage === 'scoring' && (
//           <>
//             <p className="text-xl font-semibold">Finding the optimal schedules…</p>
//             {scoreMs > 0 && (
//               <p className="text-sm mt-2 text-white/70">
//                 Scored in {scoreMs} ms
//               </p>
//             )}
//           </>
//         )}
//       </div>
//     )}

//     {/* main content (prefs + results / inputs) */}
//     <div className="flex flex-col md:flex-row gap-1 items-start">
//       {!showResults && (
//         <div className="w-full md:w-1/4 md:pl-6">
//           <h2 className="text-2xl font-semibold mb-6 mt-1">Preferences</h2>
//           <PreferencePanel
//             preferences={preferences}
//             updatePreference={updatePreference}
//           />
//         </div>
//       )}

//       <div className={`w-full ${!showResults ? 'md:w-2/3' : 'md:w-full'}`}>
//         {/* RESULTS ---------------------------------------------------- */}
//         {showResults && (
//           <>
//             <div className="flex justify-between items-center mb-6">
//               <h2 className="text-xl font-semibold">
//                 Top {schedules.length}Schedules{' '}
//                 <span className="text-white/50 font-normal">
//                   (out of {buildStats.total.toLocaleString()}, scored&nbsp;
//                   {Math.round(
//                     buildStats.total / Math.max(scoreMs, 1)
//                   ) || 0}
//                   /ms)
//                 </span>
//               </h2>

//               <button
//                 className="text-white/80 hover:text-white underline"
//                 onClick={reset}
//               >
//                 Start Over
//               </button>
//             </div>

//             <div className="space-y-8">
//               {schedules.map(schedule => (
//                 <div key={schedule.id} className="bg-white/10 rounded-lg p-4">
//                   {/* score / grid / profs (unchanged) */}
//                   <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
//                     <div className="lg:col-span-2 flex flex-col items-center">
//                       <div className="text-5xl font-bold mb-2">
//                         {schedule.score.toFixed(1)}
//                       </div>
//                       <div className="text-xl mb-4">Score</div>
//                     </div>

//                     <div className="lg:col-span-6">
//                       <ScheduleFrame classes={schedule.classes} />
//                     </div>

//                     <div className="lg:col-span-4">
//                       <ProfessorFrame
//                         professors={getProfessorsFromSchedule(schedule)}
//                       />
//                     </div>
//                   </div>
//                 </div>
//               ))}
//             </div>
//           </>
//         )}

//         {/* INPUTS ----------------------------------------------------- */}
//         {!showResults && loadingStage === 'idle' && (
//           <>
//             <h2 className="text-2xl font-semibold mb-6 mt-1">
//               Select Your Classes
//             </h2>

//             <div className="space-y-2">
//               {classSpots.map((spot, idx) => (
//                 <ClassSpot
//                   key={spot.id}
//                   index={idx}
//                   classes={
//                     spot.classes.length
//                       ? spot.classes
//                       : [{ classCode: '', selectedSections: {} }]
//                   }
//                   onUpdate={cls => updateClassSpot(spot.id, cls)}
//                   onRemove={() => removeClassSpot(spot.id)}
//                 />
//               ))}
//             </div>

//             <div className="mt-10 flex gap-4">
//               <button
//                 onClick={addClassSpot}
//                 className="w-56 h-10 border-2 border-dotted border-white rounded-lg hover:bg-white/10 flex items-center justify-center"
//               >
//                 <span className="mr-2 text-lg">+</span>Add Class Spot
//               </button>
//               <button
//                 onClick={generateSchedules}
//                 disabled={classSpots.some(s => !s.classes.length)}
//                 className="w-56 h-10 bg-usc-red rounded-lg hover:bg-red-800 flex items-center justify-center"
//               >
//                 Generate Schedules
//               </button>
//             </div>
//           </>
//         )}
//       </div>
//     </div>
//   </div>
// );
  
//   // return (
//   //   <div className="w-full py-8 px-4 md:px-6 text-white">
//   //     <div className="flex flex-col md:flex-row gap-1 items-start">
//   //       {/* Preferences side-panel */}
//   //       {!showResults && (
//   //         <div className="w-full md:w-1/4 md:pl-6">
//   //           <h2 className="text-2xl font-semibold mb-6 mt-1">Preferences</h2>
//   //           <PreferencePanel preferences={preferences} updatePreference={updatePreference} />
//   //         </div>
//   //       )}

//   //       {/* Main column */}
//   //       <div className={`w-full ${!showResults ? 'md:w-2/3' : 'md:w-full'}`}>

//   //         {/* 1️⃣ Loading spinner */}
//   //         {loading ? (
//   //           <div className="flex flex-col items-center justify-center h-80 bg-white/10 rounded-lg p-6">
//   //             <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mb-4"></div>
//   //             <p className="text-xl">Generating optimal schedules...</p>
//   //             <p className="text-sm mt-2 text-white/70">This may take a few moments</p>
//   //           </div>

//   //         /* 2️⃣ No-valid-schedules card */
//   //         ) : noValidSchedules ? (
//   //           <div className="flex flex-col items-center justify-center h-72 bg-white/10 rounded-lg p-8 text-center">
//   //             <h2 className="text-2xl font-semibold mb-3">No Valid Schedules Found</h2>
//   //             <p className="text-white/80">
//   //               Class times overlap&nbsp;or&nbsp;no seats are left.
//   //             </p>

//   //             <button
//   //               className="mt-8 w-44 h-10 bg-usc-red rounded-lg font-semibold hover:bg-red-800 transition-colors"
//   //               onClick={() => resetScheduler(/* keep inputs */)}
//   //             >
//   //               Start Over
//   //             </button>
//   //           </div>

//   //         /* 3️⃣ Results view (has schedules) */
//   //         ) : showResults ? (
//   //           <div>
//   //             {/* header row */}
//   //             <div className="flex justify-between items-center mb-6">
//   //               <h2 className="text-xl font-semibold">Top Schedules</h2>
//   //               <button
//   //                 className="text-white/80 hover:text-white underline transition-colors"
//   //                 onClick={() => resetScheduler(/* keep inputs */)}
//   //               >
//   //                 Start Over
//   //               </button>
//   //             </div>

//   //             {/* schedules list */}
//   //             <div className="space-y-8">
//   //               {schedules.map(schedule => (
//   //                 <div key={schedule.id} className="bg-white/10 rounded-lg p-4">
//   //                   <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
//   //                     {/* Score */}
//   //                     <div className="lg:col-span-2">
//   //                       <div className="flex flex-col items-center">
//   //                         {/* overall schedule score */}
//   //                         <div className="text-5xl font-bold mb-2">
//   //                           {schedule.score?.toFixed(1) ?? '0.0'}
//   //                         </div>
//   //                         <div className="text-xl mb-4">Score</div>

//   //                         {/* Averages that come straight from the backend */}
//   //                         <div className="flex flex-col items-center text-sm text-white/80">
//   //                           <div className="mb-1">
//   //                             <span className="mr-1">Prof Rating:</span>
//   //                             <span className="font-semibold">
//   //                               {schedule.avgProfRating !== undefined
//   //                                 ? schedule.avgProfRating.toFixed(1)
//   //                                 : 'N/A'}
//   //                             </span>
//   //                           </div>
//   //                           <div>
//   //                             <span className="mr-1">Difficulty:</span>
//   //                             <span className="font-semibold">
//   //                               {schedule.avgDifficulty !== undefined
//   //                                 ? schedule.avgDifficulty.toFixed(1)
//   //                                 : 'N/A'}
//   //                             </span>
//   //                           </div>
//   //                         </div>
//   //                       </div>
//   //                     </div>

//   //                     {/* Calendar */}
//   //                     <div className="lg:col-span-6">
//   //                       <ScheduleFrame classes={schedule.classes} />
//   //                     </div>

//   //                     {/* Professors */}
//   //                     <div className="lg:col-span-4">
//   //                       <ProfessorFrame professors={getProfessorsFromSchedule(schedule)} />
//   //                     </div>
//   //                   </div>
//   //                 </div>
//   //               ))}
//   //             </div>
//   //           </div>

//   //         /* 4️⃣ Input view (default) */
//   //         ) : (
//   //           <>
//   //             <h2 className="text-2xl font-semibold mb-6 mt-1">Select Your Classes</h2>

//   //             <div className="class-spots-container space-y-2">
//   //               {classSpots.map((spot, idx) => (
//   //                 <ClassSpot
//   //                   key={spot.id}
//   //                   index={idx}
//   //                   classes={spot.classes.length === 0 ? [{ classCode: "", selectedSections: {} }] : spot.classes}
//   //                   onUpdate={(classes) => updateClassSpot(spot.id, classes)}
//   //                   onRemove={() => removeClassSpot(spot.id)}
//   //                 />
//   //               ))}
//   //             </div>

//   //             <div className="mt-10 flex gap-4">
//   //               <button
//   //                 onClick={addClassSpot}
//   //                 className="w-56 h-10 border-2 border-dotted border-white text-white font-bold rounded-lg hover:bg-white/10 transition-colors flex items-center justify-center"
//   //               >
//   //                 <span className="mr-2 text-lg">+</span>
//   //                 <span>Add Class Spot</span>
//   //               </button>
//   //               <button
//   //                 className="w-56 h-10 bg-usc-red text-white font-bold rounded-lg hover:bg-red-800 transition-colors flex items-center justify-center"
//   //                 onClick={generateSchedules}
//   //                 disabled={classSpots.some(spot => spot.classes.length === 0)}
//   //               >
//   //                 Generate Schedules
//   //               </button>
//   //             </div>
//   //           </>
//   //         )}
//   //       </div>
//   //     </div>
//   //   </div>
//   // )
// }

// export default Scheduler