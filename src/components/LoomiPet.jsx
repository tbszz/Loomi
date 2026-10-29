import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { loomiMood, loomiPlan, settleMood } from '../loomiState.js';
import { reducedMotion } from '../motionHooks.jsx';
import './loomiPet.css';

const SIZE = 64;
const SCALE = SIZE / 120;
const legs = [
  ['L1', 'M37 64 L28 58', 37, 64], ['L2', 'M36 73 L26 75', 36, 73], ['L3', 'M40 82 L33 89', 40, 82],
  ['R1', 'M83 64 L92 58', 83, 64], ['R2', 'M84 73 L94 75', 84, 73], ['R3', 'M80 82 L87 89', 80, 82],
];
const web = [
  ...Array.from({ length: 8 }, (_, k) => `M60 70 L${polar(52, k)}`),
  ...[22, 36, 50].map(radius => 'M' + Array.from({ length: 9 }, (_, k) => polar(radius, k)).join(' L')),
];

function polar(radius, k) {
  const t = k * Math.PI / 4;
  return `${(60 + radius * Math.cos(t)).toFixed(1)} ${(70 + radius * Math.sin(t)).toFixed(1)}`;
}

function Leg([name, d, x, y]) {
  return <g key={name} className={`loomi-leg loomi-${name[0]} loomi-${name}`} style={{ transformOrigin: `${x}px ${y}px` }}><path className="loomi-limb" d={d} /></g>;
}

function Star({ x, y, s }) {
  return <path className="loomi-fill" d={`M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`} />;
}

// Rest sits on the composer's top edge; hang dangles beside the live run card.
function measure(layer, hang) {
  const box = layer.getBoundingClientRect();
  const composer = layer.parentElement?.querySelector('.aui-composer')?.getBoundingClientRect();
  if (!composer) return null;
  const rest = { x: composer.right - box.left - SIZE - 72, y: composer.top - box.top - 90 * SCALE + 2 };
  if (!hang) return rest;
  const card = layer.parentElement.querySelector('.aui-status')?.getBoundingClientRect();
  if (!card || card.bottom < box.top || card.top > composer.top) return { x: rest.x, y: rest.y - 64 };
  const outside = card.right - box.left + 10;
  return { x: outside + SIZE <= box.width - 4 ? outside : card.right - box.left - SIZE - 8, y: card.top - box.top - 6 };
}

export function LoomiPet({ pending, lastMessage }) {
  const typing = useAuiState(s => Boolean(s.composer.isEditing && s.composer.text.trim()));
  const target = loomiMood({ pending, typing, lastMessage });
  const [mood, setMood] = useState(target);
  const previous = useRef(target);
  useEffect(() => {
    if (previous.current === target) return;
    setMood(settleMood(previous.current, target));
    previous.current = target;
  }, [target]);

  const layer = useRef(null);
  const [step, setStep] = useState({ phase: mood === 'work' ? 'hang' : mood, hang: mood === 'work' });
  const [position, setPosition] = useState(null);
  const hangRef = useRef(step.hang);
  hangRef.current = step.hang;

  useEffect(() => {
    const plan = loomiPlan(mood, hangRef.current);
    if (reducedMotion()) { setStep(plan.at(-1)); return; }
    const timers = plan.map(next => setTimeout(() => setStep(next), next.at));
    return () => timers.forEach(clearTimeout);
  }, [mood]);

  useLayoutEffect(() => {
    const node = layer.current;
    if (!node) return;
    let frame;
    const update = () => {
      const next = measure(node, step.hang);
      setPosition(current => next && (current?.x !== next.x || current?.y !== next.y) ? next : current);
    };
    // The run card scrolls with the thread, so a hanging Loomi follows it frame by frame.
    const follow = () => { update(); frame = requestAnimationFrame(follow); };
    if (step.hang && step.phase !== 'travel') follow(); else update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [step.hang, step.phase]);

  const silk = step.hang || step.phase === 'travel' || step.phase === 'shoot';
  return <div ref={layer} className="loomi-layer" aria-hidden="true">
    {position ? <svg className="loomi" data-phase={step.phase} data-silk={silk} width={SIZE} height={SIZE} viewBox="0 0 120 120"
      style={{ transform: `translate(${Math.round(position.x)}px, ${Math.round(position.y)}px)` }}>
      <g className="loomi-all">
        <rect className="loomi-silk" x="59.5" y="-1200" width="1" height="1248" />
        <g className="loomi-web">{web.map(d => <path key={d} pathLength="1" d={d} />)}</g>
        <g className="loomi-body">
          {legs.filter(leg => leg[0][1] !== '1').map(Leg)}
          <g className="loomi-upper">
            {legs.filter(leg => leg[0][1] === '1').map(Leg)}
            <ellipse className="loomi-fill" cx="60" cy="70" rx="25" ry="22" />
            <circle className="loomi-eye" cx="56" cy="60" r="1.3" /><circle className="loomi-eye" cx="64" cy="60" r="1.3" />
            <g className="loomi-open"><g className="loomi-pupils">
              <ellipse className="loomi-eye" cx="51" cy="69" rx="3.6" ry="4.8" /><ellipse className="loomi-eye" cx="69" cy="69" rx="3.6" ry="4.8" />
            </g></g>
            <path className="loomi-happy" d="M47 70 Q51 64 55 70 M65 70 Q69 64 73 70" />
            <g className="loomi-bubble"><circle className="loomi-fill" cx="99" cy="33" r="10" /><rect className="loomi-eye" x="97.8" y="26" width="2.4" height="9" rx="1.2" /><circle className="loomi-eye" cx="99" cy="38.6" r="1.4" /></g>
          </g>
        </g>
        <g className="loomi-spark"><Star x={20} y={40} s={5} /><Star x={102} y={50} s={4} /><Star x={98} y={104} s={3} /></g>
      </g>
    </svg> : null}
  </div>;
}
