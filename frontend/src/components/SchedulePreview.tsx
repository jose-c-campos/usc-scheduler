import React, { useMemo, useState, useEffect } from 'react';
import ScheduleFrame from './ScheduleFrame';
import ProfessorFrame from './ProfessorFrame';
import type { ClassSectionSelection } from './ClassSpot';
import api from '../services/api';

interface SchedulePreviewProps {
  classSections: Record<string, any>;
  classSelections: ClassSectionSelection[];
}

// Helper for running averages - copied from Scheduler.tsx
const runningAverage = (oldVal: number, newVal: number, n: number) =>
  (oldVal * (n - 1) + newVal) / n;

// Save Schedule Modal Component
interface SaveScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  isSaving: boolean;
}

const SaveScheduleModal: React.FC<SaveScheduleModalProps> = ({ isOpen, onClose, onSave, isSaving }) => {
  const [scheduleName, setScheduleName] = useState('');
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/70">
      <div className="bg-gray-900 p-6 rounded-lg w-full max-w-md">
        <h2 className="text-xl font-bold text-white mb-4">Save Schedule</h2>
        
        <div className="mb-4">
          <label htmlFor="schedule-name" className="block text-white mb-2">
            Schedule Name
          </label>
          <input
            type="text"
            id="schedule-name"
            value={scheduleName}
            onChange={(e) => setScheduleName(e.target.value)}
            placeholder="My Fall 2025 Schedule"
            className="w-full p-3 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-usc-red"
          />
        </div>
        
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-white/30 text-white rounded-lg hover:border-white/50"
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (scheduleName.trim()) {
                onSave(scheduleName);
              }
            }}
            disabled={!scheduleName.trim() || isSaving}
            className="px-4 py-2 bg-usc-red text-white rounded-lg hover:bg-red-800 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

const SchedulePreview = ({ classSections, classSelections }: SchedulePreviewProps) => {
  // State to hold professor data after async fetch
  const [professorData, setProfessorData] = useState<any[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  // Transform class selections into the format expected by ScheduleFrame
  const scheduleData = useMemo(() => {
    const classes = classSelections
      .filter(cls => cls.classCode && Object.keys(cls.selectedSections).length > 0)
      .map(cls => {
        const sections = [];
        const sectionData = classSections[cls.classCode];
        
        if (!sectionData) return null;
        
        // Add each selected section (lecture, lab, discussion, etc.)
        for (const [type, sectionId] of Object.entries(cls.selectedSections)) {
          if (!sectionId) continue;
          
          // Special handling for different section naming structures
          // Some APIs use 'sections' or 'lecture' for primary sections
          let section = null;
          
          // Try to find the section in the type-specific array
          if (sectionData[type] && Array.isArray(sectionData[type])) {
            section = sectionData[type].find((s: any) => s.id === sectionId);
          }
          
          // If not found and it's a lecture, try the 'sections' array
          if (!section && type === 'lecture' && sectionData.sections && Array.isArray(sectionData.sections)) {
            section = sectionData.sections.find((s: any) => s.id === sectionId);
          }
          
          // If still not found, search all arrays for a section with matching ID
          if (!section) {
            for (const sectionType in sectionData) {
              if (Array.isArray(sectionData[sectionType])) {
                const possibleSection = sectionData[sectionType].find((s: any) => s.id === sectionId);
                if (possibleSection) {
                  section = possibleSection;
                  break;
                }
              }
            }
          }
          
          if (section) {
            // Process the days format to handle combined days like "MonWed"
            let processedDays = section.days || 'TBA';
            
            // Handle common combined day formats
            if (processedDays === 'MonWed') processedDays = 'Mon, Wed';
            if (processedDays === 'TueThu') processedDays = 'Tue, Thu';
            if (processedDays === 'WedFri') processedDays = 'Wed, Fri';
            if (processedDays === 'MonFri') processedDays = 'Mon, Fri';
            
            // If still not separated, try to split by capital letters
            if (!processedDays.includes(',') && !processedDays.includes(' ') && processedDays !== 'TBA') {
              processedDays = processedDays.replace(/([A-Z])/g, ', $1').replace(/^, /, '');
            }
            
            // Process the seats data - it might be in the format "10/20" as a string
            let seatsRegistered = 0;
            let seatsTotal = 0;
            
            if (typeof section.seats_taken === 'number') {
              seatsRegistered = section.seats_taken;
            } else if (section.seats && typeof section.seats === 'string') {
              const parts = section.seats.split('/');
              if (parts.length === 2) {
                seatsRegistered = parseInt(parts[0], 10) || 0;
                seatsTotal = parseInt(parts[1], 10) || 0;
              }
            }
            
            if (typeof section.seats === 'number') {
              seatsTotal = section.seats;
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
      })
      .filter(Boolean) as Array<{
        code: string;
        sections: Array<{
          type: string;
          days: string;
          time: string;
          instructor: string;
          location: string;
          seats_registered: number;
          seats_total: number;
        }>
      }>;
      
    return classes;
  }, [classSections, classSelections]);

  // Fetch professor ratings whenever schedule data changes
  useEffect(() => {
    const fetchProfessorRatings = async () => {
      const professorMap: Record<string, any> = {};
      
      // First pass: collect all professor names with their associated courses
      const professorCourseMap = new Map<string, string[]>();
      
      scheduleData.forEach((cls: any) => {
        if (!cls) return; // Skip null entries
        
        cls.sections.forEach((sec: any) => {
          const name = sec.instructor?.trim();
          if (!name || name.toLowerCase() === 'tba' || name === 'TBA') return; // Skip TBA instructors
          
          if (!professorCourseMap.has(name)) {
            professorCourseMap.set(name, [cls.code]);
          } else if (!professorCourseMap.get(name)?.includes(cls.code)) {
            professorCourseMap.get(name)?.push(cls.code);
          }
        });
      });
      
      // If no professors, return empty array
      if (professorCourseMap.size === 0) {
        setProfessorData([]);
        return;
      }
      
      // Second pass: fetch ratings for all professors in one request
      const professorList = Array.from(professorCourseMap.keys());
      const courseList: string[] = [];
      
      // For each professor, use their first course code (as a simplification)
      professorList.forEach(prof => {
        const courses = professorCourseMap.get(prof) || [];
        courseList.push(courses[0] || '');
      });
      
      try {
        // Clean professor names for query exactly like the backend does
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
        
        // Now we have ratings for all professors, process the schedule data
        scheduleData.forEach((cls: any) => {
          if (!cls) return;
          
          cls.sections.forEach((sec: any) => {
            const name = sec.instructor?.trim();
            if (!name || name.toLowerCase() === 'tba' || name === 'TBA') return;
            
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
            
            // Create or update professor data
            if (!professorMap[name]) {
              professorMap[name] = {
                name,
                classCodes: [cls.code],
                overallRating: ratings.quality || 3.5,
                courseRating: ratings.course_quality || ratings.quality || 3.5,
                difficulty: ratings.difficulty || 3.0,
                wouldTakeAgain: ratings.would_take_again || 70,
                _count: 1
              };
            } else {
              const prof = professorMap[name];
              if (!prof.classCodes.includes(cls.code)) {
                prof.classCodes.push(cls.code);
              }
              
              // Only update ratings if we have new ones and they're non-zero
              if (ratings && (ratings.quality || ratings.difficulty || ratings.would_take_again)) {
                // Update ratings with running average
                const count = prof._count + 1;
                prof.overallRating = runningAverage(prof.overallRating, ratings.quality || 3.5, count);
                prof.courseRating = runningAverage(prof.courseRating, 
                  (ratings.course_quality || ratings.quality || 3.5), count);
                prof.difficulty = runningAverage(prof.difficulty, ratings.difficulty || 3.0, count);
                prof.wouldTakeAgain = runningAverage(prof.wouldTakeAgain, 
                  ratings.would_take_again || 70, count);
                prof._count = count;
              }
            }
          });
        });
        
        // Remove the _count field from the final output
        setProfessorData(Object.values(professorMap).map(prof => {
          const { _count, ...rest } = prof as any;
          return rest;
        }));
        
      } catch (error: any) {
        console.error("Error fetching professor ratings:", error);
        
        // Fallback to defaults if API call fails
        scheduleData.forEach((cls: any) => {
          if (!cls) return;
          
          cls.sections.forEach((sec: any) => {
            const name = sec.instructor?.trim();
            if (!name || name.toLowerCase() === 'tba' || name === 'TBA') return;
            
            if (!professorMap[name]) {
              professorMap[name] = {
                name,
                classCodes: [cls.code],
                overallRating: 3.8,
                courseRating: 3.7,
                difficulty: 3.0,
                wouldTakeAgain: 80,
                _count: 1
              };
            } else {
              const prof = professorMap[name];
              if (!prof.classCodes.includes(cls.code)) {
                prof.classCodes.push(cls.code);
              }
            }
          });
        });
        
        // Remove the _count field from the final output
        setProfessorData(Object.values(professorMap).map(prof => {
          const { _count, ...rest } = prof as any;
          return rest;
        }));
      }
    };
    
    fetchProfessorRatings();
  }, [scheduleData]);

  // If no sections are selected, show a message
  if (scheduleData.length === 0) {
    return (
      <div className="mt-10 bg-white/10 rounded-lg p-6 text-center">
        <h3 className="text-xl font-semibold mb-2">Schedule Preview</h3>
        <p className="text-white/70">
          Your schedule will appear here as you select specific sections for your classes.
        </p>
      </div>
    );
  }
  
  // Handle saving the schedule
  const handleSaveSchedule = async (name: string) => {
    setIsSaving(true);
    setSaveError('');
    setSaveSuccess('');
    
    try {
      // Format data exactly in the required format
      const saveData = {
        schedules: [{
          classes: scheduleData.map((cls: any) => ({
            code: cls.code,
            sections: cls.sections
          }))
        }],
        classSpots: classSelections.map(cls => ({
          id: Math.random().toString(36).substring(2, 9),
          classes: [{
            classCode: cls.classCode,
            selectedSections: cls.selectedSections
          }]
        })),
        preferences: {}
      };
      
      await api.post('/api/schedules', {
        name,
        semester: '20253', // Fall 2025
        schedule_data: saveData
      });
      
      setSaveSuccess('Schedule saved successfully!');
      setTimeout(() => {
        setSaveModalOpen(false);
        setSaveSuccess('');
      }, 1500);
    } catch (err: any) {
      console.error('Error saving schedule:', err);
      setSaveError(err.response?.data?.message || 'Failed to save schedule');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mt-10">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">Schedule Preview</h3>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 rounded-lg p-4">
        {/* Calendar view */}
        <div className="lg:col-span-8">
          <ScheduleFrame classes={scheduleData} />
        </div>
        
        {/* Professor information */}
        <div className="lg:col-span-4">
          {professorData.length > 0 ? (
            <ProfessorFrame professors={professorData} />
          ) : (
            <div className="bg-white/10 rounded-lg p-4 text-center h-full flex items-center justify-center">
              <p className="text-white/70">
                Professor information will appear here when you select sections with assigned instructors.
              </p>
            </div>
          )}
        </div>
      </div>
      
      {/* Save Schedule Modal */}
      <SaveScheduleModal
        isOpen={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        onSave={handleSaveSchedule}
        isSaving={isSaving}
      />
      
      {/* Error/Success Messages */}
      {saveError && (
        <div className="mt-4 p-3 bg-red-800/30 border border-red-600 text-white rounded-lg">
          {saveError}
        </div>
      )}
      
      {saveSuccess && (
        <div className="mt-4 p-3 bg-green-800/30 border border-green-600 text-white rounded-lg">
          {saveSuccess}
        </div>
      )}
    </div>
  );
};

export default SchedulePreview;
