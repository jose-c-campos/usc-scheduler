import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

interface SavedSchedule {
  id: number;
  name: string;
  semester: string;
  schedule_data: any;
  created_at: string;
  updated_at: string;
}

const Profile = () => {
  const { user, isAuthenticated, loading } = useAuth();
  const [savedSchedules, setSavedSchedules] = useState<SavedSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        const response = await axios.get('/api/schedules/user');
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
      await axios.delete(`/api/schedules/${scheduleId}`);
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

  if (loading || !isAuthenticated) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-80px)]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-usc-red"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">My Profile</h1>
        <p className="text-white/70">
          Welcome back, <span className="text-usc-red font-semibold">{user?.name}</span>
        </p>
      </div>

      <div className="bg-gray-900/50 rounded-lg p-6 mb-8">
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

      <div className="bg-gray-900/50 rounded-lg p-6">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {savedSchedules.map((schedule) => (
              <div key={schedule.id} className="border border-white/10 rounded-lg p-4 hover:border-usc-red/50 transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-lg font-medium text-white">{schedule.name}</h3>
                  <div className="text-xs bg-gray-700 text-white/80 px-2 py-1 rounded">
                    {schedule.semester}
                  </div>
                </div>
                <p className="text-sm text-white/60 mb-4">
                  Created on {new Date(schedule.created_at).toLocaleDateString()}
                </p>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleLoadSchedule(schedule)}
                    className="px-3 py-1 bg-usc-red text-white text-sm rounded hover:bg-red-800 transition-colors"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => handleDeleteSchedule(schedule.id)}
                    className="px-3 py-1 bg-transparent border border-white/30 text-white text-sm rounded hover:border-red-500 hover:text-red-500 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Profile;
