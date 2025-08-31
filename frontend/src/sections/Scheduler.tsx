import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import ClassSpot from '../components/ClassSpot';
import type { ClassSectionSelection } from '../components/ClassSpot';
import PreferencePanel from '../components/PreferencePanel';
import ScheduleFrame from '../components/ScheduleFrame';
import ProfessorFrame from '../components/ProfessorFrame';
import SchedulePreview from '../components/SchedulePreview';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

/* -------------------------------------------------------------------------- *
 *  Extracted modal component (defined OUTSIDE Scheduler) so it does not get
 *  re-created each render. Previously it was defined inside the Scheduler
 *  component body which meant a new function identity every render; React then
 *  unmounted & remounted the modal subtree on every keystroke, causing the
 *  input to lose focus after each character. Moving it out stabilizes focus.
 * -------------------------------------------------------------------------- */
interface SaveScheduleModalProps {
  isAuthenticated: boolean;
  scheduleName: string;
  saveError: string;
  saveSuccess: string;
  onChangeName: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
}

const SaveScheduleModal: React.FC<SaveScheduleModalProps> = ({
  isAuthenticated,
  scheduleName,
  saveError,
  saveSuccess,
  onChangeName,
  onClose,
  onSave
}) => (
  <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/70">
    <div className="bg-gray-900 p-6 rounded-lg w-full max-w-md">
      <h2 className="text-xl font-bold text-white mb-4">Save Schedule</h2>

      {!isAuthenticated ? (
        <div className="mb-4 p-4 bg-blue-800/30 border border-blue-600 text-white rounded-lg">
          <p className="mb-2">You need to log in to save schedules.</p>
          <a
            href="/auth"
            className="inline-block px-4 py-2 bg-usc-red text-white rounded-lg hover:bg-red-800"
          >
            Log In / Sign Up
          </a>
        </div>
      ) : (
        <>
          {saveError && (
            <div className="mb-4 p-3 bg-red-800/30 border border-red-600 text-white rounded-lg">
              {saveError}
            </div>
          )}

            {saveSuccess && (
              <div className="mb-4 p-3 bg-green-800/30 border border-green-600 text-white rounded-lg">
                {saveSuccess}
              </div>
            )}

          <div className="mb-4">
            <label htmlFor="schedule-name" className="block text-white mb-2">
              Schedule Name
            </label>
            <input
              type="text"
              id="schedule-name"
              value={scheduleName}
              onChange={(e) => onChangeName(e.target.value)}
              placeholder="My Fall 2025 Schedule"
              className="w-full p-3 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-usc-red"
              autoFocus
            />
          </div>

          <div className="flex justify-end space-x-3">
            <button
              onClick={(e) => {
                e.preventDefault();
                onClose();
              }}
              className="px-4 py-2 border border-white/30 text-white rounded-lg hover:border-white/50"
            >
              Cancel
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                onSave();
              }}
              className="px-4 py-2 bg-usc-red text-white rounded-lg hover:bg-red-800"
            >
              Save
            </button>
          </div>
        </>
      )}
    </div>
  </div>
);

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

  // Add a new state variable to store section data
  const [classSections, setClassSections] = useState<Record<string, any>>({});

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
  
  // Save schedule state
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [scheduleName, setScheduleName] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [selectedScheduleIndex, setSelectedScheduleIndex] = useState(0);
  
  // Get auth context
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  
  // Check if we have a loaded schedule from profile page
  useEffect(() => {
    const state = location.state as any;
    if (state?.loadedSchedule) {
      try {
        const loadedData = state.loadedSchedule;
        setClassSpots(loadedData.classSpots || []);
        setPreferences(loadedData.preferences || {});
        // If schedules are included, load them
        if (loadedData.schedules && loadedData.schedules.length > 0) {
          setSchedules(loadedData.schedules);
          setShowResults(true);
          setLoadingStage('done');
        }
      } catch (err) {
        console.error('Error loading saved schedule:', err);
        setError('Failed to load the saved schedule');
      }
    }
  }, [location.state]);

  /** ───────── Schedule saving ───────── */
  const handleSaveSchedule = async () => {
    if (!isAuthenticated) {
      setSaveError('You must be logged in to save schedules');
      return;
    }
    
    if (!scheduleName.trim()) {
      setSaveError('Please enter a name for your schedule');
      return;
    }
    
    // Clear previous messages
    setSaveError('');
    setSaveSuccess('');
    
    try {
      // Get all class selections that have a class code and at least one selected section
      const validClassSelections = getAllClassSelections().filter(
        cls => cls.classCode && Object.keys(cls.selectedSections).length > 0
      );
      
      // Format classes for schedule data
      const classDataArray = validClassSelections.map(cls => {
        const sectionData = classSections[cls.classCode];
        if (!sectionData) return null;
        
        const sections = [];
        
        for (const [type, sectionId] of Object.entries(cls.selectedSections)) {
          if (!sectionId) continue;
          
          let section = null;
          
          // Find the section in the appropriate array
          if (sectionData[type] && Array.isArray(sectionData[type])) {
            section = sectionData[type].find((s: any) => s.id === sectionId);
          } else if (type === 'lecture' && sectionData.sections && Array.isArray(sectionData.sections)) {
            section = sectionData.sections.find((s: any) => s.id === sectionId);
          }
          
          if (section) {
            // Process days format
            let processedDays = section.days || 'TBA';
            if (processedDays === 'MonWed') processedDays = 'Mon, Wed';
            if (processedDays === 'TueThu') processedDays = 'Tue, Thu';
            if (processedDays === 'WedFri') processedDays = 'Wed, Fri';
            
            // Process seats data
            let seatsRegistered = 0;
            let seatsTotal = 0;
            
            if (typeof section.seats_taken === 'number') {
              seatsRegistered = section.seats_taken;
              seatsTotal = section.seats_total || 0;
            } else if (section.seats && typeof section.seats === 'string') {
              const parts = section.seats.split('/');
              if (parts.length === 2) {
                seatsRegistered = parseInt(parts[0], 10) || 0;
                seatsTotal = parseInt(parts[1], 10) || 0;
              }
            }
            
            sections.push({
              type: section.type || type,
              days: processedDays,
              time: section.time || 'TBA',
              instructor: section.professor || 'TBA',
              location: section.location || "",
              seats_registered: seatsRegistered,
              seats_total: seatsTotal
            });
          }
        }
        
        return sections.length > 0 ? {
          code: cls.classCode,
          sections
        } : null;
      }).filter(Boolean);
      
      // Create the formatted schedule data in the required format
      const scheduleData = {
        schedules: [{
          classes: classDataArray
        }],
        classSpots: classSpots.map(spot => ({
          id: Math.random().toString(36).substring(2, 9),
          classes: spot.classes.map(cls => ({
            classCode: cls.classCode,
            selectedSections: cls.selectedSections
          }))
        })),
        preferences: {}
      };
      
      await api.post('/api/schedules', {
        name: scheduleName,
        semester: '20253', // Use the current semester
        schedule_data: scheduleData
      });
      
      // Set success message
      setSaveSuccess('Schedule saved successfully!');
      
      // Clear schedule name
      setScheduleName('');
      
      // Close modal after a slight delay to allow the user to see the success message
      setTimeout(() => {
        setSaveModalOpen(false);
      }, 1500);
    } catch (err) {
      console.error('Error saving schedule:', err);
      setSaveError('Failed to save schedule. Please try again.');
    }
  };
  
  // (previous inline SaveScheduleModal removed – now external component above)
  const addClassSpot = () => {
    const newId = classSpots.length > 0 ? Math.max(...classSpots.map(s => s.id)) + 1 : 1;
    setClassSpots([...classSpots, { id: newId, classes: [{ classCode: '', selectedSections: {} }] }]);
  };

  const updateClassSpot = (id: number, classes: ClassSectionSelection[]) =>
    setClassSpots(spots => spots.map(s => (s.id === id ? { ...s, classes } : s)));

  const removeClassSpot = (id: number) =>
    setClassSpots(spots => spots.filter(s => s.id !== id));

  // New function to receive section data from ClassSpot components
  const updateClassSections = (newSections: Record<string, any>) => {
    setClassSections(prev => ({ ...prev, ...newSections }));
  };

  /** ───────── Preference helpers ───────── */
  const updatePreference = (key: string, value: any) =>
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
    const serverUrl = '/api/generate-schedules-stream';
    const es = new EventSource(`${serverUrl}?payload=${payload}`);

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
        if (!name || name.toLowerCase() === 'tba' || name === 'TBA') return; // Skip TBA instructors

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

  /** ───────── Get all class selections from all spots for the preview ───────── */
  const getAllClassSelections = () => {
    return classSpots.flatMap(spot => spot.classes).filter(cls => cls.classCode);
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

                <div className="flex items-center space-x-4">
                  <button className="text-white/80 hover:text-white underline" onClick={reset}>
                    Start Over
                  </button>
                </div>
              </div>

              <div className="space-y-8">
                {schedules.map(schedule => (
                  <div key={schedule.id} className="bg-white/10 rounded-lg p-4">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      {/* score */}
                      <div className="lg:col-span-2 flex flex-col items-center">
                        <div className="text-5xl font-bold mb-2 text-white">{schedule.score.toFixed(1)}</div>
                        <div className="text-xl mb-4 text-white">Score</div>
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
                    onSectionsLoaded={updateClassSections} // New prop to receive section data
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
                {getAllClassSelections().some(cls => cls.classCode && Object.keys(cls.selectedSections).length > 0) && (
                  <button 
                    onClick={() => {
                      if (!isAuthenticated) {
                        setSaveError('You must be logged in to save schedules');
                        setSaveModalOpen(true);
                      } else {
                        setSaveModalOpen(true);
                      }
                    }}
                    className="w-56 h-10 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold rounded-lg flex items-center justify-center"
                  >
                    Save Schedule
                  </button>
                )}
              </div>
              
              {/* Schedule Preview - Below the buttons */}
              <SchedulePreview 
                classSections={classSections}
                classSelections={getAllClassSelections()}
              />
            </>
          )}
        </div>
      </div>

      {/* generic error banner */}
      {error && (
        <div className="mt-6 bg-red-700/80 p-3 rounded text-center font-medium">{error}</div>
      )}
      
      {/* Save Schedule Modal */}
      {saveModalOpen && (
        <SaveScheduleModal
          isAuthenticated={isAuthenticated}
          scheduleName={scheduleName}
            saveError={saveError}
            saveSuccess={saveSuccess}
          onChangeName={setScheduleName}
          onClose={() => {
            setSaveModalOpen(false);
            setSaveError('');
            setSaveSuccess('');
          }}
          onSave={handleSaveSchedule}
        />
      )}
    </div>
  );
};

export default Scheduler;
