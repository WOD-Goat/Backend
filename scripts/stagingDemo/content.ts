/** The demo programs' workouts: raw WODs, so no exercise library entry is needed. */

export interface DemoWorkoutContent {
  dayNumber: number;
  title: string;
  wods: { name: string; rawText: string }[];
}

const lines = (...text: string[]): string => text.join('\n');

/** Day of the program for a 1-based week and day of week. */
const day = (week: number, dayOfWeek: number): number => (week - 1) * 7 + dayOfWeek;

interface Session {
  title: string;
  main: string;
  mainText: string;
  metconText: string;
}

function toWorkout(dayNumber: number, week: number, session: Session): DemoWorkoutContent {
  return {
    dayNumber,
    title: `W${week} ${session.title}`,
    wods: [
      { name: session.main, rawText: session.mainText },
      { name: 'Metcon', rawText: session.metconText },
    ],
  };
}

/** Rest on days 4 and 7 of every week. */
export function strengthWorkouts(weeks = 6): DemoWorkoutContent[] {
  return Array.from({ length: weeks }, (_, index) => {
    const week = index + 1;
    const pct = 65 + index * 4;
    const reps = week <= 2 ? 5 : week <= 4 ? 4 : 3;
    const sessions: [number, Session][] = [
      [1, {
        title: 'Back Squat',
        main: 'Strength',
        mainText: lines(`Back squat 5 x ${reps} @ ${pct}% 1RM`, 'Rest 2:30 between sets'),
        metconText: lines('For time:', '21-15-9', 'Thrusters (43/30 kg)', 'Pull-ups', 'Time cap 10 min'),
      }],
      [2, {
        title: 'Bench Press',
        main: 'Strength',
        mainText: lines(`Bench press 5 x ${reps} @ ${pct}% 1RM`, 'Superset: 10 ring rows'),
        metconText: lines(`AMRAP ${10 + week} min:`, '10 push-ups', '15 kettlebell swings (24/16 kg)', '200 m run'),
      }],
      [3, {
        title: 'Deadlift',
        main: 'Strength',
        mainText: lines(`Deadlift 4 x ${reps} @ ${pct}% 1RM`, 'Rest 3:00 between sets'),
        metconText: lines('5 rounds for time:', '12 box jumps (60/50 cm)', '9 toes-to-bar', '250 m row'),
      }],
      [5, {
        title: 'Strict Press',
        main: 'Strength',
        mainText: lines(`Strict press 5 x ${reps} @ ${pct}% 1RM`, 'Then push press 3 x 5'),
        metconText: lines('EMOM 16 min:', 'Odd: 12/10 cal bike', 'Even: 10 dumbbell snatches (22.5/15 kg)'),
      }],
      [6, {
        title: 'Olympic Lifting + Engine',
        main: 'Weightlifting',
        mainText: lines(`Power clean + front squat: 6 x (2 + 1) @ ${pct - 5}%`),
        metconText: lines('For time:', '1000 m row', '50 wall balls (9/6 kg)', '30 burpees over the bar'),
      }],
    ];
    return sessions.map(([dayOfWeek, session]) => toWorkout(day(week, dayOfWeek), week, session));
  }).flat();
}

/** Written week by week: only the first `weeksWritten` weeks. Rest on days 4 and 7. */
export function engineWorkouts(weeksWritten: number): DemoWorkoutContent[] {
  return Array.from({ length: weeksWritten }, (_, index) => {
    const week = index + 1;
    const sessions: [number, Session][] = [
      [1, {
        title: 'Row Intervals',
        main: 'Engine',
        mainText: lines(`${4 + week} x 500 m row`, 'Rest 1:30, hold the same split'),
        metconText: lines('AMRAP 8 min:', '8 burpees', '16 air squats'),
      }],
      [2, {
        title: 'Aerobic Chipper',
        main: 'Skill',
        mainText: lines('10 min double-under practice'),
        metconText: lines('For time:', '800 m run', '40 kettlebell swings', '30 box jumps', '20 pull-ups', '800 m run'),
      }],
      [3, {
        title: 'Bike Pyramid',
        main: 'Engine',
        mainText: lines('Assault bike 1-2-3-2-1 min hard', 'Rest equals work'),
        metconText: lines(`${2 + week} rounds:`, '12 hang power cleans (40/27.5 kg)', '12 push jerks', '12 bar-facing burpees'),
      }],
      [5, {
        title: 'Tempo Run',
        main: 'Engine',
        mainText: lines(`${2 + week} x 800 m run at 5K pace`, 'Rest 2:00'),
        metconText: lines('Tabata x 2:', 'Sit-ups', 'Hollow rocks'),
      }],
      [6, {
        title: 'Partner-Style Grinder',
        main: 'Warm-up',
        mainText: lines('3 rounds: 200 m jog, 10 inchworms, 10 PVC pass-throughs'),
        metconText: lines('AMRAP 20 min:', '15/12 cal row', '12 wall balls', '9 handstand push-ups'),
      }],
    ];
    return sessions.map(([dayOfWeek, session]) => toWorkout(day(week, dayOfWeek), week, session));
  }).flat();
}

/** Seven days with one rest day (day 4). */
export function kickstartWorkouts(): DemoWorkoutContent[] {
  const sessions: [number, string, string][] = [
    [1, 'Foundations', lines('3 rounds for time:', '400 m run', '15 air squats', '10 push-ups')],
    [2, 'Hinge Day', lines('AMRAP 12 min:', '10 kettlebell deadlifts', '10 sit-ups', '200 m row')],
    [3, 'Pull Day', lines('For time:', '30-20-10', 'Ring rows', 'Jumping lunges')],
    [5, 'Press Day', lines('EMOM 15 min:', '1: 12 dumbbell presses', '2: 15 box step-ups', '3: 40 s plank')],
    [6, 'Mixed Modal', lines('5 rounds:', '12 cal bike', '10 goblet squats', '8 burpees')],
    [7, 'Benchmark', lines('"Cindy", AMRAP 20 min:', '5 pull-ups', '10 push-ups', '15 air squats')],
  ];
  return sessions.map(([dayNumber, title, rawText]) => ({
    dayNumber,
    title,
    wods: [{ name: 'Metcon', rawText }],
  }));
}
