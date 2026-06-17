// Icon surface — re-exports Phosphor icons under the same names used throughout the app.
// All callers (Sidebar, JobCard, App, bits) stay unchanged.
import React from 'react';
import type { SVGProps } from 'react';
import {
  Briefcase as PhBriefcase,
  XCircle as PhXCircle,
  Waveform as PhWaveform,
  CalendarCheck as PhCalendarCheck,
  Clock as PhClock,
  MagnifyingGlass as PhMagnifyingGlass,
  CaretDown as PhCaretDown,
  ArrowSquareOut as PhArrowSquareOut,
  FileText as PhFileText,
  Sparkle as PhSparkle,
  Warning as PhWarning,
  Sidebar as PhSidebar,
  Tray as PhTray,
  Gear as PhGear,
  Terminal as PhTerminal,
  Power as PhPower,
  Copy as PhCopy,
  Eraser as PhEraser,
  ArrowLineDown as PhArrowLineDown,
} from '@phosphor-icons/react';

type P = SVGProps<SVGSVGElement>;

// Bridges SVGProps (className, style, width, height attrs) to Phosphor props.
// style.width/height override via inline style; SVG attr width/height map to size.
function wrap(PhIcon: React.ComponentType<any>) {
  return function Icon({ className, style, width, height }: P) {
    const attrSize = Number(width || height) || undefined;
    return <PhIcon className={className} style={style} size={attrSize} weight="bold" />;
  };
}

export const Briefcase = wrap(PhBriefcase);
export const XCircle   = wrap(PhXCircle);
export const Wave      = wrap(PhWaveform);
export const Check     = wrap(PhCalendarCheck);
export const Clock     = wrap(PhClock);
export const Search    = wrap(PhMagnifyingGlass);
export const Chevron   = wrap(PhCaretDown);
export const Ext       = wrap(PhArrowSquareOut);
export const Doc       = wrap(PhFileText);
export const Spark     = wrap(PhSparkle);
export const Warn      = wrap(PhWarning);
export const Panel     = wrap(PhSidebar);
export const Inbox     = wrap(PhTray);
export const Cog       = wrap(PhGear);
export const Terminal  = wrap(PhTerminal);
export const Power     = wrap(PhPower);
export const Copy      = wrap(PhCopy);
export const Eraser    = wrap(PhEraser);
export const ScrollDown = wrap(PhArrowLineDown);
