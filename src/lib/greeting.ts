// THE HOME GREETING — what the dashboard says to the person, by local time.
//
//   05:00–11:59  Good morning
//   12:00–16:59  Good afternoon
//   17:00–21:59  Good evening
//   22:00–04:59  Working late
//
// PURE. The clock is an input, so every band edge is testable.

export type GreetingPhrase = 'Good morning' | 'Good afternoon' | 'Good evening' | 'Working late';

export interface GreetingVariant {
  text: string;
  personal: boolean;
}

const ROTATIONS: Record<GreetingPhrase, readonly GreetingVariant[]> = {
  'Good morning': [
    { text: 'Good morning', personal: true },
    { text: 'Your team is ready.', personal: false },
    { text: 'Start with the signal.', personal: false },
    { text: 'Make the first move count.', personal: false },
  ],
  'Good afternoon': [
    { text: 'Good afternoon', personal: true },
    { text: 'Your team is still moving.', personal: false },
    { text: 'The signal is getting clearer.', personal: false },
    { text: 'Make the next move count.', personal: false },
  ],
  'Good evening': [
    { text: 'Good evening', personal: true },
    { text: 'Your team kept watch.', personal: false },
    { text: 'The signal is ready.', personal: false },
    { text: 'One clear move from here.', personal: false },
  ],
  'Working late': [
    { text: 'Working late', personal: true },
    { text: 'Your team is standing by.', personal: false },
    { text: 'Keep the next move simple.', personal: false },
    { text: 'One last clear decision.', personal: false },
  ],
};

export function greetingFor(now: Date): GreetingPhrase {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  if (h >= 17 && h < 22) return 'Good evening';
  return 'Working late';
}

/** Curated, time-aware home copy. The first line remains the familiar greeting. */
export function greetingVariantsFor(now: Date): readonly GreetingVariant[] {
  return ROTATIONS[greetingFor(now)];
}

/**
 * The name to greet: the first word of the profile name, first letter raised
 * ("prasidha" → "Prasidha"). Null when there is no name — the greeting then
 * stands alone rather than inventing one.
 */
export function greetingName(fullName: string | null | undefined): string | null {
  const first = String(fullName ?? '').trim().split(/\s+/)[0];
  if (!first) return null;
  return first.charAt(0).toLocaleUpperCase() + first.slice(1);
}

/** Milliseconds until the next hour begins — the only moment a phrase can change. */
export function msUntilNextHour(now: Date): number {
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 0, 0);
  return next.getTime() - now.getTime();
}
