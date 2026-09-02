/**
 * SCROLL SYSTEM — one camera for the whole landing page.
 *
 * Before this, every scroll-controlled section invented its own geometry:
 *
 *   ExpertJourney      sticky top:0, height 100vh,  end '+=500%',  scrub 1.2
 *   MeetTheTeam        sticky top:0, h-screen,      280vh track,   custom rAF
 *   ProductScreening   pin top top,  h-screen,      end '+=1850',  scrub 1.1
 *   ProductLookalike   pin top top,  h-screen,      end '+=1400',  scrub 1.2
 *
 * Two consequences. First, every one of them composed inside the *full*
 * viewport while a 76px header sits fixed on top of it, so content centred
 * behind the navbar — measured at every scroll position on the page, the
 * topmost content box was at y≈12 or negative. Second, two sections ended
 * their pins in absolute pixels (`+=1850`, `+=1400`), so how long a section
 * held depended on the height of the reader's screen, while the sections
 * beside them used viewport-relative ends.
 *
 * Everything scroll-related now reads its numbers from here.
 */

/** Height of the fixed header. It shrinks to ~59px once scrolled; the larger
 *  resting value is used so nothing is ever crowded at the top of the page. */
export const NAV_OFFSET = 76;

/**
 * The frame every major section composes inside: the viewport minus the
 * navbar. `svh` rather than `vh` so mobile browser chrome collapsing does not
 * make pinned sections jump or clip.
 */
export const FRAME_HEIGHT = `calc(100svh - ${NAV_OFFSET}px)`;

/** Scrub smoothing. Was 1.1 / 1.2 / 1.2 across three components. */
export const SCRUB = 1.1;

/**
 * How far a pinned section holds, expressed in viewport heights so the pace
 * is identical on every screen. One "scene" is one screenful of reading.
 */
export const pinEnd = (scenes: number) => `+=${Math.round(scenes * 100)}%`;

/** A single-scene demo holds for a little under two screens of scrolling. */
export const DEMO_SCENES = 1.8;

/** Entrance motion for non-pinned sections. Small and restrained. */
export const ENTER_DISTANCE = 24;
export const ENTER_DURATION = 0.5;

/**
 * One reveal trigger for every `whileInView` section. Previously these varied
 * between `-50px`, `-30px`, `amount: 0.1` and a bare `once: true`, which is
 * why sections started animating at visibly different points.
 */
export const SECTION_VIEWPORT = { once: true, amount: 0.2 } as const;

/** The matching transition, so entrances share one timing. */
export const SECTION_ENTER = {
  initial: { opacity: 0, y: ENTER_DISTANCE },
  whileInView: { opacity: 1, y: 0 },
  viewport: SECTION_VIEWPORT,
  transition: { duration: ENTER_DURATION, ease: [0.22, 1, 0.36, 1] as const },
};
