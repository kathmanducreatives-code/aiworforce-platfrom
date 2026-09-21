import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { greetingFor, greetingName, greetingVariantsFor, msUntilNextHour } from '@/lib/greeting';

const ROTATE_EVERY_MS = 7_500;

/**
 * The home page's one-line greeting: "Good afternoon, Prasidha".
 *
 * It stays true while the tab is left open — re-reading the clock at the top
 * of each hour, and whenever the tab comes back into view (a laptop that slept
 * through a timer wakes with the right phrase, not a stale one).
 */
export default function WorkforceGreeting() {
  const { profile } = useAuth();
  const [now, setNow] = useState(() => new Date());
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [motionAllowed, setMotionAllowed] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');

  useEffect(() => {
    const timer = window.setTimeout(() => setNow(new Date()), msUntilNextHour(now) + 1000);
    return () => window.clearTimeout(timer);
  }, [now]);

  useEffect(() => {
    const onVisible = () => {
      const nextVisible = document.visibilityState === 'visible';
      setVisible(nextVisible);
      if (nextVisible) setNow(new Date());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotionAllowed(!query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  const band = greetingFor(now);
  const variants = greetingVariantsFor(now);

  useEffect(() => setPhraseIndex(0), [band]);

  useEffect(() => {
    if (!motionAllowed || !visible) return;
    const timer = window.setInterval(() => setPhraseIndex((current) => (current + 1) % variants.length), ROTATE_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [motionAllowed, visible, variants]);

  const name = greetingName(profile?.full_name);
  const phrase = variants[phraseIndex % variants.length];
  return (
    <h1 className="team-greeting" aria-label={phrase.personal && name ? `${phrase.text}, ${name}` : phrase.text}>
      <span key={`${band}-${phraseIndex}`} className="team-greeting__phrase" aria-hidden="true">
        {phrase.text}
        {phrase.personal && name && <>, <span className="team-greeting__name">{name}</span></>}
      </span>
    </h1>
  );
}
