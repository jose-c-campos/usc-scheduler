import React, { useMemo } from 'react';

interface AnimScheduleFrameProps {
  classes: Array<{
    code: string;
    sections: Array<{
      type: string;
      days: string;
      time: string;
      instructor: string;
      seats_registered?: number;
      seats_total?: number;
    }>;
  }>;
  minHeight?: number;
}

const CLASS_COLORS = [
  'bg-yellow-400',
  'bg-blue-400',
  'bg-green-400',
  'bg-purple-400',
  'bg-pink-400',
  'bg-cyan-400',
  'bg-orange-400',
  'bg-lime-400',
];

const ROW_PX = 6;
const START_HOUR = 6;
const END_HOUR = 22;
const ROWS_PER_HOUR = 4;

const AnimScheduleFrame: React.FC<AnimScheduleFrameProps> = ({ classes, minHeight = 520 }) => {
  const timeSlots = useMemo(() => {
    const out: string[] = [];
    for (let h = START_HOUR; h <= END_HOUR; ++h) {
      const display = h > 12 ? h - 12 : h;
      const meridian = h >= 12 ? 'pm' : 'am';
      out.push(`${display}${meridian}`);
    }
    return out;
  }, []);

  function tokensFromDays(raw: string): string[] {
    return raw.replace(/[{}]/g, '').replace(/-/g, ',').split(/[, ]+/).filter(Boolean);
  }

  function normaliseToken(tok: string): string {
    const map: Record<string, string> = {
      Monday: 'M', Mon: 'M', M: 'M',
      Tuesday: 'T', Tue: 'T', Tu: 'T', T: 'T',
      Wednesday: 'W', Wed: 'W', W: 'W',
      Thursday: 'Th', Thu: 'Th', Th: 'Th',
      Friday: 'F', Fri: 'F', F: 'F',
    };
    return map[tok] ?? '';
  }

  const getDayColumns = (raw: string): number[] => {
    const tokens = tokensFromDays(raw).map(normaliseToken).filter(Boolean);
    const COL_MAP: Record<string, number> = { M: 2, T: 3, W: 4, Th: 5, F: 6 };
    return [...new Set(tokens)].map(t => COL_MAP[t]).filter(Boolean).sort();
  };

  const getTimePosition = (timeStr: string) => {
    if (!timeStr || timeStr === 'TBA') return { start: 2, span: 4 };
    const [startStr, endStr] = timeStr.split('-');
    const parse = (s: string) => {
      const m = s.trim().match(/(\d+):(\d+)\s*(am|pm)/i);
      if (!m) return null;
      let h = (+m[1] % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
      return { h, m: +m[2] };
    };
    const s = parse(startStr);
    const e = parse(endStr);
    if (!s || !e) return { start: 2, span: 4 };
    const row = (p: { h: number; m: number }) => (p.h - START_HOUR) * ROWS_PER_HOUR + Math.floor(p.m / 15) + 2;
    const start = row(s);
    const end = Math.max(start + 1, row(e) + 1);
    return { start, span: end - start };
  };

  const totalRows = (END_HOUR - START_HOUR + 1) * ROWS_PER_HOUR;

  return (
    <div className="bg-white/10 rounded-lg p-1 overflow-x-auto">
      <div
        className="grid grid-cols-[30px,repeat(5,1fr)] gap-0.5"
        style={{
          gridTemplateRows: `auto repeat(${totalRows}, ${ROW_PX}px)`,
          minHeight: `${minHeight}px`,
        }}
      >
        <div />
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
          <div key={d} className="py-1 text-center font-bold text-sm text-white">
            {d}
          </div>
        ))}

        {timeSlots.map((t, i) => (
          <React.Fragment key={t}>
            <div
              className="text-xs pr-0 row-span-4 flex items-start justify-end -translate-y-1.5 text-white"
              style={{ gridRow: `${i * ROWS_PER_HOUR + 2} / span 4`, gridColumn: 1 }}
            >
              {t}
            </div>
            <div
              className="col-span-5 border-t border-white/20"
              style={{ gridRow: `${i * ROWS_PER_HOUR + 2}`, gridColumn: '2 / span 5' }}
            />
          </React.Fragment>
        ))}

        {classes.map((cls, idx) =>
          cls.sections.map((sec, sIdx) => {
            const cols = getDayColumns(sec.days);
            const { start, span } = getTimePosition(sec.time);
            return cols.map((col, dIdx) => (
              <div
                key={`${idx}-${sIdx}-${dIdx}`}
                className={`${CLASS_COLORS[idx % CLASS_COLORS.length]} rounded-md text-gray-800 p-0.5 flex flex-col text-[0.6rem] shadow overflow-hidden truncate ${
                  sec.seats_registered !== undefined &&
                  sec.seats_total !== undefined &&
                  sec.seats_registered >= sec.seats_total ?
                    'ring-2 ring-red-600 ring-opacity-80' : ''
                }`}
                style={{ gridColumn: col, gridRow: `${start} / span ${span}`, zIndex: 10 }}
                data-course-code={cls.code}
              >
                <span className="font-bold truncate text-[0.55rem] -mb-0.5">{cls.code}</span>
                <div className="truncate text-[0.5rem] -mb-0.5">
                  {sec.type && sec.type.charAt(0).toUpperCase() + sec.type.slice(1).toLowerCase()}{' '}
                  {sec.seats_registered !== undefined && sec.seats_total !== undefined && (
                    <span className={sec.seats_registered >= sec.seats_total ? 'font-bold text-red-700' : ''}>
                      {sec.seats_registered}/{sec.seats_total}
                    </span>
                  )}
                </div>
                {sec.instructor && (
                  <div className="truncate text-[0.5rem]">{sec.instructor}</div>
                )}
              </div>
            ));
          })
        )}
      </div>
    </div>
  );
};

export default AnimScheduleFrame;
