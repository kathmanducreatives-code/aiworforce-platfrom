import React from "react";

/* ================================================================
   ALL CSS — injected via <style> to support pseudo-elements,
   keyframes, hover states, and complex selectors that can't be
   done with inline styles.
   ================================================================ */
const STYLES = `
/* ─── OUTER SECTION ───────────────────────────────── */
.journey-section {
  position: relative;
  background-color: #04060d;
  background-image: radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px);
  background-size: 28px 28px;
}

/* ─── INTRO (not sticky) ──────────────────────────── */
.journey-intro {
  text-align: center;
  padding: 120px 40px 100px;
  position: relative;
  z-index: 5;
}

.intro-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #22c55e;
  background: rgba(34,197,94,0.08);
  border: 1px solid rgba(34,197,94,0.2);
  padding: 7px 18px;
  border-radius: 100px;
  margin-bottom: 32px;
}

.intro-label::before {
  content: '◆';
  font-size: 8px;
}

.intro-heading {
  font-size: clamp(44px, 6vw, 72px);
  font-weight: 800;
  line-height: 1.0;
  letter-spacing: -0.025em;
  margin-bottom: 24px;
}

.intro-heading .g1 { color: #fff; }
.intro-heading .g2 {
  background: linear-gradient(90deg, #818cf8, #2dd4bf);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.intro-sub {
  font-size: 17px;
  color: rgba(255,255,255,0.42);
  font-weight: 300;
  max-width: 520px;
  margin: 0 auto;
  line-height: 1.65;
}

/* ─── STICKY CARD STACK ───────────────────────────── */
.journey-cards {
  position: relative;
  height: calc(4 * 100vh + 600px);
}

.slot {
  position: sticky;
  top: 80px;
  height: calc(100vh - 80px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.slot-1 { z-index: 10; }
.slot-2 { z-index: 20; }
.slot-3 { z-index: 30; }
.slot-4 { z-index: 40; }

/* ─── THE CARD ────────────────────────────────────── */
.journey-card {
  width: 90%;
  max-width: 1180px;
  height: 560px;
  border-radius: 24px;
  border: 1px solid rgba(255,255,255,0.07);
  display: grid;
  grid-template-columns: 400px 1fr;
  overflow: hidden;
  position: relative;
  box-shadow: 0 30px 80px rgba(0,0,0,0.6);
  transition: transform 0.5s ease;
}

.journey-card-1 {
  background: #0d1117;
  background-image: radial-gradient(ellipse 65% 65% at 105% -5%, rgba(99,102,241,0.22) 0%, transparent 55%);
}
.journey-card-2 {
  background: #0d1117;
  background-image: radial-gradient(ellipse 65% 65% at 105% -5%, rgba(20,184,166,0.22) 0%, transparent 55%);
}
.journey-card-3 {
  background: #0d1117;
  background-image: radial-gradient(ellipse 65% 65% at 105% -5%, rgba(236,72,153,0.20) 0%, transparent 55%);
}
.journey-card-4 {
  background: #0d1117;
  background-image: radial-gradient(ellipse 65% 65% at 105% -5%, rgba(245,158,11,0.22) 0%, transparent 55%);
}

/* ─── LEFT COLUMN ─────────────────────────────────── */
.card-left {
  padding: 52px 44px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-right: 1px solid rgba(255,255,255,0.05);
}

.step-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 22px;
}

.step-badge {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.05em;
  padding: 4px 10px;
  border-radius: 6px;
}
.badge-indigo { background: rgba(99,102,241,0.15); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.3); }
.badge-teal   { background: rgba(20,184,166,0.15);  color: #5eead4; border: 1px solid rgba(20,184,166,0.3); }
.badge-rose   { background: rgba(236,72,153,0.15);  color: #fda4af; border: 1px solid rgba(236,72,153,0.3); }
.badge-amber  { background: rgba(245,158,11,0.15);  color: #fcd34d; border: 1px solid rgba(245,158,11,0.3); }

.step-icon { font-size: 28px; line-height: 1; }

.card-headline {
  font-size: 32px;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: #fff;
  margin-bottom: 14px;
}

.card-desc {
  font-size: 14px;
  color: rgba(255,255,255,0.48);
  line-height: 1.65;
  font-weight: 300;
  margin-bottom: 28px;
}

.bullets {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bullet {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-size: 13px;
  color: rgba(255,255,255,0.62);
  line-height: 1.5;
}

.bullet-check {
  flex-shrink: 0;
  margin-top: 1px;
  font-size: 12px;
}
.check-indigo { color: #818cf8; }
.check-teal   { color: #2dd4bf; }
.check-rose   { color: #fb7185; }
.check-amber  { color: #fbbf24; }

/* ─── RIGHT COLUMN ────────────────────────────────── */
.card-right {
  padding: 28px;
  display: flex;
  align-items: stretch;
  position: relative;
  overflow: hidden;
}

.ui-panel {
  flex: 1;
  background: rgba(255,255,255,0.025);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 16px;
  padding: 24px;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
}

/* ─── CARD 1: AVATAR CLOUD ────────────────────────── */
.avatar-cloud {
  position: relative;
  flex: 1;
}

.av {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.av-circle {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  border: 2px solid;
}

.av-label {
  font-size: 9px;
  color: rgba(255,255,255,0.35);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.av-dim .av-circle { opacity: 0.28; }
.av-dim .av-label  { opacity: 0.2; }

.profile-card {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 210px;
  background: rgba(99,102,241,0.08);
  border: 1px solid rgba(99,102,241,0.45);
  border-radius: 16px;
  padding: 20px;
  text-align: center;
  box-shadow: 0 0 40px rgba(99,102,241,0.2);
}

.profile-av {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: #4f46e5;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 800;
  margin: 0 auto 12px;
  border: 2px solid rgba(99,102,241,0.6);
}

.profile-name {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 3px;
}

.profile-title {
  font-size: 11px;
  color: rgba(255,255,255,0.45);
  margin-bottom: 12px;
}

.available-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(34,197,94,0.12);
  border: 1px solid rgba(34,197,94,0.3);
  color: #4ade80;
  font-size: 11px;
  padding: 4px 12px;
  border-radius: 100px;
}

.available-pill::before {
  content: '';
  width: 6px; height: 6px;
  background: #22c55e;
  border-radius: 50%;
  animation: pulse-dot 2s ease infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.7); }
}

/* ─── CARD 2: SCORECARD ───────────────────────────── */
.scorecard-header {
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(20,184,166,0.8);
  margin-bottom: 6px;
}

.scorecard-line {
  height: 1px;
  background: rgba(20,184,166,0.3);
  margin-bottom: 24px;
}

.skill-row {
  margin-bottom: 18px;
}

.skill-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 7px;
}

.skill-name {
  font-size: 13px;
  color: rgba(255,255,255,0.75);
}

.skill-score {
  font-size: 13px;
  font-weight: 700;
  color: #2dd4bf;
}
.skill-score.indigo { color: #818cf8; }

.bar-track {
  height: 6px;
  background: rgba(255,255,255,0.07);
  border-radius: 3px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 3px;
}
.fill-teal  { background: linear-gradient(90deg, #0d9488, #2dd4bf); }
.fill-indigo { background: linear-gradient(90deg, #4f46e5, #818cf8); }

.fit-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
  background: rgba(20,184,166,0.08);
  border: 1px solid rgba(20,184,166,0.35);
  border-radius: 100px;
  padding: 11px 20px;
  font-size: 13px;
  color: #2dd4bf;
  font-weight: 500;
  animation: glow-teal 2.5s ease infinite;
}

@keyframes glow-teal {
  0%, 100% { box-shadow: 0 0 0px rgba(20,184,166,0); }
  50% { box-shadow: 0 0 22px rgba(20,184,166,0.35); }
}

/* ─── CARD 3: INTERVIEW ───────────────────────────── */
.interview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 18px;
}

.ih-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ih-av {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: #0d9488;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.ih-name { font-size: 13px; font-weight: 600; color: #fff; }
.ih-role { font-size: 11px; color: rgba(255,255,255,0.4); }

.recording-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(236,72,153,0.1);
  border: 1px solid rgba(236,72,153,0.3);
  color: #fb7185;
  font-size: 10px;
  padding: 5px 11px;
  border-radius: 100px;
  white-space: nowrap;
}

.recording-pill::before {
  content: '';
  width: 6px; height: 6px;
  background: #f43f5e;
  border-radius: 50%;
  animation: pulse-dot 1.2s ease infinite;
}

.questions-label {
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(236,72,153,0.7);
  margin-bottom: 12px;
}

.q-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}

.q-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.q-num {
  font-size: 10px;
  color: rgba(236,72,153,0.7);
  font-weight: 600;
  flex-shrink: 0;
  margin-top: 1px;
  letter-spacing: 0.05em;
}

.q-bar {
  width: 2px;
  height: 18px;
  background: rgba(236,72,153,0.4);
  border-radius: 1px;
  flex-shrink: 0;
  margin-top: 1px;
}

.q-text {
  font-size: 12.5px;
  color: rgba(255,255,255,0.7);
  line-height: 1.5;
}

.stats-row {
  display: flex;
  gap: 7px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.stat-pill {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 100px;
  font-size: 11px;
  color: rgba(255,255,255,0.45);
  padding: 5px 13px;
}

/* ─── CARD 4: FEEDBACK ────────────────────────────── */
.feedback-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 16px;
}

.fh-av {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: #92400e;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
  flex-shrink: 0;
}

.avail-pill-sm {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(34,197,94,0.1);
  border: 1px solid rgba(34,197,94,0.25);
  color: #4ade80;
  font-size: 10px;
  padding: 4px 10px;
  border-radius: 100px;
}
.avail-pill-sm::before {
  content: '';
  width: 5px; height: 5px;
  background: #22c55e;
  border-radius: 50%;
}

.reviewer-block {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 16px;
}

.reviewer-top {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 10px;
}

.reviewer-av {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: #78350f;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
  flex-shrink: 0;
}

.reviewer-name { font-size: 12px; font-weight: 600; color: #fff; }
.reviewer-role { font-size: 10px; color: rgba(255,255,255,0.38); }

.reviewer-quote {
  font-size: 12px;
  color: rgba(255,255,255,0.62);
  font-style: italic;
  line-height: 1.55;
}

.stars-row {
  font-size: 22px;
  letter-spacing: 4px;
  color: #fbbf24;
  margin-bottom: 14px;
}

.rating-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.big-rating {
  font-size: 38px;
  font-weight: 800;
  color: #fbbf24;
  line-height: 1;
}

.top-badge {
  background: rgba(245,158,11,0.1);
  border: 1px solid rgba(245,158,11,0.3);
  color: #fcd34d;
  font-size: 11px;
  padding: 5px 12px;
  border-radius: 100px;
}

.request-btn {
  width: 100%;
  padding: 12px;
  background: transparent;
  border: 1px solid rgba(245,158,11,0.5);
  color: #fbbf24;
  border-radius: 100px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  letter-spacing: 0.02em;
  animation: glow-amber 1.5s ease infinite;
  transition: background 0.2s;
}

.request-btn:hover {
  background: rgba(245,158,11,0.08);
}

@keyframes glow-amber {
  0%, 100% { box-shadow: 0 0 8px rgba(245,158,11,0.25); }
  50% { box-shadow: 0 0 32px rgba(245,158,11,0.75); }
}
`;

/* ================================================================
   COMPONENT
   ================================================================ */
export const ExpertJourney = () => {
    return (
        <>
            <style>{STYLES}</style>

            <section className="journey-section">
                {/* ── Intro: NOT sticky, scrolls away normally ──── */}
                <div className="journey-intro">
                    <div className="intro-label">The Expert Journey</div>
                    <h2 className="intro-heading">
                        <span className="g1">From search to hire —<br /></span>
                        <span className="g2">every step, handled.</span>
                    </h2>
                    <p className="intro-sub">
                        Watch how we source, vet, interview, and rate every expert so you
                        never have to guess.
                    </p>
                </div>

                {/* ── THE CARD STACK CONTAINER ─────────────────── */}
                <div className="journey-cards">

                    {/* ── SLOT 1 ──────────────────────────────────── */}
                    <div className="slot slot-1">
                        <div className="journey-card journey-card-1">
                            <div className="card-left">
                                <div className="step-row">
                                    <span className="step-badge badge-indigo">01</span>
                                    <span className="step-icon">🔍</span>
                                </div>
                                <h3 className="card-headline">Finding Your Perfect Expert</h3>
                                <p className="card-desc">
                                    We scan our network of 12,000+ vetted professionals and
                                    surface the ones that match your exact requirement — skills,
                                    industry, timezone, and budget.
                                </p>
                                <div className="bullets">
                                    <div className="bullet">
                                        <span className="bullet-check check-indigo">✓</span>
                                        Verified credentials and work history
                                    </div>
                                    <div className="bullet">
                                        <span className="bullet-check check-indigo">✓</span>
                                        Real-time availability matching
                                    </div>
                                    <div className="bullet">
                                        <span className="bullet-check check-indigo">✓</span>
                                        Shortlisted in under 48 hours
                                    </div>
                                </div>
                            </div>

                            <div className="card-right">
                                <div className="ui-panel">
                                    <div className="avatar-cloud">
                                        {/* Scattered avatars - dimmed */}
                                        <div className="av av-dim" style={{ top: "4%", left: "8%" }}>
                                            <div className="av-circle" style={{ background: "rgba(59,130,246,0.2)", color: "#93c5fd", borderColor: "rgba(59,130,246,0.4)" }}>MK</div>
                                            <span className="av-label">Legal</span>
                                        </div>
                                        <div className="av av-dim" style={{ top: "2%", left: "38%" }}>
                                            <div className="av-circle" style={{ background: "rgba(168,85,247,0.2)", color: "#d8b4fe", borderColor: "rgba(168,85,247,0.4)" }}>SR</div>
                                            <span className="av-label">Finance</span>
                                        </div>
                                        <div className="av av-dim" style={{ top: "4%", right: "12%" }}>
                                            <div className="av-circle" style={{ background: "rgba(249,115,22,0.2)", color: "#fdba74", borderColor: "rgba(249,115,22,0.4)" }}>AT</div>
                                            <span className="av-label">Design</span>
                                        </div>
                                        <div className="av av-dim" style={{ top: "35%", left: "4%" }}>
                                            <div className="av-circle" style={{ background: "rgba(20,184,166,0.2)", color: "#5eead4", borderColor: "rgba(20,184,166,0.4)" }}>PL</div>
                                            <span className="av-label">DevOps</span>
                                        </div>
                                        <div className="av av-dim" style={{ top: "35%", right: "4%" }}>
                                            <div className="av-circle" style={{ background: "rgba(244,63,94,0.2)", color: "#fda4af", borderColor: "rgba(244,63,94,0.4)" }}>RC</div>
                                            <span className="av-label">Growth</span>
                                        </div>
                                        <div className="av av-dim" style={{ bottom: "20%", left: "8%" }}>
                                            <div className="av-circle" style={{ background: "rgba(245,158,11,0.2)", color: "#fcd34d", borderColor: "rgba(245,158,11,0.4)" }}>BN</div>
                                            <span className="av-label">Data</span>
                                        </div>
                                        <div className="av av-dim" style={{ bottom: "15%", left: "38%" }}>
                                            <div className="av-circle" style={{ background: "rgba(99,102,241,0.2)", color: "#a5b4fc", borderColor: "rgba(99,102,241,0.4)" }}>EW</div>
                                            <span className="av-label">UX</span>
                                        </div>
                                        <div className="av av-dim" style={{ bottom: "18%", right: "10%" }}>
                                            <div className="av-circle" style={{ background: "rgba(6,182,212,0.2)", color: "#67e8f9", borderColor: "rgba(6,182,212,0.4)" }}>FK</div>
                                            <span className="av-label">Ops</span>
                                        </div>

                                        {/* Central selected profile */}
                                        <div className="profile-card">
                                            <div className="profile-av">JD</div>
                                            <div className="profile-name">Jane Doe</div>
                                            <div className="profile-title">Senior AI Consultant</div>
                                            <div className="available-pill">Available Now</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── SLOT 2 ──────────────────────────────────── */}
                    <div className="slot slot-2">
                        <div className="journey-card journey-card-2">
                            <div className="card-left">
                                <div className="step-row">
                                    <span className="step-badge badge-teal">02</span>
                                    <span className="step-icon">🛡️</span>
                                </div>
                                <h3 className="card-headline">Screened Before You Ever See Them</h3>
                                <p className="card-desc">
                                    Every expert goes through rigorous technical and behavioural
                                    pre-screening. You receive a full scorecard — not just a CV.
                                </p>
                                <div className="bullets">
                                    <div className="bullet">
                                        <span className="bullet-check check-teal">✓</span>
                                        Technical skills verified by domain experts
                                    </div>
                                    <div className="bullet">
                                        <span className="bullet-check check-teal">✓</span>
                                        Behavioural and culture-fit assessment
                                    </div>
                                    <div className="bullet">
                                        <span className="bullet-check check-teal">✓</span>
                                        Transparent scoring with no black boxes
                                    </div>
                                </div>
                            </div>

                            <div className="card-right">
                                <div className="ui-panel">
                                    <div className="scorecard-header">Technical Scorecard</div>
                                    <div className="scorecard-line" />
                                    <div className="skill-row">
                                        <div className="skill-top">
                                            <span className="skill-name">System Design</span>
                                            <span className="skill-score">98/100</span>
                                        </div>
                                        <div className="bar-track"><div className="bar-fill fill-teal" style={{ width: "98%" }} /></div>
                                    </div>
                                    <div className="skill-row">
                                        <div className="skill-top">
                                            <span className="skill-name">Distributed Systems</span>
                                            <span className="skill-score">94/100</span>
                                        </div>
                                        <div className="bar-track"><div className="bar-fill fill-teal" style={{ width: "94%" }} /></div>
                                    </div>
                                    <div className="skill-row">
                                        <div className="skill-top">
                                            <span className="skill-name">Communication</span>
                                            <span className="skill-score indigo">91/100</span>
                                        </div>
                                        <div className="bar-track"><div className="bar-fill fill-indigo" style={{ width: "91%" }} /></div>
                                    </div>
                                    <div className="skill-row">
                                        <div className="skill-top">
                                            <span className="skill-name">Problem Solving</span>
                                            <span className="skill-score">96/100</span>
                                        </div>
                                        <div className="bar-track"><div className="bar-fill fill-teal" style={{ width: "96%" }} /></div>
                                    </div>
                                    <div className="fit-badge">
                                        ✦ &nbsp; Overall Fit Score: <strong>95%</strong>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── SLOT 3 ──────────────────────────────────── */}
                    <div className="slot slot-3">
                        <div className="journey-card journey-card-3">
                            <div className="card-left">
                                <div className="step-row">
                                    <span className="step-badge badge-rose">03</span>
                                    <span className="step-icon">🎙️</span>
                                </div>
                                <h3 className="card-headline">Interview Ready. Questions Done.</h3>
                                <p className="card-desc">
                                    We prepare the interview, record it, and analyze it for you.
                                    Every session is structured, scored, and stored — so your team
                                    can review on their own time.
                                </p>
                                <div className="bullets">
                                    <div className="bullet">
                                        <span className="bullet-check check-rose">✓</span>
                                        AI-generated role-specific questions
                                    </div>
                                    <div className="bullet">
                                        <span className="bullet-check check-rose">✓</span>
                                        Video recording saved and transcribed
                                    </div>
                                    <div className="bullet">
                                        <span className="bullet-check check-rose">✓</span>
                                        Sentiment and confidence analysis included
                                    </div>
                                </div>
                            </div>

                            <div className="card-right">
                                <div className="ui-panel">
                                    <div className="interview-header">
                                        <div className="ih-left">
                                            <div className="ih-av">JD</div>
                                            <div>
                                                <div className="ih-name">Jane Doe</div>
                                                <div className="ih-role">Senior AI Consultant</div>
                                            </div>
                                        </div>
                                        <div className="recording-pill">Recording Saved &amp; Analyzed</div>
                                    </div>
                                    <div className="questions-label">Questions Prepared</div>
                                    <div className="q-list">
                                        <div className="q-row">
                                            <span className="q-num">01</span>
                                            <div className="q-bar" />
                                            <span className="q-text">Walk me through a system you designed at scale.</span>
                                        </div>
                                        <div className="q-row">
                                            <span className="q-num">02</span>
                                            <div className="q-bar" />
                                            <span className="q-text">How do you handle conflicting stakeholder priorities?</span>
                                        </div>
                                        <div className="q-row">
                                            <span className="q-num">03</span>
                                            <div className="q-bar" />
                                            <span className="q-text">Describe your approach to debugging in production.</span>
                                        </div>
                                        <div className="q-row">
                                            <span className="q-num">04</span>
                                            <div className="q-bar" />
                                            <span className="q-text">What's your experience with cross-functional AI deployment?</span>
                                        </div>
                                    </div>
                                    <div className="stats-row">
                                        <span className="stat-pill">Duration: 42 min</span>
                                        <span className="stat-pill">Transcript: Ready</span>
                                        <span className="stat-pill">Confidence: High</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── SLOT 4 ──────────────────────────────────── */}
                    <div className="slot slot-4">
                        <div className="journey-card journey-card-4">
                            <div className="card-left">
                                <div className="step-row">
                                    <span className="step-badge badge-amber">04</span>
                                    <span className="step-icon">⭐</span>
                                </div>
                                <h3 className="card-headline">Transparent Feedback. Zero Guesswork.</h3>
                                <p className="card-desc">
                                    After every engagement, both sides leave structured feedback.
                                    Ratings are verified, disputes are mediated, and the record
                                    follows the expert's profile permanently.
                                </p>
                                <div className="bullets">
                                    <div className="bullet">
                                        <span className="bullet-check check-amber">✓</span>
                                        Verified post-project reviews only
                                    </div>
                                    <div className="bullet">
                                        <span className="bullet-check check-amber">✓</span>
                                        Client and expert mutual ratings
                                    </div>
                                    <div className="bullet">
                                        <span className="bullet-check check-amber">✓</span>
                                        Dispute resolution included
                                    </div>
                                </div>
                            </div>

                            <div className="card-right">
                                <div className="ui-panel">
                                    <div className="feedback-header">
                                        <div className="ih-left">
                                            <div className="fh-av">JD</div>
                                            <div>
                                                <div className="ih-name">Jane Doe</div>
                                                <div className="ih-role">Senior AI Consultant</div>
                                            </div>
                                        </div>
                                        <div className="avail-pill-sm">Available</div>
                                    </div>
                                    <div className="reviewer-block">
                                        <div className="reviewer-top">
                                            <div className="reviewer-av">MT</div>
                                            <div>
                                                <div className="reviewer-name">Mark T.</div>
                                                <div className="reviewer-role">CTO at Vercel</div>
                                            </div>
                                        </div>
                                        <div className="reviewer-quote">
                                            "Jane delivered an exceptional architecture review — 3 days
                                            ahead of schedule. Will hire again."
                                        </div>
                                    </div>
                                    <div className="stars-row">★★★★★</div>
                                    <div className="rating-row">
                                        <span className="big-rating">
                                            4.9<span style={{ fontSize: 22, opacity: 0.5 }}> / 5.0</span>
                                        </span>
                                        <span className="top-badge">Top 3% of Platform</span>
                                    </div>
                                    <button className="request-btn">Request Expert →</button>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>{/* /journey-cards */}
            </section>
        </>
    );
};

export default ExpertJourney;
