import React from 'react';
import './loomiFigure.css';

// Mirrors the canonical LoomiPet.jsx drawing. Merge with it once that lands.
// Keep its 120×120 geometry, six limbs, eyes, squint, stars and web in sync.
const legs = [
  ['L1', 'M37 64 L28 58', 37, 64], ['L2', 'M36 73 L26 75', 36, 73], ['L3', 'M40 82 L33 89', 40, 82],
  ['R1', 'M83 64 L92 58', 83, 64], ['R2', 'M84 73 L94 75', 84, 73], ['R3', 'M80 82 L87 89', 80, 82],
];
function polar(radius, k) {
  const t = k * Math.PI / 4;
  return `${(60 + radius * Math.cos(t)).toFixed(1)} ${(70 + radius * Math.sin(t)).toFixed(1)}`;
}
const web = [
  ...Array.from({ length: 8 }, (_, k) => `M60 70 L${polar(52, k)}`),
  ...[22, 36, 50].map(radius => 'M' + Array.from({ length: 9 }, (_, k) => polar(radius, k)).join(' L')),
];
function Star({ x, y, s }) {
  return <path className="lf-fill" d={`M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`} />;
}
function Leg({ leg: [name, d, x, y] }) {
  return <g className={`lf-leg lf-${name[0]} lf-${name}`} style={{ transformOrigin: `${x}px ${y}px` }}><path className="lf-limb" d={d} /></g>;
}

export default function LoomiFigure({ mood = 'idle', gaze = 0, silk = false, className = '' }) {
  return <svg className={`loomi-figure ${className}`} data-mood={mood} data-silk={silk} viewBox="0 0 120 120" aria-hidden="true" focusable="false" style={{ '--lf-gaze': `${gaze}px` }}>
    <g className="lf-all">
      <rect className="lf-silk" x="59.5" y="-1200" width="1" height="1248" />
      <g className="lf-web">{web.map(d => <path key={d} pathLength="1" d={d} />)}</g>
      <g className="lf-body">
        {legs.filter(leg => leg[0][1] !== '1').map(leg => <Leg key={leg[0]} leg={leg} />)}
        <g className="lf-upper">
          {legs.filter(leg => leg[0][1] === '1').map(leg => <Leg key={leg[0]} leg={leg} />)}
          <ellipse className="lf-fill" cx="60" cy="70" rx="25" ry="22" />
          <circle className="lf-eye" cx="56" cy="60" r="1.3" /><circle className="lf-eye" cx="64" cy="60" r="1.3" />
          <g className="lf-open"><g className="lf-pupils">
            <ellipse className="lf-eye" cx="51" cy="69" rx="3.6" ry="4.8" /><ellipse className="lf-eye" cx="69" cy="69" rx="3.6" ry="4.8" />
          </g></g>
          <path className="lf-happy" d="M47 70 Q51 64 55 70 M65 70 Q69 64 73 70" />
          <g className="lf-bubble"><circle className="lf-fill" cx="99" cy="33" r="10" /><rect className="lf-eye" x="97.8" y="26" width="2.4" height="9" rx="1.2" /><circle className="lf-eye" cx="99" cy="38.6" r="1.4" /></g>
          {/* Foreground poses of the same two front legs, crossing over the eyes. */}
          <g className="lf-cover">
            <path className="lf-cover-leg lf-cover-left" d="M37 64 Q41 56 46 64 L54 72" />
            <path className="lf-cover-leg lf-cover-right" d="M83 64 Q79 56 74 64 L66 72" />
          </g>
        </g>
      </g>
      <g className="lf-spark"><Star x={20} y={40} s={5} /><Star x={102} y={50} s={4} /><Star x={98} y={104} s={3} /></g>
    </g>
  </svg>;
}
