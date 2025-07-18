import { useState } from 'react';

const PreferenceButton = () => {
  const [showPreferences, setShowPreferences] = useState(false);
  const [preferences, setPreferences] = useState({
    timeOfDay: 'no-preference', // morning, afternoon, evening, no-preference
    daysOff: [] as string[],
    avoidDiscussions: false
  });

  const togglePreferences = () => {
    setShowPreferences(!showPreferences);
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPreferences({...preferences, timeOfDay: e.target.value});
  };

  const toggleDayOff = (day: string) => {
    setPreferences({
      ...preferences, 
      daysOff: preferences.daysOff.includes(day) 
        ? preferences.daysOff.filter(d => d !== day) 
        : [...preferences.daysOff, day]
    });
  };

  const toggleAvoidDiscussions = () => {
    setPreferences({
      ...preferences,
      avoidDiscussions: !preferences.avoidDiscussions
    });
  };

  return (
    <div className="preferences-container">
      <button 
        className="preferences-toggle-button"
        onClick={togglePreferences}
      >
        {showPreferences ? "Hide Preferences" : "Show Preferences"}
      </button>

      {showPreferences && (
        <div className="preferences-panel">
          <div className="preference-group">
            <label>Preferred Time of Day:</label>
            <select 
              value={preferences.timeOfDay}
              onChange={handleTimeChange}
            >
              <option value="no-preference">No Preference</option>
              <option value="morning">Morning Classes</option>
              <option value="afternoon">Afternoon Classes</option>
              <option value="evening">Evening Classes</option>
            </select>
          </div>

          <div className="preference-group">
            <label>Preferred Days Off:</label>
            <div className="days-checkboxes">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(day => (
                <label key={day} className="day-checkbox">
                  <input
                    type="checkbox"
                    checked={preferences.daysOff.includes(day)}
                    onChange={() => toggleDayOff(day)}
                  />
                  {day}
                </label>
              ))}
            </div>
          </div>

          <div className="preference-group">
            <label className="avoid-discussions-checkbox">
              <input
                type="checkbox"
                checked={preferences.avoidDiscussions}
                onChange={toggleAvoidDiscussions}
              />
              Avoid Discussions When Possible
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default PreferenceButton;