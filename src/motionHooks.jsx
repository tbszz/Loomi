import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motionDuration } from './motionState.js';

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const exitDuration = () => reducedMotion() ? 0 : motionDuration(getComputedStyle(document.documentElement).getPropertyValue('--dur-base'));
export const waitForMotion = () => new Promise(resolve => setTimeout(resolve, exitDuration()));

// Keep exits visible but inert; never retain a live control or status role.
export function usePresence(visible) {
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) { setMounted(true); return; }
    const timer = setTimeout(() => setMounted(false), exitDuration());
    return () => clearTimeout(timer);
  }, [visible]);
  return { mounted: visible || mounted, closing: !visible };
}

export function Presence({ visible, children, className = '' }) {
  const { mounted, closing } = usePresence(visible);
  const last = useRef(children);
  if (visible) last.current = children;
  return mounted ? <div className={`motion-presence ${className}`} data-closing={closing} aria-hidden={closing || undefined} inert={closing || undefined}>{last.current}</div> : null;
}

export function Crossfade({ identity, children }) {
  const previous = useRef({ identity, children });
  const [outgoing, setOutgoing] = useState(null);
  useEffect(() => {
    if (previous.current.identity !== identity) setOutgoing(previous.current);
    previous.current = { identity, children };
  }, [identity, children]);
  return <span className="motion-crossfade">{outgoing && <span className="motion-crossfade-out" aria-hidden="true" onAnimationEnd={() => setOutgoing(null)}>{outgoing.children}</span>}<span key={identity}>{children}</span></span>;
}

// Animate only the composer's border when autosizing changes its actual rows.
// Text and the caret remain still, including throughout IME composition.
export function useComposerSize(input, composing) {
  useLayoutEffect(() => {
    const composer = input.current?.closest('.aui-composer');
    if (!composer) return;
    let previous = composer.getBoundingClientRect().height;
    let animation;
    const observer = new ResizeObserver(() => {
      const height = composer.getBoundingClientRect().height;
      if (height !== previous && !reducedMotion() && !composing.current) {
        animation?.cancel();
        animation = composer.animate([{ transform: `scaleY(${previous / height})` }, { transform: 'scaleY(1)' }], {
          duration: exitDuration(), easing: getComputedStyle(composer).getPropertyValue('--ease-out').trim(), pseudoElement: '::before',
        });
      }
      previous = height;
    });
    observer.observe(composer);
    return () => { observer.disconnect(); animation?.cancel(); };
  }, []);
}

// One plate per group; geometry is measured only on layout/interaction/resize.
export function MotionGroup({ as: Tag = 'div', selector = 'button', activeKey, children, className = '', ...props }) {
  const host = useRef(null);
  const [plate, setPlate] = useState(null);
  const follow = element => {
    const group = host.current;
    if (!group || !element || !group.contains(element)) { setPlate(null); return; }
    const bounds = group.getBoundingClientRect();
    const row = element.getBoundingClientRect();
    setPlate({ '--plate-x': `${row.left - bounds.left + group.scrollLeft}px`, '--plate-y': `${row.top - bounds.top + group.scrollTop}px`, width: row.width, height: row.height });
  };
  const restore = () => follow(host.current?.querySelector(`${selector}.active, ${selector}[aria-selected="true"]`));
  useLayoutEffect(() => {
    restore();
    const observer = new ResizeObserver(restore);
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, [activeKey, children]);
  return <Tag {...props} ref={host} className={`motion-group ${className}`} onPointerOver={event => follow(event.target.closest(selector))} onPointerLeave={restore} onFocusCapture={event => follow(event.target.closest(selector))} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) restore(); }}>
    <span aria-hidden="true" className="motion-plate" style={plate || { opacity: 0 }} />{children}
  </Tag>;
}

export function MotionDetails({ children, className = '' }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const timer = useRef(null);
  const frame = useRef(null);
  useEffect(() => () => { clearTimeout(timer.current); cancelAnimationFrame(frame.current); }, []);
  const [summary, ...body] = React.Children.toArray(children);
  return <details className={`motion-details ${className}`} open={open} data-expanded={expanded}>
    {React.cloneElement(summary, { onClick: event => {
      event.preventDefault(); clearTimeout(timer.current); cancelAnimationFrame(frame.current);
      if (expanded) { setExpanded(false); timer.current = setTimeout(() => setOpen(false), exitDuration()); }
      else {
        const details = event.currentTarget.parentElement;
        setOpen(true);
        frame.current = requestAnimationFrame(() => {
          details.querySelector('.motion-disclosure').getBoundingClientRect();
          setExpanded(true);
        });
      }
    } })}
    <div className="motion-disclosure" inert={!expanded || undefined}><div>{body}</div></div>
  </details>;
}

export function MotionRecord({ children, onRemove }) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <div className="motion-record" data-closing={leaving} inert={leaving || undefined}><div><fieldset>{children}<button type="button" onClick={() => { setLeaving(true); timer.current = setTimeout(onRemove, exitDuration()); }}>移除这条经历</button></fieldset></div></div>;
}
