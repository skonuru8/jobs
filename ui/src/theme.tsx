import { createContext, useContext, useEffect, useState, useRef } from 'react';
import type { ReactNode } from 'react';
import { Cog } from './icons';

export type ThemeName = 'light' | 'dark';
export type CardStyle = 'minimal' | 'data' | 'editorial';

export const ACCENTS = ['#FFF48D', '#C9F27A', '#9BE7E2', '#B6A6F5', '#F4B27A'];

interface ThemeState {
  theme: ThemeName;
  accent: string;
  card: CardStyle;
  setTheme: (t: ThemeName) => void;
  setAccent: (a: string) => void;
  setCard: (c: CardStyle) => void;
}

const KEY = 'jobs.ui.prefs';
const ThemeCtx = createContext<ThemeState | null>(null);

function load(): { theme: ThemeName; accent: string; card: CardStyle } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { theme: 'light', accent: ACCENTS[0], card: 'minimal', ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { theme: 'light', accent: ACCENTS[0], card: 'minimal' };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const init = load();
  const [theme, setTheme] = useState<ThemeName>(init.theme);
  const [accent, setAccent] = useState<string>(init.accent);
  const [card, setCard] = useState<CardStyle>(init.card);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ theme, accent, card })); } catch { /* ignore */ }
  }, [theme, accent, card]);

  return (
    <ThemeCtx.Provider value={{ theme, accent, card, setTheme, setAccent, setCard }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

const CARD_LABELS: Record<CardStyle, string> = { minimal: 'Minimal', data: 'Data', editorial: 'Editorial' };

export function SettingsMenu() {
  const { theme, accent, card, setTheme, setAccent, setCard } = useTheme();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button className="btn btn-icon btn-ghost" onClick={() => setOpen(o => !o)} title="Settings" aria-label="Settings">
        <Cog />
      </button>
      {open && (
        <div className="settings-pop">
          <div className="settings-row">
            <span className="settings-lbl">Appearance</span>
            <button className={`toggle${theme === 'dark' ? ' on' : ''}`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              <span className="toggle-track"><span className="knob" /></span>
              <span className="toggle-txt">Dark mode</span>
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-lbl">Accent</span>
            <div className="swatches">
              {ACCENTS.map(c => (
                <button key={c} className={`swatch${accent === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setAccent(c)} aria-label={`Accent ${c}`} />
              ))}
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-lbl">Card style</span>
            <div className="segmented">
              {(Object.keys(CARD_LABELS) as CardStyle[]).map(c => (
                <button key={c} className={`seg${card === c ? ' on' : ''}`} onClick={() => setCard(c)}>{CARD_LABELS[c]}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
