import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ScheduleFrame from '../components/ScheduleFrame';
import ProfessorFrame from '../components/ProfessorFrame';
import api from '../services/api';

interface SavedSchedule {
  id: number;
  name: string;
  semester: string;
  schedule_data: any;
  created_at: string;
  updated_at: string;
}

// Helper – used by getProfessorsFromSchedule to smooth multiple sections
const runningAverage = (oldVal: number, newVal: number, n: number) =>
  (oldVal * (n - 1) + newVal) / n;

const Profile = () => {
  const { user, isAuthenticated, loading } = useAuth();
  const [savedSchedules, setSavedSchedules] = useState<SavedSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedScheduleIds, setExpandedScheduleIds] = useState<number[]>([]);
  const [expandingSchedule, setExpandingSchedule] = useState(false);
  const [professorData, setProfessorData] = useState<Record<number, any[]>>({});
  // Selected schedules for comparison (order matters: [left, right])
  const [compareSelection, setCompareSelection] = useState<number[]>([]);
  const leftCompareRef = useRef<HTMLDivElement | null>(null);
  const rightCompareRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<SavedSchedule | null>(null);

  useEffect(() => {
    // Redirect to login if not authenticated
    if (!loading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, loading, navigate]);

  useEffect(() => {
    // Fetch user's saved schedules
    const fetchSavedSchedules = async () => {
      if (!isAuthenticated) return;

      try {
        setIsLoading(true);
        const response = await api.get('/api/schedules/user');
        setSavedSchedules(response.data.schedules || []);
      } catch (err: any) {
        console.error('Error fetching saved schedules:', err);
        setError('Failed to load your saved schedules');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSavedSchedules();
  }, [isAuthenticated]);

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget) return;
    const scheduleId = deleteTarget.id;
    try {
      await api.delete(`/api/schedules/${scheduleId}`);
      setSavedSchedules(schedules => schedules.filter(s => s.id !== scheduleId));
      setDeleteTarget(null);
    } catch (err) {
      console.error('Error deleting schedule:', err);
      setError('Failed to delete schedule');
    }
  };

  const handleLoadSchedule = (schedule: SavedSchedule) => {
    // Navigate to scheduler with the schedule data
    navigate('/scheduler', { state: { loadedSchedule: schedule.schedule_data } });
  };

  /** Toggle compare selection for a schedule ID per custom rules:
   *  - Click unselected (0 chosen) -> becomes left
   *  - Click unselected (1 chosen) -> becomes right
   *  - Click unselected (2 chosen) -> replaces right
   *  - Click selected -> deselect it
   */
  const toggleCompare = async (scheduleId: number) => {
    setCompareSelection(prev => {
      // already selected => deselect
      if (prev.includes(scheduleId)) {
        return prev.filter(id => id !== scheduleId);
      }
      // not selected yet
      if (prev.length === 0) return [scheduleId];
      if (prev.length === 1) return [prev[0], scheduleId];
      // length === 2 -> replace right (second)
      return [prev[0], scheduleId];
    });

    // Ensure professor data preloaded for this schedule (non-blocking)
    if (!professorData[scheduleId]) {
      const schedule = savedSchedules.find(s => s.id === scheduleId);
      if (schedule) {
        getProfessorsFromSchedule(schedule.schedule_data).then(profs => {
          setProfessorData(prev => ({ ...prev, [scheduleId]: profs }));
        }).catch(() => {});
      }
    }
  };

  // Toggle accordion for a schedule
  const toggleScheduleExpand = async (scheduleId: number) => {
    // Create a Set from the current expanded schedules (or empty Set if null)
    const currentlyExpanded = new Set(expandedScheduleIds || []);
    
    if (currentlyExpanded.has(scheduleId)) {
      // Remove this schedule from expanded list
      currentlyExpanded.delete(scheduleId);
    } else {
      // Add this schedule to expanded list
      currentlyExpanded.add(scheduleId);
      setExpandingSchedule(true);
      
      // Fetch professor data if we don't have it yet
      if (!professorData[scheduleId]) {
        const schedule = savedSchedules.find(s => s.id === scheduleId);
        if (schedule) {
          const profs = await getProfessorsFromSchedule(schedule.schedule_data);
          setProfessorData(prev => ({
            ...prev,
            [scheduleId]: profs
          }));
        }
      }
      
      // Add a small delay to show loading state
      setTimeout(() => setExpandingSchedule(false), 300);
    }
    
    // Update state with new Set contents
    setExpandedScheduleIds(Array.from(currentlyExpanded));
  };

  // Helper to process schedule data for ScheduleFrame
  const formatScheduleForDisplay = (scheduleData: any) => {
    if (!scheduleData || !scheduleData.schedules || !scheduleData.schedules.length) {
      return [];
    }

    // Get the first schedule
    const schedule = scheduleData.schedules[0];
    
    // Log what we're working with (for debugging)
    console.log("Schedule data to format:", schedule);
    
    if (!schedule.classes || !Array.isArray(schedule.classes)) {
      console.error("Invalid schedule data format:", schedule);
      return [];
    }
    
    // Format the classes as expected by ScheduleFrame
    return schedule.classes.map((cls: any) => {
      // Log each class for debugging
      console.log("Processing class:", cls);
      
      return {
        code: cls.classCode || cls.code || "",
        sections: Array.isArray(cls.sections) ? cls.sections.map((sec: any) => ({
          type: sec.type || '',
          days: sec.days || '',
          time: sec.time || 'TBA',
          instructor: sec.instructor || 'TBA',
          seats_registered: sec.seats_registered,
          seats_total: sec.seats_total
        })) : []
      };
    });
  };

  // Preload professor data when compare selection changes (only for newly added IDs)
  useEffect(() => {
    compareSelection.forEach(id => {
      if (!professorData[id]) {
        const schedule = savedSchedules.find(s => s.id === id);
        if (schedule) {
          getProfessorsFromSchedule(schedule.schedule_data).then(profs => {
            setProfessorData(prev => ({ ...prev, [id]: profs }));
          }).catch(() => {});
        }
      }
    });
  }, [compareSelection, professorData, savedSchedules]);

  // Highlight unique sections between two compared schedules (section-level diff)
  useEffect(() => {
    // clear existing highlights
    const clearHighlights = (root?: HTMLElement | null) => {
      root?.querySelectorAll('.diff-highlight').forEach(el => {
        el.classList.remove('diff-highlight', 'diff-animate');
        // reset inline animation style if previously set
        (el as HTMLElement).style.animation = '';
      });
    };
    if (compareSelection.length !== 2) {
      clearHighlights(leftCompareRef.current || undefined);
      clearHighlights(rightCompareRef.current || undefined);
      return;
    }
    const leftRoot = leftCompareRef.current;
    const rightRoot = rightCompareRef.current;
    if (!leftRoot || !rightRoot) return;

    // collect section keys (fine-grained) else fallback to course-code
    const collectSections = (root: HTMLElement) => {
      const map = new Map<string, HTMLElement[]>();
      root.querySelectorAll<HTMLElement>('[data-section-key]').forEach(el => {
        const key = (el.getAttribute('data-section-key') || '').trim();
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(el);
      });
      return map;
    };
    const leftSections = collectSections(leftRoot);
    const rightSections = collectSections(rightRoot);

    // determine unique section keys
    const uniqueLeft: string[] = [];
    const uniqueRight: string[] = [];
    leftSections.forEach((_els, key) => { if (!rightSections.has(key)) uniqueLeft.push(key); });
    rightSections.forEach((_els, key) => { if (!leftSections.has(key)) uniqueRight.push(key); });

    // apply highlighting and synchronise animation by forcing reflow then setting same animation start
    const apply = (keys: string[], map: Map<string, HTMLElement[]>) => {
      keys.forEach(key => {
        map.get(key)?.forEach(el => {
          el.classList.add('diff-highlight');
        });
      });
    };
    apply(uniqueLeft, leftSections);
    apply(uniqueRight, rightSections);

    // Force reflow & then add animation class simultaneously so pulses align
    const highlighted = [leftRoot, rightRoot].flatMap(r => Array.from(r.querySelectorAll('.diff-highlight')));
    // remove existing animation classes if any (for consecutive comparisons)
    highlighted.forEach(el => el.classList.remove('diff-animate'));
    void document.body.offsetHeight; // reflow
    highlighted.forEach(el => el.classList.add('diff-animate'));

    return () => {
      clearHighlights(leftRoot);
      clearHighlights(rightRoot);
    };
  }, [compareSelection]);

  // Extract professor information from schedule
  const getProfessorsFromSchedule = async (scheduleData: any) => {
    if (!scheduleData || !scheduleData.schedules || !scheduleData.schedules.length) {
      return [];
    }

    const schedule = scheduleData.schedules[0];
    const professorMap: Record<string, any> = {};
    const professorCourseMap = new Map<string, string[]>();

    if (!schedule.classes || !Array.isArray(schedule.classes)) {
      return [];
    }

    // First pass: collect all professor names with their associated courses
    schedule.classes.forEach((cls: any) => {
      if (!cls.sections || !Array.isArray(cls.sections)) return;
      
      cls.sections.forEach((sec: any) => {
        const name = sec.instructor?.trim();
        if (!name || name.toLowerCase() === 'tba') return; // ignore TBA
        
        if (!professorCourseMap.has(name)) {
          professorCourseMap.set(name, [cls.classCode || cls.code || ""]);
        } else if (!professorCourseMap.get(name)?.includes(cls.classCode || cls.code || "")) {
          professorCourseMap.get(name)?.push(cls.classCode || cls.code || "");
        }
      });
    });
    
    // If no professors, return empty array
    if (professorCourseMap.size === 0) {
      return [];
    }
    
    try {
      // Prepare data for API request
      const professorList = Array.from(professorCourseMap.keys());
      const courseList: string[] = [];
      
      // For each professor, use their first course code
      professorList.forEach(prof => {
        const courses = professorCourseMap.get(prof) || [];
        courseList.push(courses[0] || '');
      });
      
      // Clean professor names for query
      const cleanedProfessorList = professorList.map(prof => 
        prof.replace(/[{}"]/g, '').trim()
      );
      
      // Get professor ratings from API
      const response = await api.get('/api/professor-ratings', {
        params: {
          professors: cleanedProfessorList.join(','),
          courses: courseList.join(',')
        }
      });

      // Process the schedule data with API results
      schedule.classes.forEach((cls: any) => {
        if (!cls.sections || !Array.isArray(cls.sections)) return;
        
        cls.sections.forEach((sec: any) => {
          const name = sec.instructor?.trim();
          if (!name || name.toLowerCase() === 'tba') return;
          
          // Clean the name to match how it was sent to API
          const cleanName = name.replace(/[{}"]/g, '').trim();
          
          // Try to find in response data with both original and cleaned name
          const ratings = response.data[name] || response.data[cleanName] || {
            quality: 3.5,
            difficulty: 3.0,
            would_take_again: 70,
            course_quality: 3.5,
            course_difficulty: 3.0
          };
          
          if (!professorMap[name]) {
            professorMap[name] = {
              name,
              classCodes: [cls.classCode || cls.code || ""],
              overallRating: ratings.quality || 3.5,
              courseRating: ratings.course_quality || ratings.quality || 3.5,
              difficulty: ratings.difficulty || 3.0,
              wouldTakeAgain: ratings.would_take_again || 70,
              _count: 1
            };
          } else {
            const p = professorMap[name];
            const classCode = cls.classCode || cls.code || "";
            if (!p.classCodes.includes(classCode)) p.classCodes.push(classCode);
            p._count += 1;
            p.overallRating  = runningAverage(p.overallRating,  ratings.quality || 3.5, p._count);
            p.courseRating   = runningAverage(p.courseRating,   ratings.course_quality || ratings.quality || 3.5, p._count);
            p.difficulty     = runningAverage(p.difficulty,     ratings.difficulty || 3.0, p._count);
            p.wouldTakeAgain = runningAverage(p.wouldTakeAgain, ratings.would_take_again || 70, p._count);
          }
        });
      });
    } catch (error) {
      console.error("Error fetching professor ratings:", error);
      
      // Fallback if API fails - use default values
      schedule.classes.forEach((cls: any) => {
        if (!cls.sections || !Array.isArray(cls.sections)) return;
        
        cls.sections.forEach((sec: any) => {
          const name = sec.instructor?.trim();
          if (!name || name.toLowerCase() === 'tba') return;
          
          if (!professorMap[name]) {
            professorMap[name] = {
              name,
              classCodes: [cls.classCode || cls.code || ""],
              overallRating: 3.5,
              courseRating: 3.5,
              difficulty: 3.0,
              wouldTakeAgain: 70,
              _count: 1
            };
          } else {
            const p = professorMap[name];
            const classCode = cls.classCode || cls.code || "";
            if (!p.classCodes.includes(classCode)) p.classCodes.push(classCode);
          }
        });
      });
    }

    // Strip the private _count
    return Object.values(professorMap).map(p => {
      const { _count, ...rest } = p as any;
      return rest;
    });
  };

  if (loading || !isAuthenticated) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-80px)]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-usc-red"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {compareSelection.length > 0 && (
        <style>{`
          @keyframes diffGlowPulse { 0%,100% { box-shadow:0 0 0 rgba(255,199,0,0); } 50% { box-shadow:0 0 16px rgba(255,199,0,0.9), 0 0 6px rgba(255,199,0,0.85); } }
          .diff-highlight { position:relative; }
          .diff-highlight.diff-animate { animation: diffGlowPulse 1.6s ease-in-out infinite; }
        `}</style>
      )}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">My Profile</h1>
        <p className="text-white/70">
          Welcome back, <span className="text-usc-red font-semibold">{user?.name}</span>
        </p>
      </div>

      <div className="rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold text-white mb-4">Account Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-white/60 text-sm">Name</p>
            <p className="text-white">{user?.name}</p>
          </div>
          <div>
            <p className="text-white/60 text-sm">Email</p>
            <p className="text-white">{user?.email}</p>
          </div>
          <div>
            <p className="text-white/60 text-sm">Account Created</p>
            <p className="text-white">
              {new Date(user?.created_at || '').toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>

      {/* ─── Comparison Area (moved back above Saved Schedules) ─── */}
      {compareSelection.length > 0 && (
        <div className="mb-10 p-4 rounded-lg bg-white/5 border border-white/10">
          <h2 className="text-xl font-semibold text-white mb-4">Compare Schedules</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Left schedule */}
            {(() => {
              const scheduleId = compareSelection[0];
              const schedule = savedSchedules.find(s => s.id === scheduleId);
              if (!schedule) return null;
              const classes = formatScheduleForDisplay(schedule.schedule_data);
              const profs = professorData[scheduleId] || [];
              return (
                <div ref={leftCompareRef} data-compare-slot="left" className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{schedule.name}</h3>
                      <p className="text-xs text-white/50">{new Date(schedule.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-xs px-2 py-1 rounded bg-gray-700 text-white/70">Left</div>
                  </div>
                  <ScheduleFrame classes={classes} />
                  <ProfessorFrame professors={profs} />
                </div>
              );
            })()}
            {/* Right schedule or placeholder */}
            {(() => {
              const scheduleId = compareSelection[1];
              if (!scheduleId) {
                return (
                  <div className="rounded-lg border border-dashed border-white/15 min-h-[480px] flex items-center justify-center text-white/40 text-sm">
                    Select another schedule to compare
                  </div>
                );
              }
              const schedule = savedSchedules.find(s => s.id === scheduleId);
              if (!schedule) return null;
              const classes = formatScheduleForDisplay(schedule.schedule_data);
              const profs = professorData[scheduleId] || [];
              return (
                <div ref={rightCompareRef} data-compare-slot="right" className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{schedule.name}</h3>
                      <p className="text-xs text-white/50">{new Date(schedule.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-xs px-2 py-1 rounded bg-gray-700 text-white/70">Right</div>
                  </div>
                  <ScheduleFrame classes={classes} />
                  <ProfessorFrame professors={profs} />
                </div>
              );
            })()}
          </div>
          {compareSelection.length === 2 && (
            <div className="mt-3 text-[11px] text-white/40">Unique classes glow (present in only one schedule).</div>
          )}
        </div>
      )}

      <div className="rounded-lg p-6">
        <h2 className="text-xl font-semibold text-white mb-4">Saved Schedules</h2>
        
        {error && (
          <div className="mb-4 p-3 bg-red-800/30 border border-red-600 text-white rounded-lg">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-usc-red"></div>
          </div>
        ) : savedSchedules.length === 0 ? (
          <div className="text-center p-8 text-white/70">
            <p>You don't have any saved schedules yet.</p>
            <button 
              onClick={() => navigate('/scheduler')}
              className="mt-4 px-4 py-2 bg-usc-red text-white rounded-lg hover:bg-red-800 transition-colors"
            >
              Create a Schedule
            </button>
          </div>
        ) : (
          <div className="space-y-4 w-full max-w-7xl mx-auto">
            {savedSchedules.map((schedule) => {
              const isCompared = compareSelection.includes(schedule.id);
              return (
              <div key={schedule.id} className={`rounded-lg overflow-hidden transition-colors w-full mb-4 bg-white/5 ${isCompared ? 'ring-1 ring-yellow-400/40' : ''}`}>
                <div 
                  className="p-4 cursor-pointer flex items-center"
                  onClick={() => toggleScheduleExpand(schedule.id)}
                >
                  <button 
                    className="p-2 mr-3 text-white/70 hover:text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleScheduleExpand(schedule.id);
                    }}
                  >
                    {expandedScheduleIds.includes(schedule.id) ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                  <div className="flex-grow">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-medium text-white">{schedule.name}</h3>
                      <div className="text-xs bg-gray-700 text-white/80 px-2 py-1 rounded">
                        {schedule.semester}
                      </div>
                    </div>
                    <p className="text-sm text-white/60">
                      Created on {new Date(schedule.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  {/* Compare button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCompare(schedule.id);
                    }}
                    aria-pressed={isCompared}
                    className={`ml-2 px-3 py-1 text-sm rounded transition-colors border border-white/30 ${isCompared ? 'bg-transparent text-white/70 hover:text-white' : 'bg-yellow-400 text-black hover:bg-yellow-300'} `}
                  >
                    {isCompared ? 'Selected' : 'Compare'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(schedule);
                    }}
                    className="ml-2 px-3 py-1 bg-transparent border border-white/30 text-white text-sm rounded hover:border-red-500 hover:text-red-500 transition-colors"
                  >
                    Delete
                  </button>
                </div>
                
                {expandedScheduleIds.includes(schedule.id) && (
                  <div className="p-4">
                    {expandingSchedule ? (
                      <div className="flex justify-center items-center py-16">
                        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-usc-red"></div>
                      </div>
                    ) : schedule.schedule_data?.schedules && schedule.schedule_data.schedules.length > 0 ? (
                      <div>
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-4">
                          {/* Calendar view - Takes up 8 columns on large screens */}
                          <div className="lg:col-span-8">
                            <ScheduleFrame 
                              classes={formatScheduleForDisplay(schedule.schedule_data)} 
                            />
                          </div>
                          
                          {/* Professor information - Takes up 4 columns on large screens */}
                          <div className="lg:col-span-4">
                            <ProfessorFrame 
                              professors={professorData[schedule.id] || []} 
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-white/60 py-8">
                        <p className="mb-3">No schedule data available or format is incompatible.</p>
                        <button
                          onClick={() => setDeleteTarget(schedule)}
                          className="px-3 py-1 bg-transparent border border-white/30 text-white text-sm rounded hover:border-red-500 hover:text-red-500 transition-colors"
                        >
                          Delete Invalid Schedule
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )})}
          </div>
        )}
      </div>
      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/70">
          <div className="bg-gray-900 p-6 rounded-lg w-full max-w-md">
            <h2 className="text-xl font-bold text-white mb-4">Delete Schedule</h2>
            <p className="text-white/80 mb-6">Are you sure you want to delete <span className="text-usc-red font-semibold">{deleteTarget.name}</span>? This action cannot be undone.</p>
            {error && (
              <div className="mb-4 p-3 bg-red-800/30 border border-red-600 text-white rounded-lg">
                {error}
              </div>
            )}
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 border border-white/30 text-white rounded-lg hover:border-white/50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirmed}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;
