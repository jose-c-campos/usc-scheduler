import React, { useMemo, useState, useEffect } from 'react';
import axios from 'axios';
import ScheduleFrame from './ScheduleFrame';
import ProfessorFrame from './ProfessorFrame';
import type { ClassSectionSelection } from './ClassSpot';

interface SchedulePreviewProps {
  classSections: Record<string, any>;
  classSelections: ClassSectionSelection[];
}

// Helper for running averages - copied from Scheduler.tsx
const runningAverage = (oldVal: number, newVal: number, n: number) =>
  (oldVal * (n - 1) + newVal) / n;

const SchedulePreview = ({ classSections, classSelections }: SchedulePreviewProps) => {
  // State to hold professor data after async fetch
  const [professorData, setProfessorData] = useState<any[]>([]);

  // Transform class selections into the format expected by ScheduleFrame
  const scheduleData = useMemo(() => {
    console.log("Raw class selections:", classSelections);
    console.log("Available class sections data:", classSections);

    const classes = classSelections
      .filter(cls => cls.classCode && Object.keys(cls.selectedSections).length > 0)
      .map(cls => {
        const sections = [];
        const sectionData = classSections[cls.classCode];
        
        console.log(`Processing class: ${cls.classCode}`, {
          selectedSections: cls.selectedSections,
          availableSectionData: sectionData
        });
        
        if (!sectionData) return null;
        
        // Add each selected section (lecture, lab, discussion, etc.)
        for (const [type, sectionId] of Object.entries(cls.selectedSections)) {
          console.log(`Processing section type: ${type}, sectionId: ${sectionId}`);
          
          if (!sectionId) continue;
          
          // Special handling for different section naming structures
          // Some APIs use 'sections' or 'lecture' for primary sections
          let section = null;
          
          // Try to find the section in the type-specific array
          if (sectionData[type] && Array.isArray(sectionData[type])) {
            section = sectionData[type].find((s: any) => s.id === sectionId);
            console.log(`Found section in ${type} array:`, section);
          }
          
          // If not found and it's a lecture, try the 'sections' array
          if (!section && type === 'lecture' && sectionData.sections && Array.isArray(sectionData.sections)) {
            section = sectionData.sections.find((s: any) => s.id === sectionId);
            console.log(`Found lecture in 'sections' array:`, section);
          }
          
          // If still not found, search all arrays for a section with matching ID
          if (!section) {
            for (const sectionType in sectionData) {
              if (Array.isArray(sectionData[sectionType])) {
                const possibleSection = sectionData[sectionType].find((s: any) => s.id === sectionId);
                if (possibleSection) {
                  console.log(`Found section with ID ${sectionId} in ${sectionType} array:`, possibleSection);
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
          } else {
            console.log(`Could not find section with ID ${sectionId} for type ${type}`);
          }
        }
        
        console.log(`Final sections for ${cls.classCode}:`, sections);
        
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
      
    console.log("Schedule data for preview:", classes);
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
        const response = await axios.get('http://localhost:3001/api/professor-ratings', {
          params: {
            professors: professorList.join(','),
            courses: courseList.join(',')
          }
        });
        
        console.log("Professor ratings API response:", response.data);
        
        // Now we have ratings for all professors, process the schedule data
        scheduleData.forEach((cls: any) => {
          if (!cls) return;
          
          cls.sections.forEach((sec: any) => {
            const name = sec.instructor?.trim();
            if (!name || name.toLowerCase() === 'tba' || name === 'TBA') return;
            
            const ratings = response.data[name] || {
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
        
      } catch (error) {
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

  return (
    <div className="mt-10">
      <h3 className="text-xl font-semibold mb-4">Schedule Preview</h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-white/5 rounded-lg p-4">
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
    </div>
  );
};

export default SchedulePreview;
