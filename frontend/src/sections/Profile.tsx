import React, { useState, useEffect } from 'react';
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
  const navigate = useNavigate();

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

  const handleDeleteSchedule = async (scheduleId: number) => {
    if (!window.confirm('Are you sure you want to delete this schedule?')) {
      return;
    }

    try {
      await api.delete(`/api/schedules/${scheduleId}`);
      // Remove the deleted schedule from state
      setSavedSchedules(schedules => schedules.filter(s => s.id !== scheduleId));
    } catch (err) {
      console.error('Error deleting schedule:', err);
      setError('Failed to delete schedule');
    }
  };

  const handleLoadSchedule = (schedule: SavedSchedule) => {
    // Navigate to scheduler with the schedule data
    navigate('/scheduler', { state: { loadedSchedule: schedule.schedule_data } });
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
            {savedSchedules.map((schedule) => (
              <div key={schedule.id} className="rounded-lg overflow-hidden hover:border-usc-red/50 transition-colors w-full mb-4 bg-white/5">
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
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSchedule(schedule.id);
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
                          onClick={() => handleDeleteSchedule(schedule.id)}
                          className="px-3 py-1 bg-transparent border border-white/30 text-white text-sm rounded hover:border-red-500 hover:text-red-500 transition-colors"
                        >
                          Delete Invalid Schedule
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Profile;
