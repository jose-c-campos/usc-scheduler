import { FaCheck } from "react-icons/fa";

interface PreferencePanelProps {
  preferences: {
    timeOfDay: string[];
    daysOff: string[];
    classLength: string;
    avoidLabs: boolean;
    avoidDiscussions: boolean;
    excludeFullSections: boolean;
  };
  updatePreference: (key: string, value: any) => void;
}

const TIME_OPTIONS = ["morning", "afternoon", "evening"];
const DAY_OPTIONS  = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const CLASS_LENGTH_OPTIONS = [
  { id: "shorter-frequent",     label: "Shorter & Frequent" },
  { id: "longer-less-frequent", label: "Longer & Less Frequent" },
];
const MAX_DAYS_OFF = 4;

const PreferencePanel = ({ preferences, updatePreference }: PreferencePanelProps) => {
  const handlePreferenceChange = (key: string, value: any) =>
    updatePreference(key, value);

  const toggleTimeOfDay = (option: string) => {
    let newArr = preferences.timeOfDay.includes(option)
      ? preferences.timeOfDay.filter(t => t !== option)
      : [...preferences.timeOfDay, option];
    if (newArr.length > 2) newArr = newArr.slice(1);
    handlePreferenceChange("timeOfDay", newArr);
  };

  const toggleDayOff = (day: string) => {
    let newArr = preferences.daysOff.includes(day)
      ? preferences.daysOff.filter(d => d !== day)
      : [...preferences.daysOff, day];
    if (newArr.length > MAX_DAYS_OFF) newArr = newArr.slice(1);
    handlePreferenceChange("daysOff", newArr);
  };
  return (
    <div className="space-y-8">
      {/* Time of Day */}
      <div>
        <h3 className="font-bold text-white mb-2">Time of Day <span className="text-xs font-normal text-zinc-400">(Choose up to 2)</span></h3>
        <div className="flex flex-col gap-2">
          {TIME_OPTIONS.map(option => (
            <label key={option} className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
              <span
                className={`w-5 h-5 flex items-center justify-center border-2 rounded bg-transparent transition-colors
                  ${preferences.timeOfDay.includes(option) ? "border-usc-red bg-usc-red" : "border-zinc-400"}
                `}
                onClick={() => toggleTimeOfDay(option)}
                tabIndex={0}
                role="checkbox"
                aria-checked={preferences.timeOfDay.includes(option)}
              >
                {preferences.timeOfDay.includes(option) && <FaCheck className="text-white text-xs" />}
              </span>
              <span className="capitalize">{option}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Days Off */}
      <div>
        <h3 className="font-bold text-white mb-2">Preferred Days Off <span className="text-xs font-normal text-zinc-400">(Max 4)</span></h3>
        <div className="flex flex-col gap-2">
          {DAY_OPTIONS.map(day => (
            <label key={day} className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
              <span
                className={`w-5 h-5 flex items-center justify-center border-2 rounded bg-transparent transition-colors
                  ${preferences.daysOff.includes(day) ? "border-usc-red bg-usc-red" : "border-zinc-400"}
                `}
                onClick={() => toggleDayOff(day)}
                tabIndex={0}
                role="checkbox"
                aria-checked={preferences.daysOff.includes(day)}
              >
                {preferences.daysOff.includes(day) && <FaCheck className="text-white text-xs" />}
              </span>
              <span>{day}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Class Length */}
      <div>
        <h3 className="font-bold text-white mb-2">Class Length</h3>
        <div className="flex flex-col gap-2">
          {CLASS_LENGTH_OPTIONS.map(option => (
            <label key={option.id} className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
              <span
                className={`w-5 h-5 flex items-center justify-center border-2 rounded-full bg-transparent transition-colors
                  ${preferences.classLength === option.id ? "border-usc-red bg-usc-red" : "border-zinc-400"}
                `}
                onClick={() => updatePreference("classLength", option.id)}
                tabIndex={0}
                role="radio"
                aria-checked={preferences.classLength === option.id}
              >
                {preferences.classLength === option.id && <span className="w-2.5 h-2.5 rounded-full bg-white" />}
              </span>
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Avoid Labs & Discussions */}
      <div>
        <h3 className="font-bold text-white mb-2">Section Type</h3>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
            <span
              className={`w-5 h-5 flex items-center justify-center border-2 rounded bg-transparent transition-colors
                ${preferences.avoidLabs ? "border-usc-red bg-usc-red" : "border-zinc-400"}
              `}
              onClick={() => updatePreference("avoidLabs", !preferences.avoidLabs)}
              tabIndex={0}
              role="checkbox"
              aria-checked={preferences.avoidLabs}
            >
              {preferences.avoidLabs && <FaCheck className="text-white text-xs" />}
            </span>
            Avoid Labs
          </label>
          <label className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
            <span
              className={`w-5 h-5 flex items-center justify-center border-2 rounded bg-transparent transition-colors
                ${preferences.avoidDiscussions ? "border-usc-red bg-usc-red" : "border-zinc-400"}
              `}
              onClick={() => updatePreference("avoidDiscussions", !preferences.avoidDiscussions)}
              tabIndex={0}
              role="checkbox"
              aria-checked={preferences.avoidDiscussions}
            >
              {preferences.avoidDiscussions && <FaCheck className="text-white text-xs" />}
            </span>
            Avoid Discussions
          </label>
        </div>
      </div>

      {/* New preference: Exclude Full Sections */}
      <div>
        <h3 className="font-bold text-white mb-2">Availability</h3>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
            <span
              className={`w-5 h-5 flex items-center justify-center border-2 rounded bg-transparent transition-colors
                ${preferences.excludeFullSections ? "border-usc-red bg-usc-red" : "border-zinc-400"}
              `}
              onClick={() => updatePreference("excludeFullSections", !preferences.excludeFullSections)}
              tabIndex={0}
              role="checkbox"
              aria-checked={preferences.excludeFullSections}
            >
              {preferences.excludeFullSections && <FaCheck className="text-white text-xs" />}
            </span>
            Only Show Available Sections
          </label>
        </div>
      </div>
    </div>
  );
};

export default PreferencePanel;