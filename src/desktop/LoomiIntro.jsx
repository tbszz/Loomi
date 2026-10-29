import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import LoomiFigure from './LoomiFigure.jsx';
import { borderGeometry, cornerWebPaths, hasPlayedIntro, introDuration, introFrame, markIntroPlayed, shouldSkipIntro } from './introTimeline.js';
import { useReducedMotion } from './useReducedMotion.js';
import './desktopTheme.css';
import './loomiIntro.css';

export default function LoomiIntro({ onDone }) {
  const reduced = useReducedMotion();
  const [played] = useState(hasPlayedIntro);
  const root = useRef(null), stage = useRef(null), traveler = useRef(null);
  const wash = useRef(null), border = useRef(null), thread = useRef(null), shadow = useRef(null);
  const web = useRef([]), geometry = useRef(null);
  const finished = useRef(false), callback = useRef(onDone);
  callback.current = onDone;
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    markIntroPlayed();
    callback.current?.();
  }, []);

  useLayoutEffect(() => {
    if (played) { finish(); return; }
    const login = document.querySelector('[inert] .desktop-login');
    const card = login?.querySelector('.login-card');
    const pet = login?.querySelector('.login-loomi');
    const corner = login?.querySelector('.login-corner-web');
    const figure = traveler.current.querySelector('.loomi-figure');
    const groups = [
      [login?.querySelector('.login-heading'), 'heading'],
      [login?.querySelector('.login-mode'), 'heading'],
      ...Array.from(login?.querySelectorAll('.login-field') || [], (node, i) => [node, i ? 'password' : 'email']),
      [login?.querySelector('.login-submit'), 'button'],
      [login?.querySelector('.login-footer'), 'button'],
    ].filter(([node]) => node);
    // The shell owns inert/aria-hidden. Restore borrowed styles on every exit,
    // including skip, unmount and React StrictMode's effect cleanup.
    const borrowed = [login, corner, ...groups.map(([node]) => node)].filter(Boolean);
    const originals = borrowed.map(node => [node, node.style.opacity, node.style.transform]);
    let raf, elapsed = 0, disposed = false;
    const start = performance.now();
    const duration = introDuration(reduced);

    function paint(time) {
      if (disposed || !geometry.current) return;
      if (reduced) {
        const opacity = 1 - Math.min(1, time / duration);
        stage.current.style.transform = 'none';
        traveler.current.style.transform = 'none';
        figure.dataset.mood = 'intro';
        figure.style.setProperty('--lf-squash', 0);
        figure.style.setProperty('--lf-tuck', 0);
        figure.style.setProperty('--lf-crawl', '0deg');
        figure.style.setProperty('--lf-eye-scale', 1);
        wash.current.style.opacity = opacity;
        traveler.current.style.opacity = opacity;
        if (login) login.style.opacity = 1 - opacity;
        return;
      }
      const frame = introFrame(time, geometry.current), loomi = frame.loomi;
      root.current.dataset.phase = frame.phase;
      stage.current.style.transform = `translate(${frame.camera.x}px, ${frame.camera.y}px) scale(${frame.camera.scale})`;
      traveler.current.style.transform = `translate(${loomi.x}px, ${loomi.y}px) scale(${loomi.scale}) rotate(${loomi.rotation}deg)`;
      figure.dataset.mood = loomi.mood;
      figure.style.setProperty('--lf-tuck', loomi.tuck);
      figure.style.setProperty('--lf-squash', loomi.squash);
      figure.style.setProperty('--lf-crawl', `${loomi.crawl}deg`);
      figure.style.setProperty('--lf-eye-scale', loomi.eyeScale);
      border.current.style.strokeDashoffset = 1 - frame.border.progress;
      border.current.style.opacity = frame.border.opacity;
      thread.current.setAttribute('x1', frame.thread.x);
      thread.current.setAttribute('x2', frame.thread.x);
      thread.current.setAttribute('y1', frame.thread.y1);
      thread.current.setAttribute('y2', frame.thread.y2);
      thread.current.style.opacity = frame.thread.opacity;
      shadow.current.setAttribute('transform', `translate(${frame.shadow.x} ${frame.shadow.y}) scale(${frame.shadow.scale})`);
      shadow.current.style.opacity = frame.shadow.opacity;
      web.current.forEach((node, i) => { node.style.strokeDashoffset = 1 - frame.web.progress[i]; });
      wash.current.style.opacity = 1 - frame.reveal.background;
      if (login) login.style.opacity = frame.reveal.background;
      if (corner) corner.style.opacity = '0';
      groups.forEach(([node, key]) => {
        const opacity = frame.reveal[key];
        node.style.opacity = opacity;
        node.style.transform = `translateY(${10 * (1 - opacity)}px)`;
      });
    }

    function measure() {
      const width = window.innerWidth, height = window.innerHeight;
      const rect = card?.getBoundingClientRect() || { left: (width - 400) / 2, top: (height - 330) / 2, width: 400, height: 330 };
      const resting = pet?.getBoundingClientRect();
      const webRect = corner?.getBoundingClientRect() || { left: rect.left + rect.width - 105, top: rect.top, width: 105, height: 75 };
      geometry.current = { width, height, card: rect, border: borderGeometry(rect),
        rest: resting && { x: resting.left + resting.width / 2, y: resting.top + resting.height * 70 / 120, width: resting.width } };
      root.current.querySelectorAll('.intro-silk-layer').forEach(svg => svg.setAttribute('viewBox', `0 0 ${width} ${height}`));
      border.current.setAttribute('d', geometry.current.border.path);
      cornerWebPaths(webRect).forEach((path, i) => web.current[i].setAttribute('d', path));
      paint(elapsed);
    }

    measure();
    const observer = new ResizeObserver(measure);
    [card, pet, corner, login].filter(Boolean).forEach(node => observer.observe(node));
    window.addEventListener('resize', measure);
    function tick(now) {
      elapsed = Math.min(duration, now - start);
      paint(elapsed);
      if (elapsed >= duration) finish();
      else if (!finished.current) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    // Hidden hosts may throttle rAF. Paint the exact rest pose before finishing.
    const timer = setTimeout(() => { paint(duration); finish(); }, duration);
    const onKey = event => {
      if (shouldSkipIntro(event)) { event.preventDefault(); finish(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf); clearTimeout(timer); observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('keydown', onKey);
      originals.forEach(([node, opacity, transform]) => { node.style.opacity = opacity; node.style.transform = transform; });
    };
  }, [finish, played, reduced]);

  if (played) return null;
  return <div ref={root} className="rp-desktop loomi-intro" data-phase="peek" data-reduced={reduced} onClick={finish}>
    <div className="desktop-drag-region" aria-hidden="true" />
    <div ref={wash} className="intro-wash" />
    <div ref={stage} className="intro-stage" aria-hidden="true">
      <svg className="intro-silk-layer">
        <ellipse ref={shadow} className="intro-shadow" cx="0" cy="0" rx="34" ry="5" />
        <line ref={thread} className="intro-thread" />
        <path ref={border} className="intro-border" pathLength="1" />
      </svg>
      <div ref={traveler} className="intro-traveler"><div className="intro-figure"><LoomiFigure mood="intro" /></div></div>
    </div>
    <svg className="intro-silk-layer intro-corner-web" aria-hidden="true">
      {Array.from({ length: 11 }, (_, i) => <path key={i} ref={node => { web.current[i] = node; }} pathLength="1" />)}
    </svg>
    <span className="desktop-sr-only" role="status">Loomi 正在迎接你。按 Esc、Enter 或空格跳过。</span>
    <button className="intro-skip" type="button" onClick={event => { event.stopPropagation(); finish(); }}>跳过 <span aria-hidden="true">↗</span></button>
  </div>;
}
