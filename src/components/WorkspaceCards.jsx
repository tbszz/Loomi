import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileText, Globe, MessageSquarePlus, Maximize2, Minimize2, PanelRightClose, X } from 'lucide-react';
import { activateCard, cardMode, clampFrame, closeCard, columnWidth, contextCards, defaultLayout, readLayout, stackSplit, visibleCards, writeLayout } from '../cardLayout.js';
import './workspaceCards.css';

const cards = { documents: { label: '资料', Icon: FileText }, apply: { label: '网申', Icon: Globe }, sidechat: { label: '旁聊', Icon: MessageSquarePlus } };
function cardStorage() { try { return window.localStorage; } catch { return null; } }
export function useWorkspaceCards(userId, conversation) {
  const [saved, setSaved] = useState({ owner: null, layout: defaultLayout() });
  const [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight });
  const [dots, setDots] = useState([]);
  const [minimized, setMinimized] = useState([]);
  const previous = useRef(null);
  const layout = saved.owner === userId ? saved.layout : defaultLayout();
  useEffect(() => { setSaved({ owner: userId, layout: readLayout(cardStorage(), userId, { width: innerWidth, height: innerHeight }) }); setDots([]); setMinimized([]); }, [userId]);
  useEffect(() => { if (saved.owner === userId) writeLayout(cardStorage(), userId, saved.layout); }, [userId, saved]);
  useEffect(() => {
    const resize = () => setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const update = recipe => setSaved(current => ({ owner: userId, layout: recipe(current.owner === userId ? current.layout : readLayout(cardStorage(), userId, { width: innerWidth, height: innerHeight })) }));
  const open = id => { update(current => activateCard(current, id)); setDots(current => current.filter(item => item !== id)); setMinimized(current => current.filter(item => item !== id)); };
  const close = id => {
    update(current => closeCard(current, id));
    requestAnimationFrame(() => [...document.querySelectorAll(`[data-card-toggle="${id}"]`)].find(element => element.getClientRects().length)?.focus());
  };
  const toggle = id => layout.open.includes(id) && !minimized.includes(id) ? close(id) : open(id);
  useEffect(() => {
    const next = { ...conversation?.context, application: conversation?.messages?.findLast(message => message.kind === 'application')?.id || conversation?.context?.application };
    const old = previous.current;
    previous.current = { id: conversation?.id, context: next };
    if (!old || old.id !== conversation?.id) return;
    for (const id of contextCards(old.context, next)) {
      const input = document.querySelector('.workspace-chat .aui-composer-input');
      if (input && (input === document.activeElement || input.value.trim())) setDots(current => [...new Set([...current, id])]);
      else open(id);
    }
  }, [conversation]);
  return { layout, viewport, update, open, close, toggle, dots, minimized, setMinimized };
}

export function CardToggles({ controller }) {
  return <div className="card-toggles" aria-label="辅助卡片">{Object.entries(cards).map(([id, { label, Icon }]) => <button key={id} type="button" data-card-toggle={id} aria-label={label} aria-pressed={controller.layout.open.includes(id)} title={label} onClick={() => controller.toggle(id)}><Icon size={15} /><span>{label}</span>{controller.dots.includes(id) && <i className="card-notification" aria-label="有新内容" />}</button>)}</div>;
}

function workspaceBounds() {
  const header = document.querySelector('.workspace-chat .chat-header')?.getBoundingClientRect();
  const composer = document.querySelector('.workspace-chat .aui-composer-dock')?.getBoundingClientRect();
  const top = Math.max(66, (header?.bottom || 58) + 8);
  return { width: innerWidth, top, bottom: Math.max(top + 1, Math.min(innerHeight - 12, (composer?.top || innerHeight - 170) - 8)) };
}

export function WorkspaceCards({ controller, renderCard, sidebarCollapsed }) {
  const { layout, viewport, update, close, open, minimized, setMinimized } = controller;
  const mode = cardMode(viewport.width);
  const visible = visibleCards(layout, viewport.width, viewport.height);
  const hasColumn = mode !== 'overlay' && visible.length > 0;
  const tabs = layout.open.filter(id => !layout.popped[id] && !visible.includes(id));
  const width = columnWidth(layout.width, viewport.width, sidebarCollapsed ? 0 : 248);
  const [bounds, setBounds] = useState(workspaceBounds);
  const [stackHeight, setStackHeight] = useState(Math.max(400, viewport.height - 120));
  const column = useRef(null);
  const drag = useRef(null);
  useLayoutEffect(() => {
    const measure = () => {
      setBounds(current => { const next = workspaceBounds(); return JSON.stringify(next) === JSON.stringify(current) ? current : next; });
      if (column.current?.clientHeight) setStackHeight(Math.max(1, column.current.clientHeight - 12));
    };
    measure();
    const observer = new ResizeObserver(measure);
    const main = document.querySelector('.workspace-chat');
    if (column.current) observer.observe(column.current);
    if (main) { observer.observe(main); for (const element of main.querySelectorAll('.chat-header, .aui-composer-dock')) observer.observe(element); }
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [viewport, hasColumn, visible.join(',')]);
  useEffect(() => {
    if (!layout.open.length) return;
    const key = event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || document.querySelector('.job-detail-backdrop, .settings-layer, .auth-layer')) return;
      const focused = event.target.closest?.('[data-card-id]')?.dataset.cardId;
      const id = focused || visible.at(-1) || layout.open.at(-1);
      if (id) { event.preventDefault(); close(id); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [layout, visible.join(',')]);
  const pop = id => update(current => {
    const popped = { ...current.popped };
    if (popped[id]) delete popped[id];
    else popped[id] = clampFrame({ x: innerWidth - 472, y: bounds.top, width: 448, height: 480 }, bounds);
    return { ...current, popped };
  });
  function startResize(event, kind) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind, x: event.clientX, y: event.clientY, width, split: layout.split };
  }
  function resize(event) {
    const start = drag.current;
    if (!start) return;
    if (start.kind === 'width') update(current => ({ ...current, width: columnWidth(start.width + start.x - event.clientX, innerWidth, sidebarCollapsed ? 0 : 248) }));
    else update(current => ({ ...current, split: stackSplit(start.split + (event.clientY - start.y) / stackHeight, stackHeight) }));
  }
  const resizeEvents = kind => ({ onPointerDown: event => startResize(event, kind), onPointerMove: resize, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; }, onLostPointerCapture: () => { drag.current = null; } });
  const split = stackSplit(layout.split, stackHeight);
  const tabBar = tabs.length > 0 ? <nav className="cards-tabs" aria-label="收起的卡片">{tabs.map(id => { const { Icon, label } = cards[id]; return <button key={id} onClick={() => open(id)}><Icon size={13} />{label}</button>; })}</nav> : null;
  return <div className="workspace-cards" data-mode={mode} data-has-column={hasColumn} style={{ '--cards-width': `${width}px`, '--stack-split': split, '--sheet-top': `${bounds.top}px` }}>
    {mode === 'overlay' && visible.length > 0 && <button className="cards-scrim" aria-label="关闭辅助卡片" onClick={() => close(visible[0])} />}
    {hasColumn && <div className="cards-width-handle" role="separator" tabIndex={0} aria-label="调整卡片列宽" aria-orientation="vertical" aria-valuemin={360} aria-valuemax={640} aria-valuenow={Math.round(width)} {...resizeEvents('width')} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); update(current => ({ ...current, width: columnWidth(width + (event.key === 'ArrowLeft' ? 20 : -20), innerWidth, sidebarCollapsed ? 0 : 248) })); } }} />}
    {mode !== 'overlay' && tabBar}
    <div className="cards-stack" ref={column}>
      {layout.open.map(id => {
        const floating = Boolean(layout.popped[id]);
        const isVisible = floating || visible.includes(id);
        const first = visible[0] === id;
        const frame = floating ? clampFrame(layout.popped[id], bounds) : null;
        return <React.Fragment key={id}><CardFrame id={id} visible={isVisible} floating={floating} frame={frame} bounds={bounds} tabs={mode === 'overlay' && !floating && isVisible ? tabBar : null} overlay={mode === 'overlay' && !floating} minimized={floating && minimized.includes(id)} onMinimize={value => setMinimized(current => value ? [...current, id] : current.filter(item => item !== id))} onPop={() => pop(id)} onClose={() => close(id)} onFrame={next => update(current => ({ ...current, popped: { ...current.popped, [id]: next } }))} style={{ flex: visible.length === 2 ? (first ? split : 1 - split) : 1 }}>
          {renderCard(id)}
        </CardFrame>
        {hasColumn && visible.length === 2 && first && <div className="cards-stack-handle" role="separator" tabIndex={0} aria-label="调整卡片高度" aria-orientation="horizontal" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(split * 100)} {...resizeEvents('stack')} onKeyDown={event => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); update(current => ({ ...current, split: stackSplit(split + (event.key === 'ArrowUp' ? -.05 : .05), stackHeight) })); } }} />}
        </React.Fragment>;
      })}
    </div>
  </div>;
}

function CardFrame({ id, visible, floating, frame, bounds, tabs, overlay, minimized, onMinimize, onPop, onClose, onFrame, children, style }) {
  const drag = useRef(null);
  const node = useRef(null);
  const minimizeButton = useRef(null);
  const restoreButton = useRef(null);
  const focusAfterMinimize = useRef(false);
  const { Icon, label } = cards[id];
  useEffect(() => {
    if (focusAfterMinimize.current) { (minimized ? restoreButton : minimizeButton).current?.focus(); focusAfterMinimize.current = false; }
  }, [minimized]);
  useEffect(() => {
    if (!overlay || !visible) return;
    const before = document.activeElement;
    node.current?.querySelector('button')?.focus();
    const trap = event => {
      if (event.key !== 'Tab') return;
      const items = [...node.current.querySelectorAll('button, textarea, input, select, a[href], [tabindex="0"]')].filter(element => !element.disabled && element.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    node.current.addEventListener('keydown', trap);
    const element = node.current;
    return () => { element?.removeEventListener('keydown', trap); if (before?.isConnected) before.focus(); };
  }, [overlay, visible]);
  function start(event, resizing = false) {
    if (!floating || event.button !== 0 || (!resizing && event.target.closest('button'))) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, frame, resizing };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function move(event) {
    const saved = drag.current;
    if (!saved || saved.pointerId !== event.pointerId) return;
    const dx = event.clientX - saved.x, dy = event.clientY - saved.y;
    onFrame(clampFrame(saved.resizing ? { ...saved.frame, width: Math.min(640, saved.frame.width + dx), height: saved.frame.height + dy } : { ...saved.frame, x: saved.frame.x + dx, y: saved.frame.y + dy }, bounds));
  }
  const handlers = { onPointerMove: move, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; }, onLostPointerCapture: () => { drag.current = null; } };
  return <>
    {minimized && <button ref={restoreButton} className="card-restore" style={{ left: frame.x, top: frame.y }} aria-label={`展开${label}卡片`} onClick={() => { focusAfterMinimize.current = true; onMinimize(false); }}><Icon size={17} /></button>}
    <section ref={node} className="workspace-card" data-card-id={id} data-floating={floating} data-overlay={overlay} hidden={!visible || minimized} aria-label={`${label}卡片`} role={overlay ? 'dialog' : 'region'} aria-modal={overlay || undefined} style={{ ...style, ...(floating ? { left: frame.x, top: frame.y, width: frame.width, height: frame.height } : overlay ? { top: bounds.top, height: bounds.bottom - bounds.top } : {}) }}>
      <header className="workspace-card-header evidence-drag-handle" onPointerDown={start} {...handlers}>
        <Icon size={15} /><strong>{label}</strong>
        {floating && <button ref={minimizeButton} type="button" title={`最小化${label}卡片`} aria-label={`最小化${label}卡片`} onClick={() => { focusAfterMinimize.current = true; onMinimize(true); }}><Minimize2 size={15} /></button>}
        <button type="button" title={floating ? '停靠回卡片列' : '弹出为浮窗'} aria-label={floating ? `停靠${label}卡片` : `弹出${label}卡片`} onClick={onPop}>{floating ? <PanelRightClose size={15} /> : <Maximize2 size={15} />}</button>
        <button type="button" title={`关闭${label}卡片`} aria-label={`关闭${label}卡片`} onClick={onClose}><X size={16} /></button>
      </header>
      {tabs}
      <div className="workspace-card-body">{children}</div>
      {floating && <div className="card-resize-grip" role="separator" tabIndex={0} aria-label={`调整${label}浮窗大小`} onPointerDown={event => start(event, true)} {...handlers} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); onFrame(clampFrame({ ...frame, width: Math.min(640, frame.width + (event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0)), height: frame.height + (event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0) }, bounds)); } }} />}
    </section>
  </>;
}
