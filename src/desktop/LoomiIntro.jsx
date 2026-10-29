import React, { useCallback, useEffect, useRef, useState } from 'react';
import LoomiFigure from './LoomiFigure.jsx';
import { INTRO_DURATION, INTRO_PHASES, hasPlayedIntro, introDuration, markIntroPlayed, shouldSkipIntro } from './introTimeline.js';
import { useReducedMotion } from './useReducedMotion.js';
import './desktopTheme.css';
import './loomiIntro.css';

export default function LoomiIntro({ onDone }) {
  const reduced = useReducedMotion();
  const [played] = useState(hasPlayedIntro);
  const [phase, setPhase] = useState('silk');
  const finished = useRef(false);
  const callback = useRef(onDone);
  callback.current = onDone;
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    markIntroPlayed();
    callback.current?.();
  }, []);

  useEffect(() => {
    if (played) { finish(); return; }
    const timers = reduced ? [] : INTRO_PHASES.slice(1).map(step => setTimeout(() => setPhase(step.name), step.start));
    timers.push(setTimeout(finish, introDuration(reduced)));
    const onKey = event => {
      if (shouldSkipIntro(event)) { event.preventDefault(); finish(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { timers.forEach(clearTimeout); window.removeEventListener('keydown', onKey); };
  }, [finish, played, reduced]);

  if (played) return null;
  const mood = reduced ? 'idle' : ({ silk: 'idle', arrival: 'submitting', hello: 'hello', weave: 'weave', handoff: 'success' }[phase]);
  return <div className="rp-desktop loomi-intro" data-phase={phase} data-reduced={reduced} onClick={finish} style={{ '--intro-duration': `${INTRO_DURATION}ms` }}>
    <div className="desktop-drag-region" aria-hidden="true" />
    <div className="intro-wash" />
    <div className="intro-thread" aria-hidden="true" />
    <div className="intro-traveler"><LoomiFigure mood={mood} /></div>
    <div className="intro-title">
      <div className="desktop-wordmark">Resume Protocol<sup>®</sup></div>
      <p>每一段经历，都有新的可能。</p>
    </div>
    <span className="desktop-sr-only" role="status">Loomi 正在迎接你。按 Esc、Enter 或空格跳过。</span>
    <button className="intro-skip" type="button" onClick={event => { event.stopPropagation(); finish(); }}>跳过 <span aria-hidden="true">↗</span></button>
  </div>;
}
