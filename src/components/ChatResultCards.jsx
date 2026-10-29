import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, BriefcaseBusiness, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Printer, WandSparkles, X } from "lucide-react";
import { formatJobPoolSummary, normalizeResultItems } from "../chatResults.js";
import { genieSlice, opaqueGenieSurface } from "../genieEffect.js";
import "../results-motion.css";

const staggerStyle = (index) => ({ "--result-index": Math.min(index, 7) });
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function ResultStats({ items }) {
  const present = items.filter(item => item.value !== null && item.value !== undefined && item.value !== '' && Number.isFinite(Number(item.value)));
  if (!present.length) return null;
  return <div className="result-stats">{present.map(item => <div className="result-stat" key={item.label}><strong>{item.value}{item.suffix ? <small>{item.suffix}</small> : null}</strong><span>{item.label}</span></div>)}</div>;
}

export function MessageResult({ message, context, onSelectJob, onCopyResume, onPrintResume }) {
  const data = message.data || {};
  if (message.kind === "diagnosis") return <DiagnosisResult data={data} context={context} />;
  if (message.kind === "jobs") return <JobsResult data={data} selectedJob={context?.selectedJob} onSelect={onSelectJob} />;
  if (message.kind === "resume") return <ResumeResult variant={data.variant} onCopy={onCopyResume} onPrint={onPrintResume} />;
  if (message.kind === "interview") return <InterviewResult plan={data.plan} />;
  if (message.kind === "target") return <TargetResult job={data.job} />;
  if (message.kind === "error") return <div className="inline-error">上下文已保留，可以重新发送这条指令。</div>;
  return null;
}

function DiagnosisResult({ data, context }) {
  const strengths = normalizeResultItems(data.strengths);
  const gaps = normalizeResultItems(data.gaps || data.missing);
  const annotations = Array.isArray(data.annotations) ? data.annotations : [];
  const materialStatus = data.materialStatus || data.parseStatus || null;
  const status = materialStatus?.status || "";
  const completeness = data.completeness === null || data.completeness === undefined ? NaN : Number(data.completeness);
  const statusCompleteness = materialStatus?.completeness === null || materialStatus?.completeness === undefined ? NaN : Number(materialStatus.completeness);
  const displayCompleteness = Number.isFinite(completeness) ? completeness : statusCompleteness;
  const hasKnownCompleteness = status === "parsed" && Number.isFinite(displayCompleteness);
  const hasReadableEvidence = status === "parsed" || strengths.length > 0 || annotations.length > 0;
  return (
    <div className="result-panel diagnosis-panel result-motion">
      <header>
        <div>
          <span>RESUME DIAGNOSIS · 资料诊断</span>
          <small>{diagnosisStatusLabel(materialStatus, hasReadableEvidence)}</small>
        </div>
        {!hasKnownCompleteness ? <strong className="diagnosis-state">未形成结论</strong> : null}
      </header>
      {hasReadableEvidence ? <ResultStats items={[
        { label: 'COMPLETENESS · 完整度', value: hasKnownCompleteness ? Math.round(displayCompleteness) : null, suffix: '%' },
        { label: 'EVIDENCE · 已识别证据', value: Array.isArray(data.strengths) ? strengths.length : null },
        { label: 'GAPS · 待补充', value: Array.isArray(data.gaps || data.missing) ? gaps.length : null },
      ]} /> : null}
      {!hasReadableEvidence ? <DiagnosisPending gaps={gaps} status={materialStatus} /> : null}
      {hasReadableEvidence ? <DiagnosisEvidence annotations={annotations} strengths={strengths} gaps={gaps} status={materialStatus} /> : null}
    </div>
  );
}

function DiagnosisPending({ gaps, status }) {
  return (
    <section className="diagnosis-summary pending">
      <h3>还不能诊断简历内容</h3>
      <p>{status?.message || "我只确认文件已经进入资料库；在读到姓名、经历、项目或技能等原文证据前，不展示完整度，也不把通用字段清单当作结论。"}</p>
      <div className="diagnosis-next">
        <span>下一步</span>
        <p>{gaps.length ? "优先处理可读取文本和关键经历证据。" : "重新上传可复制文本的 PDF/DOCX，或直接粘贴简历正文。"}</p>
      </div>
    </section>
  );
}

function DiagnosisEvidence({ annotations, strengths, gaps, status }) {
  return (
    <>
      <section className="diagnosis-summary">
        <h3>已读取到可用证据</h3>
        <p>{status?.message || (annotations.length ? `已定位 ${annotations.length} 条原文证据批注，后续改写会沿用这些来源。` : "已从原文中识别到简历结构，后续建议会继续以材料为边界。")}</p>
      </section>
      <ResultList title="已识别证据" items={strengths} positive />
      <ResultList title="下一步补充" items={gaps} />
    </>
  );
}

function diagnosisStatusLabel(status, hasReadableEvidence) {
  if (status?.status === "parsed") return "基于已读取的简历原文";
  if (status?.status === "needs_review") return "文件已保存，读取结果需要核对";
  if (status?.status === "unreadable") return "文件已保存，未读取到可用文本";
  return hasReadableEvidence ? "基于已读取的简历原文" : "文件已保存，等待可靠读取";
}

function JobsResult({ data, selectedJob, onSelect }) {
  const jobs = data.jobs || [];
  const uncertainties = data.uncertainties || [];
  const related = data.related || [];
  const rejected = data.rejected || jobs.filter((job) => job.eligibility?.status === "rejected");
  const visibleJobs = jobs.filter((job) => job.eligibility?.status !== "rejected");
  const poolSummary = formatJobPoolSummary({ ...data, jobs: visibleJobs, uncertainties, related, rejected });
  if (!visibleJobs.length && !uncertainties.length && !related.length && !rejected.length) return null;
  return (
    <div className="result-panel jobs-panel">
      <header><span>JOB DISCOVERY · 岗位候选</span><small>{poolSummary || "不符硬性条件的岗位不作为推荐"}</small></header>
      <ResultStats items={[
        { label: 'JOBS · 本页候选', value: Array.isArray(data.jobs) ? visibleJobs.length : null },
        { label: 'RELATED · 相关岗位', value: Array.isArray(data.related) ? related.length : null },
        { label: 'REJECTED · 不符条件', value: Array.isArray(data.rejected) || rejected.length ? rejected.length : null },
      ]} />
      {visibleJobs.length ? <JobDeck jobs={visibleJobs} selectedJob={selectedJob} onSelect={onSelect} /> : <p className="job-empty">没有发现硬性条件明确匹配的岗位。</p>}
      <JobNotes title="待核实" items={uncertainties} />
      <JobNotes title="仅正文提及关键词（标题非该岗位，仅供参考）" items={related} collapsed />
      <JobNotes title="不符条件" items={rejected} rejected />
    </div>
  );
}

function realJobScore(job) {
  const fitScore = job.fitScore ?? job.opportunityScore ?? job.matchScore;
  return fitScore !== null && fitScore !== undefined && fitScore !== '' && Number.isFinite(Number(fitScore)) ? fitScore : null;
}

function JobDeck({ jobs, selectedJob, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(null);
  const strips = useRef([]);
  const origin = useRef(null);
  const moreId = useId();
  const open = (index) => {
    strips.current.forEach(strip => strip?.removeAttribute('data-receiving'));
    origin.current = strips.current[index];
    setActive({ index });
  };
  const strip = (job, index) => <JobCard key={job.id || `${index}-${job.title}`} job={job} index={index}
    selected={Boolean(selectedJob && (selectedJob === job || (job.id != null && selectedJob.id === job.id)))}
    opened={active?.index === index} buttonRef={node => { strips.current[index] = node; }}
    onOpen={() => open(index)} onKeyDown={event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const count = expanded ? jobs.length : Math.min(jobs.length, 5);
      strips.current[(index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count]?.focus();
    }} />;
  return <>
    <div className="job-list">
      {jobs.slice(0, 5).map(strip)}
      {jobs.length > 5 ? <>
        <div id={moreId} className="job-deck-more" data-expanded={expanded} aria-hidden={!expanded} inert={!expanded}>
          <div className="job-deck-more-inner">{jobs.slice(5).map((job, index) => strip(job, index + 5))}</div>
        </div>
        <button type="button" className="job-deck-toggle" aria-controls={moreId} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          {expanded ? '收起' : `+${jobs.length - 5} MORE · 展开全部`}
        </button>
      </> : null}
    </div>
    {active && jobs[active.index] ? <JobDetailWindow jobs={jobs} active={active} selectedJob={selectedJob} onSelect={onSelect}
      strips={strips} origin={origin.current} onSwitch={index => {
        if (index >= 5) setExpanded(true);
        setActive(value => ({ ...value, index }));
      }} onClose={() => setActive(null)} /> : null}
  </>;
}

function JobCard({ job, index, selected, opened, buttonRef, onOpen, onKeyDown }) {
  const status = job.eligibility?.status || "verify";
  const score = realJobScore(job);
  return <div className={`job-row job-card ${status}` + (selected ? " selected" : "")}
    data-open={opened} style={{ '--row-index': index }}>
    <button ref={buttonRef} type="button" className="job-strip" aria-label={`查看岗位：${job.title}`} aria-haspopup="dialog" onClick={onOpen} onKeyDown={onKeyDown}>
      <span className="job-status-dot" role="img" aria-label={eligibilityLabel(status, job)} title={eligibilityLabel(status, job)} />
      <span className="job-strip-company">{job.company || "招聘团队"}</span>
      <strong className="job-strip-title">{job.title}</strong>
      {job.location ? <span className="job-strip-location">{job.location}</span> : null}
      {score !== null ? <span className="job-strip-score" aria-label={`匹配参考 ${score}`}><b>{score}</b></span> : null}
      {selected ? <span className="job-strip-selected"><Check size={12} aria-hidden="true" />已选择</span> : null}
      <ChevronRight className="job-strip-chevron" size={14} aria-hidden="true" />
    </button>
  </div>;
}

const jobFocusable = 'button:not(:disabled), a[href], [tabindex="0"]';

// The same anchor is used by the funnel and the offscreen uniform-scale fallback.
function jobWindowOrigin(strip, panel) {
  const rect = strip?.isConnected ? strip.getBoundingClientRect() : null;
  const visible = rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  if (!visible) return { origin: `${panel.width / 2}px ${panel.height / 2}px`, target: null };
  const anchor = strip.querySelector('.job-strip-chevron')?.getBoundingClientRect() || rect;
  const point = { x: anchor.left + anchor.width / 2, y: anchor.top + anchor.height / 2 };
  return { origin: `${point.x - panel.left}px ${point.y - panel.top}px`, target: strip, point };
}

function JobSpacesIndicator({ count, activeIndex, onJump }) {
  if (count > 9 || count < 1) return null;
  return <nav className="job-spaces-indicator" aria-label="岗位空间">
    {Array.from({ length: count }, (_, index) => <button key={index} type="button" className="job-space-dot"
      aria-label={`切换到岗位 ${index + 1}`} aria-current={index === activeIndex ? 'true' : undefined}
      onClick={() => onJump(index)} />)}
  </nav>;
}

function JobDetailWindow({ jobs, active, selectedJob, onSelect, strips, origin, onSwitch, onClose }) {
  const layer = useRef(null);
  const panel = useRef(null);
  const backdrop = useRef(null);
  const viewport = useRef(null);
  const stage = useRef(null);
  const track = useRef(null);
  const closeButton = useRef(null);
  const spaces = useRef(new Map());
  const animations = useRef([]);
  const timers = useRef([]);
  const windowAnimations = useRef([]);
  const genie = useRef(null);
  const switching = useRef(false);
  const closing = useRef(false);
  const closeNotified = useRef(false);
  const closeTimer = useRef(null);
  const mounted = useRef(false);
  const gesture = useRef(null);
  const wheelTimer = useRef(null);
  const suppressClick = useRef(false);
  const activeIndex = useRef(active.index);
  activeIndex.current = active.index;
  const [isClosing, setIsClosing] = useState(false);
  const [travel, setTravel] = useState(null);
  const [width, setWidth] = useState(0);
  const titleId = useId();
  const job = jobs[active.index];
  const selected = Boolean(selectedJob && (selectedJob === job || (job.id != null && selectedJob.id === job.id)));
  const status = job.eligibility?.status || 'verify';
  const link = safeHttpUrl(job.applyUrl || job.sourceUrl || job.url);
  const stride = width + 24;
  const rememberAnimation = animation => { animations.current.push(animation); return animation; };
  const animateWindow = (element, frames, options) => {
    const animation = element.animate(frames, options);
    windowAnimations.current.push(animation);
    return animation;
  };
  const cancelWindowMotion = () => {
    windowAnimations.current.forEach(animation => animation.cancel());
    windowAnimations.current = [];
  };
  const removeGenie = () => {
    const current = genie.current;
    if (!current) return;
    genie.current = null;
    current.resolve?.(false);
    cancelAnimationFrame(current.frame);
    current.element.style.visibility = current.visibility;
    current.overlay.remove();
  };
  const runGenie = (minimise, landing) => {
    if (document.visibilityState === 'hidden') {
      removeGenie();
      return Promise.resolve(true);
    }
    const element = panel.current;
    let current = genie.current;
    if (current) {
      // Retain the last painted t and geometry when Escape reverses a restore.
      cancelAnimationFrame(current.frame);
      current.resolve?.(false);
    } else {
      const W = element.getBoundingClientRect();
      if (!landing.point || !W.width || !W.height) return Promise.resolve(false);
      const nodes = element.querySelectorAll('*');
      const count = nodes.length > 600 ? 24 : Math.max(24, Math.min(48, Math.round(W.height / 14)));
      const h = W.height / count;
      const style = getComputedStyle(element);
      const overlay = document.createElement('div');
      overlay.className = 'job-genie-overlay';
      overlay.style.visibility = 'hidden';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.inert = true;
      // Resolve inherited surface tokens through CSS before flattening the glass.
      overlay.style.backgroundColor = `var(--aui-surface, ${layer.current.dataset.theme === 'dark' ? '#0F1011' : '#ffffff'})`;
      layer.current.append(overlay);
      const surface = opaqueGenieSurface(style.backgroundColor, getComputedStyle(overlay).backgroundColor);
      overlay.style.backgroundColor = '';
      const fragment = document.createDocumentFragment();
      const slices = [];
      const scrollers = Array.from(element.querySelectorAll('.job-space'));
      for (let i = 0; i < count; i++) {
        const slice = document.createElement('div');
        slice.className = 'job-genie-slice';
        slice.style.backgroundColor = surface;
        if (i === 0) {
          slice.style.borderTopLeftRadius = style.borderTopLeftRadius;
          slice.style.borderTopRightRadius = style.borderTopRightRadius;
        }
        if (i === count - 1) {
          slice.style.borderBottomLeftRadius = style.borderBottomLeftRadius;
          slice.style.borderBottomRightRadius = style.borderBottomRightRadius;
        }
        const clone = element.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        clone.removeAttribute('aria-modal');
        clone.inert = true;
        [clone, ...clone.querySelectorAll('[id], [aria-labelledby], [aria-describedby], [aria-controls]')].forEach(node => {
          ['id', 'aria-labelledby', 'aria-describedby', 'aria-controls'].forEach(name => node.removeAttribute(name));
        });
        Object.assign(clone.style, {
          position: 'absolute', left: '0', top: `${-i * h}px`, width: `${W.width}px`, height: `${W.height}px`,
          maxHeight: 'none', margin: '0', transform: 'none', transformOrigin: 'top left', visibility: 'inherit', opacity: '1',
          boxShadow: 'none', backgroundColor: 'transparent', backdropFilter: 'none', webkitBackdropFilter: 'none',
        });
        // Opening runs before the first setWidth render; use the measured stride
        // in the clone rather than the initial zero-width React state.
        const cloneTrack = clone.querySelector('.job-spaces-track');
        if (!minimise && cloneTrack) cloneTrack.style.transform = `translateX(${-activeIndex.current * (viewport.current.clientWidth + 24)}px)`;
        slice.append(clone);
        fragment.append(slice);
        slices.push(slice);
      }
      overlay.append(fragment);
      slices.forEach(slice => {
        slice.querySelectorAll('.job-space').forEach((clone, index) => {
          clone.scrollTop = scrollers[index].scrollTop;
          clone.scrollLeft = scrollers[index].scrollLeft;
        });
      });
      current = { element, overlay, slices, rect: W, point: landing.point, t: minimise ? 0 : 1,
        mirrored: landing.point.y < W.top + W.height / 2, visibility: element.style.visibility };
      genie.current = current;
    }
    const start = current.t;
    const end = minimise ? 1 : 0;
    const duration = Math.max(1, (minimise ? 620 : 560) * Math.abs(end - start));
    const fromPoint = current.point;
    current.overlay.dataset.direction = minimise ? 'close' : 'open';
    return new Promise(resolve => {
      let settled = false;
      let watchdog;
      const settle = finished => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        if (current.resolve === settle) current.resolve = null;
        resolve(finished);
      };
      const finish = () => {
        current.resolve = null;
        try { removeGenie(); }
        finally { settle(true); }
      };
      current.resolve = settle;
      let started;
      const render = now => {
        if (settled) return;
        if (genie.current !== current) { settle(false); return; }
        started ??= now;
        const progress = Math.min(1, (now - started) / duration);
        current.t = start + (end - start) * progress;
        // An anchor can move during restore. Blend toward its new position from
        // the exact old point, so the reversal's first frame never jumps.
        const blend = progress * progress * (3 - 2 * progress);
        current.point = { x: fromPoint.x + (landing.point.x - fromPoint.x) * blend,
          y: fromPoint.y + (landing.point.y - fromPoint.y) * blend };
        const { rect: W, slices } = current;
        slices.forEach((slice, index) => {
          const { top, bottom, x, y, width, height, sx, sy, opacity } = genieSlice(W, current.point, slices.length, index, current.t, current.mirrored);
          const h = height + .5; // Only a half-pixel seam overlap; layout uses exact shared y boundaries.
          Object.assign(slice.style, {
            transform: `translate(${x}px, ${y}px)`, width: `${width}px`, height: `${h}px`, opacity,
            clipPath: `polygon(${top.left - x}px 0px, ${top.right - x}px 0px, ${bottom.right - x}px ${h}px, ${bottom.left - x}px ${h}px)`,
          });
          Object.assign(slice.firstElementChild.style, {
            left: `${(top.left + bottom.left) / 2 - x}px`, top: `${-index * W.height / slices.length * sy}px`,
            transform: `scale(${sx}, ${sy})`,
          });
        });
        // Mount first, then swap both surfaces in the same animation frame.
        current.overlay.style.visibility = 'visible';
        element.style.visibility = 'hidden';
        if (progress < 1) current.frame = requestAnimationFrame(render);
        else finish();
      };
      // rAF can stop entirely in hidden/occluded panes. Finish independently of frames.
      watchdog = setTimeout(() => {
        if (settled) return;
        if (genie.current !== current) { settle(false); return; }
        finish();
      }, duration + 250);
      current.frame = requestAnimationFrame(render);
    });
  };
  const cancelMotion = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    clearTimeout(wheelTimer.current);
    animations.current.forEach(animation => animation.cancel());
    animations.current = [];
    gesture.current = null;
  };
  const finishClose = () => {
    if (!mounted.current || !closing.current || closeNotified.current) return;
    closeNotified.current = true;
    clearTimeout(closeTimer.current);
    onClose();
  };
  const close = async () => {
    if (closing.current || !mounted.current) return;
    closing.current = true;
    switching.current = false;
    closeTimer.current = setTimeout(finishClose, 1200);
    try {
      if (document.visibilityState === 'hidden') {
        removeGenie();
        return;
      }
      // Copy animated values before cancellation; computed style objects themselves are live.
      const style = getComputedStyle(panel.current);
      const current = { transform: style.transform, opacity: style.opacity, borderRadius: style.borderRadius, transformOrigin: style.transformOrigin };
      const children = Array.from(panel.current.children).map(element => ({ element, opacity: getComputedStyle(element).opacity }));
      const backdropStyle = getComputedStyle(backdrop.current);
      const shade = { opacity: backdropStyle.opacity, backdropFilter: backdropStyle.backdropFilter };
      cancelMotion();
      cancelWindowMotion();
      setIsClosing(true);
      const landing = jobWindowOrigin(strips.current[activeIndex.current], panel.current.getBoundingClientRect());
      const mobile = window.matchMedia('(max-width: 639px)').matches;
      const reduced = prefersReducedMotion();
      const useGenie = !mobile && !reduced && panel.current.animate && landing.target;
      if (!useGenie) removeGenie();
      const duration = reduced ? 120 : useGenie ? 620 : 360;
      if (!mobile && !reduced) {
        panel.current.style.transformOrigin = landing.origin;
        if (current.transform === 'none') current.transformOrigin = landing.origin;
      }
      if (panel.current.animate) {
        animateWindow(backdrop.current, reduced ? [{ opacity: shade.opacity }, { opacity: 0 }] : [shade, { opacity: 0, backdropFilter: 'blur(0px)' }], { duration, easing: 'ease', fill: 'forwards' });
        if (useGenie) {
          await runGenie(true, landing);
        } else {
          children.forEach(({ element, opacity }) => animateWindow(element, [{ opacity }, { opacity: 0 }], { duration: 120, fill: 'forwards' }));
          animateWindow(panel.current, reduced ? [{ opacity: current.opacity }, { opacity: 0 }] : [
            { opacity: current.opacity }, { opacity: current.opacity, offset: .45 }, { opacity: 0 }
          ], { duration, fill: 'forwards' });
          const movement = reduced ? null : animateWindow(panel.current, [
            { transform: current.transform, borderRadius: current.borderRadius, transformOrigin: current.transformOrigin },
            { transform: mobile ? 'translateY(100%)' : 'scale(0.02)', borderRadius: mobile ? '16px 16px 0 0' : '40px', transformOrigin: mobile ? current.transformOrigin : landing.origin }
          ], { duration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
          // If the anchor moved during opening, interpolating the origin preserves the first frame.
          await (movement || windowAnimations.current.at(-1)).finished.catch(() => {});
        }
      }
      if (mounted.current && !reduced && !mobile && landing.target?.isConnected) landing.target.dataset.receiving = 'true';
    } finally {
      finishClose();
    }
  };
  const jumpTo = (next, offset = 0) => {
    const from = activeIndex.current;
    if (switching.current || closing.current || next < 0 || next >= jobs.length) return;
    clearTimeout(wheelTimer.current);
    gesture.current = null;
    stage.current.dataset.dragging = 'false';
    if (prefersReducedMotion() || !track.current.animate) {
      if (next !== from) onSwitch(next);
      return;
    }
    switching.current = true;
    setTravel({ from, to: next, offset });
  };
  const switchJob = step => jumpTo(activeIndex.current + step);

  useLayoutEffect(() => {
    if (!travel) return;
    const { from, to, offset } = travel;
    const duration = Math.min(700, 520 + Math.max(0, Math.abs(to - from) - 1) * 60);
    const easing = 'cubic-bezier(.25,.8,.25,1)';
    const movement = rememberAnimation(track.current.animate([
      { transform: `translateX(${-from * stride + offset}px)` },
      { transform: `translateX(${-to * stride}px)` }
    ], { duration, easing, fill: 'forwards' }));
    rememberAnimation(stage.current.animate([
      { transform: 'scale(1)' }, { transform: 'scale(.985)', offset: .35 }, { transform: 'scale(1)' }
    ], { duration, easing }));
    if (to !== from) {
      timers.current.push(setTimeout(() => {
        panel.current.querySelectorAll('[data-header-text]').forEach(element => {
          rememberAnimation(element.animate([{ opacity: 1 }, { opacity: 0, offset: .5 }, { opacity: 1 }], { duration: 120 }));
        });
      }, duration / 2 - 60));
      timers.current.push(setTimeout(() => {
        if (!mounted.current || closing.current) return;
        if (viewport.current.contains(document.activeElement)) closeButton.current.focus({ preventScroll: true });
        onSwitch(to);
      }, duration / 2));
    }
    movement.finished.then(() => {
      if (!mounted.current || closing.current) return;
      track.current.style.transform = `translateX(${-to * (viewport.current.clientWidth + 24)}px)`;
      animations.current.forEach(animation => animation.cancel());
      animations.current = [];
      timers.current = [];
      switching.current = false;
      setTravel(null);
    }).catch(() => {});
  }, [travel]);

  useLayoutEffect(() => {
    spaces.current.get(active.index)?.scrollTo({ top: 0 });
  }, [active.index]);

  // Pointer and wheel input share a pixel offset; only the shared track moves.
  const beginGesture = (kind, x = 0, y = 0, pointerId = null) => {
    if (switching.current || closing.current) return false;
    gesture.current = { kind, x, y, pointerId, delta: 0, lastDelta: 0, lastAt: performance.now(), velocity: 0, dragging: false };
    return true;
  };
  const followGesture = delta => {
    const current = gesture.current;
    const now = performance.now();
    current.velocity = (delta - current.lastDelta) / Math.max(1, now - current.lastAt);
    current.lastAt = now;
    current.lastDelta = delta;
    current.delta = delta;
    const atEdge = (activeIndex.current === 0 && delta > 0) || (activeIndex.current === jobs.length - 1 && delta < 0);
    const offset = atEdge ? Math.sign(delta) * Math.min(60, Math.abs(delta) * .3) : Math.max(-stride, Math.min(stride, delta));
    if (!prefersReducedMotion()) track.current.style.transform = `translateX(${-activeIndex.current * stride + offset}px)`;
    current.offset = offset;
  };
  const endGesture = (cancelled = false) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    stage.current.dataset.dragging = 'false';
    if (!current.dragging) return;
    const fast = performance.now() - current.lastAt < 180 && Math.abs(current.velocity) > .5 && Math.abs(current.delta) > 6;
    const commit = !cancelled && (Math.abs(current.delta) > width * .2 || fast);
    const next = Math.max(0, Math.min(jobs.length - 1, activeIndex.current + (commit ? current.delta < 0 ? 1 : -1 : 0)));
    jumpTo(next, current.offset || 0);
  };
  const onPointerDown = event => {
    if (!event.isPrimary || event.button !== 0 || gesture.current || event.target.closest('button, a, input, textarea, select, [contenteditable="true"]') || !window.getSelection()?.isCollapsed) return;
    if (beginGesture('pointer', event.clientX, event.clientY, event.pointerId)) viewport.current.setPointerCapture(event.pointerId);
  };
  const onPointerMove = event => {
    const current = gesture.current;
    if (current?.kind !== 'pointer' || current.pointerId !== event.pointerId) return;
    const delta = event.clientX - current.x;
    if (!current.dragging) {
      if (Math.max(Math.abs(delta), Math.abs(event.clientY - current.y)) < 6) return;
      if (Math.abs(event.clientY - current.y) > Math.abs(delta) || !window.getSelection()?.isCollapsed) { gesture.current = null; return; }
      current.dragging = true;
      suppressClick.current = true;
      stage.current.dataset.dragging = 'true';
    }
    event.preventDefault();
    followGesture(delta);
  };
  const onPointerEnd = (event, cancelled = false) => {
    if (gesture.current?.kind !== 'pointer' || gesture.current.pointerId !== event.pointerId) return;
    endGesture(cancelled);
    if (viewport.current.hasPointerCapture(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId);
    // A drag's synthetic click must not toggle requirements or follow a link.
    timers.current.push(setTimeout(() => { suppressClick.current = false; }, 0));
  };
  const wheelHandler = useRef(null);
  wheelHandler.current = event => {
    if (event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    if (switching.current || closing.current) return;
    if (gesture.current && gesture.current.kind !== 'wheel') return;
    if (!gesture.current && !beginGesture('wheel')) return;
    const current = gesture.current;
    current.dragging = true;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1;
    followGesture(current.delta - event.deltaX * unit);
    clearTimeout(wheelTimer.current);
    wheelTimer.current = setTimeout(() => endGesture(), 120);
  };
  useEffect(() => {
    const node = viewport.current;
    const wheel = event => wheelHandler.current(event);
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    const workspace = origin.closest('.aui-workspace') || origin;
    const syncTheme = () => {
      const tokens = getComputedStyle(workspace);
      for (const name of Array.from(tokens)) {
        if (/^--(?:aui-|accent-|font-|ease-|dur-)|^--focus$/.test(name)) layer.current.style.setProperty(name, tokens.getPropertyValue(name));
      }
      layer.current.dataset.theme = workspace.dataset.theme || 'light';
    };
    syncTheme();
    const themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(workspace, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    setWidth(viewport.current.clientWidth);
    const resizeObserver = new ResizeObserver(() => setWidth(viewport.current.clientWidth));
    resizeObserver.observe(viewport.current);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const background = Array.from(document.body.children).filter(element => element !== layer.current);
    const inertState = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    closeButton.current.focus({ preventScroll: true });
    const keepFocus = event => {
      if (!panel.current.contains(event.target)) closeButton.current.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', keepFocus);
    if (panel.current.animate && document.visibilityState !== 'hidden') {
      const mobile = window.matchMedia('(max-width: 639px)').matches;
      const reduced = prefersReducedMotion();
      const landing = jobWindowOrigin(origin, panel.current.getBoundingClientRect());
      const useGenie = !mobile && !reduced && landing.target;
      if (!mobile && !reduced) panel.current.style.transformOrigin = landing.origin;
      if (useGenie) {
        runGenie(false, landing).then(finished => {
          if (!finished || !mounted.current || closing.current) return;
          closeButton.current.focus({ preventScroll: true });
        });
      } else {
        if (!reduced) animateWindow(panel.current, [
          { transform: mobile ? 'translateY(100%)' : 'scale(0.02)', borderRadius: mobile ? '16px 16px 0 0' : '40px' },
          { transform: mobile ? 'translateY(0)' : 'scale(1)', borderRadius: mobile ? '16px 16px 0 0' : '14px' }
        ], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
        animateWindow(panel.current, reduced ? [{ opacity: 0 }, { opacity: 1 }] : [
          { opacity: 0 }, { opacity: 1, offset: .35 }, { opacity: 1 }
        ], { duration: reduced ? 120 : 420 });
        if (!reduced) Array.from(panel.current.children).forEach(element => animateWindow(element, [{ opacity: 0 }, { opacity: 1 }], { delay: 100, duration: 320, fill: 'backwards' }));
      }
      animateWindow(backdrop.current, reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, backdropFilter: 'blur(0px)' }, { opacity: 1, backdropFilter: 'blur(3px)' }], { duration: reduced ? 120 : 280, easing: 'ease' });
    }
    return () => {
      mounted.current = false;
      clearTimeout(closeTimer.current);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('focusin', keepFocus);
      document.body.style.overflow = overflow;
      background.forEach((element, index) => { element.inert = inertState[index]; });
      const strip = strips.current[activeIndex.current];
      const target = strip?.isConnected ? strip : origin;
      if (target.isConnected) target.focus({ preventScroll: true });
      try { removeGenie(); }
      finally {
        cancelWindowMotion();
        cancelMotion();
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const controls = Array.from(panel.current.querySelectorAll(jobFocusable)).filter(element => !element.closest('[inert]') && element.getClientRects().length);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
      if (!event.altKey && !event.metaKey && !event.ctrlKey && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); switchJob(event.key === 'ArrowRight' ? 1 : -1); }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  });

  const firstSpace = Math.max(0, Math.min(active.index, travel?.from ?? active.index, travel?.to ?? active.index) - 1);
  const lastSpace = Math.min(jobs.length - 1, Math.max(active.index, travel?.from ?? active.index, travel?.to ?? active.index) + 1);
  return createPortal(<div ref={layer} className="job-window-layer" data-closing={isClosing}>
    <div ref={backdrop} className="job-window-backdrop" aria-hidden="true" onClick={close} />
    <section ref={panel} className="job-window" role="dialog" aria-modal="true" aria-labelledby={`${titleId}-${active.index}`} data-status={status}>
      <header className="job-window-header">
        <span data-header-text className="job-window-company">{job.company || '招聘团队'}</span>
        <span data-header-text className="job-window-status">{eligibilityLabel(status, job)}</span>
        <span data-header-text className="job-window-counter" aria-live="polite">{active.index + 1} / {jobs.length}</span>
        <button type="button" aria-label="上一个岗位" disabled={active.index === 0} onClick={() => switchJob(-1)}><ChevronLeft size={16} /></button>
        <button type="button" aria-label="下一个岗位" disabled={active.index === jobs.length - 1} onClick={() => switchJob(1)}><ChevronRight size={16} /></button>
        <button ref={closeButton} type="button" className="job-window-close" aria-label="关闭岗位详情" onClick={close}><X size={15} /></button>
      </header>
      <div className="job-window-body">
        <div ref={viewport} className="job-spaces-viewport" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={event => onPointerEnd(event)} onPointerCancel={event => onPointerEnd(event, true)}
          onLostPointerCapture={event => onPointerEnd(event, true)}
          onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }}>
          <div ref={stage} className="job-spaces-stage">
            <div ref={track} className="job-spaces-track" style={{ transform: `translateX(${-active.index * stride}px)` }}>
              {jobs.slice(firstSpace, lastSpace + 1).map((spaceJob, offset) => {
                const index = firstSpace + offset;
                const score = realJobScore(spaceJob);
                return <article key={spaceJob.id || index} ref={node => { if (node) spaces.current.set(index, node); else spaces.current.delete(index); }}
                  className="job-window-content job-space" data-space-index={index} aria-hidden={index !== active.index} inert={index !== active.index}
                  style={{ left: `calc(${index * 100}% + ${index * 24}px)` }}>
                  <h2 id={`${titleId}-${index}`}>{spaceJob.title}</h2>
                  <p className="job-window-meta">{[spaceJob.location || '地点待确认', jobTypeLabel(spaceJob.type || spaceJob.jobType), spaceJob.deadline ? `截止 ${spaceJob.deadline}` : null].filter(Boolean).join(' · ')}</p>
                  {score !== null ? <div className="job-window-stats"><b>{score}</b><small>参考</small></div> : null}
                  <JobRequirements job={spaceJob} />
                </article>;
              })}
            </div>
          </div>
        </div>
        <JobSpacesIndicator count={jobs.length} activeIndex={active.index} onJump={jumpTo} />
      </div>
      <footer className="job-window-footer">
        <button type="button" className="job-window-select" aria-label={`选择岗位：${job.title}`} aria-pressed={selected} onClick={() => onSelect?.(job)}>{selected ? <><Check size={14} aria-hidden="true" />已选择</> : '选择'}</button>
        {link ? <a href={link} target="_blank" rel="noopener noreferrer">原文<ArrowUpRight size={12} /></a> : null}
      </footer>
    </section>
  </div>, document.body);
}

function JobRequirements({ job }) {
  const [expanded, setExpanded] = useState(true);
  const disclosureId = useId();
  const requirements = Array.isArray(job.requirements) ? job.requirements.filter((item) => typeof item === "string" && item.trim()) : [];
  const checks = Array.isArray(job.eligibility?.checks) ? job.eligibility.checks.filter(Boolean) : [];
  if (!requirements.length && !checks.length) return null;
  const visibleRequirements = requirements.slice(0, 6);
  const remaining = requirements.length - visibleRequirements.length;
  return (
    <div className="job-requirements">
      <button type="button" className="job-requirements-toggle" aria-expanded={expanded} aria-controls={disclosureId} onClick={() => setExpanded((value) => !value)}>
        要求与核验<ChevronDown size={14} aria-hidden="true" />
      </button>
      <div id={disclosureId} className="job-disclosure" data-expanded={expanded} aria-hidden={!expanded} inert={!expanded}>
        <div><div className="job-requirements-body">
          {job.fullDescriptionVerified === false ? <p className="job-requirements-warning">要求未经企业原文核实</p> : null}
          {requirements.length ? <section>
            <h4>岗位要求</h4>
            <ul className="job-requirements-list">
              {visibleRequirements.map((requirement, index) => <li className="job-requirement-row" style={staggerStyle(index)} key={`${index}-${requirement}`}>{requirement}</li>)}
            </ul>
            {remaining ? <p className="job-requirement-row" style={staggerStyle(6)}>还有 {remaining} 条</p> : null}
          </section> : null}
          {checks.length ? <section>
            <h4>条件核验</h4>
            <ul className="job-checks-list">
              {checks.map((check, index) => {
                const status = check.status === "pass" ? "pass" : check.status === "fail" ? "fail" : "verify";
                const label = status === "pass" ? "通过" : status === "fail" ? "不符" : "待核实";
                return <li className="job-requirement-row job-check-row" data-status={status} style={staggerStyle(visibleRequirements.length + (remaining ? 1 : 0) + index)} key={`${index}-${check.dimension}`}>
                  <span className="job-check-icon" role="img" aria-label={label}>{status === "pass" ? <Check size={14} aria-hidden="true" /> : status === "fail" ? <X size={14} aria-hidden="true" /> : <span aria-hidden="true">?</span>}</span>
                  <div><strong>{check.dimension}</strong><p>{check.message || label}</p>{check.evidence ? <p className="job-check-evidence">核验依据：{check.evidence}</p> : null}</div>
                </li>;
              })}
            </ul>
          </section> : null}
        </div></div>
      </div>
    </div>
  );
}

// Keep native details semantics while retaining the body through its closing transition.
function JobDisclosure({ className, summary, children }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const intent = useRef(false);
  const frame = useRef(null);
  const timer = useRef(null);
  useEffect(() => () => { cancelAnimationFrame(frame.current); clearTimeout(timer.current); }, []);
  const toggle = (event) => {
    event.preventDefault();
    cancelAnimationFrame(frame.current);
    clearTimeout(timer.current);
    intent.current = !intent.current;
    if (prefersReducedMotion()) {
      setOpen(intent.current);
      setExpanded(intent.current);
    } else if (intent.current) {
      setOpen(true);
      frame.current = requestAnimationFrame(() => {
        frame.current = requestAnimationFrame(() => setExpanded(true));
      });
    } else {
      setExpanded(false);
      const duration = getComputedStyle(event.currentTarget).getPropertyValue("--dur-base").trim();
      const milliseconds = parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
      timer.current = setTimeout(() => setOpen(false), Number.isFinite(milliseconds) ? milliseconds : 240);
    }
  };
  return (
    <details className={className} open={open}>
      <summary onClick={toggle} aria-expanded={expanded}>{summary}</summary>
      <div className="job-disclosure" data-expanded={expanded} inert={!expanded} onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "grid-template-rows" && !intent.current) { clearTimeout(timer.current); setOpen(false); }
      }}><div>{children}</div></div>
    </details>
  );
}

function JobNotes({ title, items = [], rejected = false, collapsed = false }) {
  if (!items.length) return null;
  const className = "job-notes" + (rejected ? " rejected" : "");
  const notes = items.map((item) => <JobNote key={item.id || item.title || item.reason || item} item={item} />);
  if (collapsed) return (
    <JobDisclosure className={className} summary={<>{title}（{items.length}）</>}>{notes}</JobDisclosure>
  );
  return (
    <section className={className}>
      <h3>{title}</h3>
      {notes}
    </section>
  );
}

function JobNote({ item }) {
  if (typeof item === "string") return <p>{item}</p>;
  const link = safeHttpUrl(item.applyUrl || item.sourceUrl || item.url);
  const checks = item.eligibility?.checks || [];
  const reason = item.eligibility?.reason || item.reason || item.note;
  return (
    <div className="job-note-row">
      <JobDisclosure className="job-note" summary={<>
          <strong>{formatJobTitle(item)}</strong>
          <small>{formatJobMeta(item, link)}</small>
        </>}>
        {reason ? <p>{reason}</p> : null}
        {checks.length ? <ul>{checks.map((check) => <li key={`${check.dimension}-${check.message}`}>{check.dimension}: {check.message || check.status}{check.evidence ? ` · ${check.evidence}` : ""}</li>)}</ul> : null}
      </JobDisclosure>
      {link ? <a className="job-note-link" href={link} target="_blank" rel="noopener noreferrer">原文</a> : null}
    </div>
  );
}

function formatJobTitle(item) {
  return [item.company || "招聘团队", item.title || "岗位名称待确认"].filter(Boolean).join(" · ");
}

function formatJobMeta(item, link) {
  const meta = [item.location || "地点待确认", jobTypeLabel(item.type || item.jobType), link ? "可查看原文" : "原文链接待补充"].filter(Boolean);
  return meta.join(" · ");
}

function jobTypeLabel(type) {
  if (type === "internship") return "实习";
  if (type === "campus") return "校招";
  if (type === "social") return "社招";
  return type || "";
}

function eligibilityLabel(status, job = {}) {
  if (job.recordKind === 'recruitment_batch') return '招聘公告 · 需确认具体岗位';
  if (status === "passed") return "硬性条件匹配";
  // Without the employer's requirements nothing was judged; say so instead of implying a check.
  if (status === "verify" && !job.fullDescriptionVerified && job.detailProvider) return "已读取平台正文 · 要求未经企业原文核实";
  if (status === "verify" && !job.fullDescriptionVerified) return "要求未读取 · 点原文查看，选中后自动读取";
  if (status === "verify") return "部分条件待核实";
  return "条件不符";
}

function ResumeResult({ variant, onCopy, onPrint }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [copying, setCopying] = useState(false);
  const copyTimer = useRef(null);
  const copyAttempt = useRef(0);
  useEffect(() => {
    setCopied(false);
    setCopyError("");
    setCopying(false);
    return () => { clearTimeout(copyTimer.current); copyAttempt.current += 1; };
  }, [variant]);
  if (!variant) return null;
  const resumeText = formatResumeText(variant);
  const copy = async () => {
    const attempt = ++copyAttempt.current;
    clearTimeout(copyTimer.current);
    setCopied(false);
    setCopyError("");
    setCopying(true);
    try {
      const success = onCopy ? await onCopy(resumeText) : await navigator.clipboard.writeText(resumeText);
      if (attempt !== copyAttempt.current) return;
      if (success === false) throw new Error("copy failed");
      setCopied(true);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      if (attempt === copyAttempt.current) setCopyError("复制失败，请重试。");
    } finally {
      if (attempt === copyAttempt.current) setCopying(false);
    }
  };
  return (
    <div className="result-panel resume-panel result-motion">
      <header>
        <div><span>RESUME CUSTOMIZATION · 岗位版简历</span><h3>{variant.title}</h3></div>
      </header>
      <ResultStats items={[{ label: 'FIT SCORE · 匹配参考', value: variant.fitScore, suffix: '/100' }]} />
      <div className="resume-identity">
        <strong>{variant.name || "姓名待补充"}</strong>
        <span>{[variant.targetTitle || variant.title, ...Object.values(variant.contact || {}).filter(Boolean)].filter(Boolean).join(" · ")}</span>
      </div>
      <p className="resume-summary">{variant.summary}</p>
      <div className="result-toolbar">
        <button type="button" onClick={copy} disabled={copying} data-copied={copied}>
          <span className="result-copy-icon"><Copy size={15} /><Check size={15} /></span>{copied ? "已复制" : "复制"}
        </button>
        <button type="button" onClick={(event) => onPrint ? onPrint(event.currentTarget.closest(".resume-panel")) : window.print()}><Printer size={15} />打印 PDF</button>
        <span className={copyError ? "result-copy-error" : "result-sr-only"} role="status">{copyError || (copied ? "已复制" : "")}</span>
      </div>
      <ResumeSection title="教育经历" items={variant.education} />
      <ResumeSection title="技能" items={variant.skills} inline />
      <ResumeSection title="项目经历" items={variant.projects} numbered />
      <ResumeSection title="工作与实习经历" items={variant.experience} />
      <ResumeSection title="荣誉与证书" items={variant.awards} />
      <footer><WandSparkles size={14} />{variant.interviewPlan ? "已包含针对性面试计划" : "可继续生成针对性面试计划"}</footer>
    </div>
  );
}

function InterviewResult({ plan }) {
  if (!plan) return null;
  return (
    <div className="result-panel interview-panel result-motion">
      <header><span>面试准备</span><small>{plan.roleLabel}</small></header>
      <div className="topic-row">
        {(plan.technicalTopics || []).map((topic, index) => (
          <span key={topic.id || topic.title} style={staggerStyle(index)} tabIndex={0}><b>{topic.priority}</b>{topic.title}</span>
        ))}
      </div>
      <div className="interview-columns">
        <section>
          <h3>项目追问</h3>
          {(plan.resumeDefense || []).map((question) => <p key={question}>{question}</p>)}
        </section>
        <section>
          <h3>七天节奏</h3>
          {(plan.schedule || []).slice(0, 7).map((item) => (
            <p key={item.day}><b>{item.day}</b><span>{item.title}</span></p>
          ))}
        </section>
      </div>
    </div>
  );
}

function TargetResult({ job }) {
  if (!job) return null;
  return (
    <div className="target-card result-motion">
      <span><BriefcaseBusiness size={15} />当前目标</span>
      <strong>{job.company} · {job.title}</strong>
    </div>
  );
}

function ResultList({ title, items = [], positive = false }) {
  const normalizedItems = Array.isArray(items) && items.every((item) => typeof item === "string") ? items.filter(Boolean) : normalizeResultItems(items);
  if (!normalizedItems.length) return null;
  return (
    <section className={"result-list" + (positive ? " positive" : "")}>
      <h3>{title}</h3>
      {normalizedItems.slice(0, 4).map((item, index) => <p key={item} style={staggerStyle(index)}><span aria-hidden="true">{positive ? <Check size={12} /> : "→"}</span><span>{item}</span></p>)}
    </section>
  );
}

function ResumeSection({ title, items = [], inline = false, numbered = false }) {
  if (!items.length) return null;
  if (inline) {
    return (
      <section className="resume-section">
        <h3>{title}</h3>
        <div className="skill-row">{items.map((item) => <span key={item}>{item}</span>)}</div>
      </section>
    );
  }
  return (
    <section className="resume-section">
      <h3>{title}</h3>
      <div className={numbered ? "project-output" : "resume-list"}>
        {items.map((item, index) => (
          <div key={item}><span>{numbered ? String(index + 1).padStart(2, "0") : "•"}</span><p>{item}</p></div>
        ))}
      </div>
    </section>
  );
}

function formatResumeText(variant) {
  const contact = Object.values(variant.contact || {}).filter(Boolean).join(" · ");
  const section = (title, items = []) => items.length ? [`## ${title}`, ...items.map((item) => "- " + item), ""] : [];
  return [
    "# " + (variant.name || "个人简历"),
    variant.targetTitle || variant.title || "",
    contact,
    "",
    variant.summary,
    "",
    ...section("教育经历", variant.education),
    ...section("技能", variant.skills),
    ...section("项目经历", variant.projects),
    ...section("工作与实习经历", variant.experience),
    ...section("荣誉与证书", variant.awards)
  ].filter(Boolean).join("\n");
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}
