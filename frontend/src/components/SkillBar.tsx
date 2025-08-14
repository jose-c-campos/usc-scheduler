import React from 'react';

interface Props {
  label: string;
  value: number | undefined;
  maxValue: number;
  color: string;
  showAsPercentage?: boolean;
}

const SkillBar = ({ label, value, maxValue, color, showAsPercentage }: Props) => {
  /* ---------- guard against undefined / NaN ---------- */
  const safeValue = typeof value === 'number' && !isNaN(value) ? value : 0;

  const percent = Math.min(100, (safeValue / maxValue) * 100);

  return (
    <div className="text-white">
      <div className="flex justify-between text-[11px] mb-[2px] text-white">
        <span>{label}</span>
        <span>
          {showAsPercentage
            ? `${safeValue.toFixed(0)}%`
            : safeValue > 0
            ? safeValue.toFixed(1)
            : 'N/A'}
        </span>
      </div>

      <div className="h-[6px] w-full bg-white/20 rounded">
        <div
          style={{ width: `${percent}%` }}
          className={`h-full ${color} rounded`}
        />
      </div>
    </div>
  );
};

export default SkillBar;
