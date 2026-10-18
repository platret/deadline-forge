import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Braces, Check, CheckCircle2, ChevronRight, Circle, Clock3, Code2, Copy, Database, ExternalLink, FileCode2, Flag, FlaskConical, History, Info, Layers2, ListChecks, Loader2, Menu, Pause, Play, RotateCcw, Shuffle, Sparkles, Square, Terminal, Timer, Wrench, X } from 'lucide-react';
import type { Challenge, GenerateOptions, Mode, Session } from '../shared/types';
import { difficulties, difficultyLabels, modeLabels, modes } from '../shared/types';
import { research, toolIdeas } from '../shared/research';

type Page = 'generator' | 'sessions' | 'sources' | 'tools';
type Tab = 'brief' | 'criteria' | 'kit' | 'contract';
const icons = { fullstack: Layers2, frontend: Code2, backend: Braces, database: Database, debugging: Wrench, testing: FlaskConical };
const focusDescriptions: Record<Mode, string> = { fullstack: 'The complete workflow', frontend: 'Interfaces & interactions', backend: 'Contracts & business rules', database: 'Queries & transactions', debugging: 'Find it. Fix it. Prove it.', testing: 'Catch the edge cases' };
const defaultOptions: GenerateOptions = { mode: 'fullstack', difficulty: 'nationals', minutes: 420, seed: '', scenario: 'random' };
const scenarios = [ ['random', 'Surprise me'], ['booking', 'Workspace booking'], ['inventory', 'Workshop stock control'], ['tickets', 'Repair desk workflow'], ['events', 'Workshop registrations'] ];
const isActive = (s: Session) => s.status === 'running' || s.status === 'paused';
const score = (s: Session) => s.challenge.criteria.filter(c => s.checked.includes(c.id)).reduce((total, c) => total + c.points, 0);
const time = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const date = (value: number) => new Intl.DateTimeFormat('en-CH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Zurich' }).format(value);

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed. Check the local server.');
  return body as T;
}
function optionsFor(c: Challenge): GenerateOptions { return { mode: c.mode, difficulty: c.difficulty, minutes: c.minutes, seed: c.seed, scenario: c.scenario }; }
function saveFile(name: string, body: string | Blob, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(body instanceof Blob ? body : new Blob([body], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function App() {
  const [page, setPage] = useState<Page>('generator');
  const [options, setOptions] = useState<GenerateOptions>(defaultOptions);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>('brief');
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [strict, setStrict] = useState(true);
  const [notes, setNotes] = useState('');
  const [now, setNow] = useState(Date.now());
  const [syncedAt, setSyncedAt] = useState(Date.now());
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width:640px)').matches);
  const [fileName, setFileName] = useState('START-HERE.md');
  const [historyFilter, setHistoryFilter] = useState('all');
  const briefRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const active = sessions.find(isActive);
  const finished = sessions.filter(s => !isActive(s));
  const totalMinutes = Math.round(sessions.reduce((n, s) => n + s.elapsedSeconds, 0) / 60);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [list, generated] = await Promise.all([
          api<Session[]>('/sessions'), api<Challenge>('/challenges', { method: 'POST', body: JSON.stringify({ ...defaultOptions, seed: 'nationals-2027' }) }),
        ]);
        if (!alive) return;
        setSessions(list);
        const current = list.find(isActive);
        if (current) { setSession(current); setChallenge(current.challenge); setOptions(optionsFor(current.challenge)); }
        else setChallenge(generated);
        setSyncedAt(Date.now()); setBusy('');
      } catch (e) { if (alive) { setError((e as Error).message); setBusy(''); } }
    };
    void load();
    return () => { alive = false; };
  }, []);
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(interval); }, []);
  useEffect(() => {
    const query = window.matchMedia('(max-width:640px)');
    const update = () => { setMobile(query.matches); setMenu(false); };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (menu && mobile) sidebarRef.current?.querySelector<HTMLElement>('a,button')?.focus();
  }, [menu, mobile]);
  useEffect(() => {
    if (!active) return;
    const poll = async () => {
      try {
        const fresh = await api<Session>(`/sessions/${active.id}`);
        setSessions(list => list.map(s => s.id === fresh.id ? fresh : s));
        setSession(previous => previous?.id === fresh.id ? fresh : previous);
        setSyncedAt(Date.now());
      } catch (e) { setError((e as Error).message); }
    };
    const interval = setInterval(() => { void poll(); }, 10000);
    const visible = () => { if (document.visibilityState === 'visible') void poll(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [active?.id]);
  useEffect(() => { setNotes(session?.notes || ''); }, [session?.id]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setConfirmFinish(false); setMenu(false); }
      if (event.key !== 'Tab' || !confirmFinish) return;
      const targets = modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
      if (!targets?.length) return;
      const first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); if (confirmFinish) previousFocus?.focus(); };
  }, [confirmFinish]);

  const shownRemaining = session ? Math.max(0, session.remainingSeconds - (session.status === 'running' ? Math.floor(Math.max(0, now - syncedAt) / 1000) : 0)) : (challenge?.minutes || options.minutes) * 60;
  const timedOut = session?.status === 'timed_out' || (session?.status === 'running' && shownRemaining === 0);
  const navigate = (target: Page) => { setPage(target); setMenu(false); setError(''); };
  const handle = async (key: string, work: () => Promise<void>) => {
    setBusy(key); setError('');
    try { await work(); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(''); }
  };
  const acceptSession = (fresh: Session) => {
    setSession(fresh); setSyncedAt(Date.now());
    setSessions(previous => previous.some(s => s.id === fresh.id) ? previous.map(s => s.id === fresh.id ? fresh : s) : [fresh, ...previous]);
  };
  const updateSession = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!session) return;
    return await handle(action, async () => { acceptSession(await api<Session>(`/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify({ action, ...extra }) })); });
  };
  const generate = async () => {
    await handle('generate', async () => {
      const c = await api<Challenge>('/challenges', { method: 'POST', body: JSON.stringify(options) });
      setChallenge(c); setSession(null); setTab('brief'); setFileName('START-HERE.md');
      setToast('New brief ready. Your time starts when you do.');
    });
  };
  const start = async () => {
    if (!challenge) return;
    await handle('start', async () => {
      const s = await api<Session>('/sessions', { method: 'POST', body: JSON.stringify({ options: optionsFor(challenge), strict }) });
      acceptSession(s); setToast(strict ? 'Exam session started. The clock keeps running.' : 'Practice session started.');
    });
  };
  const openSession = (s: Session) => {
    setSession(s); setChallenge(s.challenge); setOptions(optionsFor(s.challenge)); setSyncedAt(Date.now()); setTab('brief'); navigate('generator');
    void api<Session>(`/sessions/${s.id}`).then(fresh => { acceptSession(fresh); }).catch(e => setError(e.message));
  };
  const downloadKit = async () => {
    if (!challenge) return;
    await handle('download', async () => {
      const response = session ? await fetch(`/api/kits/${session.id}`) : await fetch('/api/kits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(optionsFor(challenge)) });
      if (!response.ok) throw new Error('Could not prepare the kit. Try again.');
      saveFile(`deadline-forge-${challenge.scenario}-${challenge.id}.zip`, await response.blob());
      setToast('Practice kit downloaded. Start with START-HERE.md.');
    });
  };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setToast('Copied to clipboard.'); } catch { setError('Clipboard unavailable. Select and copy the text directly.'); }
  };
  const exportHistory = () => saveFile('deadline-forge-session-log.json', JSON.stringify({ exportedAt: new Date().toISOString(), unofficial: true, selfAssessed: true, sessions }, null, 2), 'application/json');

  return <div className="app-shell">
    <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`} aria-label="Main navigation" ref={sidebarRef} inert={mobile && !menu}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('generator'); }} aria-label="Deadline Forge home"><span className="brand-mark"><i /><i /></span><span className="brand-wordmark">DEADLINE<span className="brand-forge">FORGE</span></span></a>
      <div className="sidebar-label">THE TRAINING ROOM</div>
      <nav>
        {([
          ['generator', Sparkles, 'Challenge generator'], ['sessions', History, 'Session log'], ['sources', FileCode2, 'Competition notes'], ['tools', Wrench, 'Build next'],
        ] as const).map(([key, Icon, label]) => <button key={key} className={`nav-link ${page === key ? 'selected' : ''}`} onClick={() => navigate(key)} aria-current={page === key ? 'page' : undefined}><Icon size={18} /><span>{label}</span>{key === 'sessions' && <span className="nav-count">{sessions.length}</span>}</button>)}
      </nav>
      {active && <button className="resume-card" onClick={() => openSession(active)}><span className="live-dot" /> SESSION IN PROGRESS <ArrowUpRight size={14} /><strong>{active.challenge.title}</strong><span>{active.status === 'paused' ? 'Paused · resume when ready' : 'The clock is running'}</span></button>}
      <div className="sidebar-bottom">
        <div className="road-label"><span className="swiss-cross">+</span> ROAD TO NATIONALS</div>
        <div className="year">20<span>27</span><ArrowUpRight size={22} /></div>
        <p>One focused session<br />at a time.</p>
        <div className="local-status"><span /> Local workspace <Database size={12} /></div>
      </div>
    </aside>
    {menu && <button className="menu-backdrop" aria-label="Close navigation" onClick={() => setMenu(false)} />}
    <div className="main-shell" inert={mobile && menu}>
      <header className="topbar"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMenu(!menu)}><Menu size={22} /></button><div className="breadcrumb">SKILL 09 <ChevronRight size={12} /><span>{ { generator: 'Practice workspace', sessions: 'Session log', sources: 'Competition notes', tools: 'Build next' }[page]}</span></div><span className="unofficial"><span /> UNOFFICIAL PRACTICE</span></header>
      <main>
        {error && <div className="error-banner" role="alert"><Info size={18} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}
        {page === 'generator' && <>
          <section className="page-intro">
            <div><div className="eyebrow"><span className="tiny-line" /> YOUR NEXT PERSONAL BEST</div><h1>Good code.<br /><span>Under pressure.</span></h1><p>Realistic briefs. A running clock. A better developer.<br className="desktop-br" /> Make your next practice session count.</p></div>
            <div className="intro-graphic" aria-hidden="true"><div className="graphic-lines">{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</div><span className="graphic-caption">PREPARE / BUILD / REPEAT</span><div className="graphic-09">09<span>↗</span></div></div>
          </section>
          <div className="stack-note"><Info size={16} /><span><strong>Your practice stack, your choice.</strong> Published national guidance specifies Java or .NET. This React / TypeScript / SQLite trainer builds transferable skills.</span><button onClick={() => navigate('sources')}>Source notes <ArrowUpRight size={14} /></button></div>
          <section className="configuration" aria-labelledby="config-title">
            <div className="section-top"><div className="section-label"><span>01</span><h2 id="config-title">Set your focus</h2></div><span className="small-muted">A different challenge. The same discipline.</span></div>
            <div className="focus-grid" role="group" aria-label="Practice focus">{modes.map(mode => {
              const Icon = icons[mode]; return <button key={mode} className={`focus-button ${options.mode === mode ? 'active' : ''}`} onClick={() => setOptions({ ...options, mode })} aria-pressed={options.mode === mode}><Icon size={21} strokeWidth={1.7} /><strong>{modeLabels[mode]}</strong><span>{focusDescriptions[mode]}</span>{options.mode === mode && <Check size={13} className="focus-check" />}</button>;
            })}</div>
            <div className="config-fields">
              <fieldset className="difficulty-field"><legend>DIFFICULTY</legend><div className="segmented">{difficulties.map(difficulty => <button key={difficulty} aria-pressed={options.difficulty === difficulty} className={options.difficulty === difficulty ? 'active' : ''} onClick={() => setOptions({ ...options, difficulty })}>{difficultyLabels[difficulty]}</button>)}</div></fieldset>
              <label><span className="field-label">TIME LIMIT</span><select value={options.minutes} onChange={e => setOptions({ ...options, minutes: Number(e.target.value) })}>{[30, 45, 60, 90, 120, 180, 240, 420].map(n => <option key={n} value={n}>{n} minutes{n === 180 ? ' · regional length' : n === 420 ? ' · national length' : ''}</option>)}</select></label>
              <label><span className="field-label">SCENARIO</span><select value={options.scenario || 'random'} onChange={e => setOptions({ ...options, scenario: e.target.value })}>{scenarios.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
            </div>
            <div className="config-footer"><label className="seed-field"><Shuffle size={15} /><span>Seed</span><input value={options.seed} onChange={e => setOptions({ ...options, seed: e.target.value })} maxLength={80} placeholder="Random each time" aria-label="Challenge seed" /><button className="icon-button" title="Use a new random seed" aria-label="Use a new random seed" onClick={() => setOptions({ ...options, seed: crypto.randomUUID().slice(0, 8) })}><RotateCcw size={14} /></button></label><button className="primary" disabled={Boolean(busy)} onClick={() => void generate()}>{busy === 'generate' || busy === 'loading' ? <Loader2 size={17} className="spin" /> : <Shuffle size={17} />}Generate challenge<ArrowRight size={17} /></button></div>
          </section>
          {challenge ? <div className="workspace-grid" ref={briefRef}>
            <section className="challenge-panel" aria-label="Generated challenge">
              <div className="challenge-heading"><div className="section-label"><span>02</span><h2>Your challenge</h2></div><span className="draft-badge">{session ? session.status.replace('_', ' ') : 'READY WHEN YOU ARE'}</span></div>
              <div className="challenge-cover"><div className="cover-top"><span className="micro-label">BRIEF / {challenge.id.slice(0, 4).toUpperCase()}</span><span className="outline-badge">{difficultyLabels[challenge.difficulty]}</span></div><h3>{challenge.title}</h3><p>{challenge.client} <span>·</span> {challenge.city}, CH</p><div className="challenge-tags">{challenge.focus.map(f => <span key={f}>{f}</span>)}<span className="duration-tag"><Clock3 size={12} />{challenge.minutes} min</span></div></div>
              <div className="challenge-tabbar" role="tablist" aria-label="Challenge sections">{([['brief', 'The brief'], ['criteria', 'Criteria'], ['kit', 'Data & tests'], ['contract', 'API contract']] as const).map(([key, label]) => <button key={key} id={`tab-${key}`} role="tab" aria-selected={tab === key} aria-controls={`panel-${key}`} tabIndex={tab === key ? 0 : -1} onKeyDown={event => {
                const order: Tab[] = ['brief', 'criteria', 'kit', 'contract'];
                let next: Tab | undefined;
                if (event.key === 'ArrowRight') next = order[(order.indexOf(key) + 1) % order.length];
                if (event.key === 'ArrowLeft') next = order[(order.indexOf(key) + order.length - 1) % order.length];
                if (event.key === 'Home') next = 'brief';
                if (event.key === 'End') next = 'contract';
                if (next) { event.preventDefault(); setTab(next); document.getElementById(`tab-${next}`)?.focus(); }
              }} onClick={() => setTab(key)} className={tab === key ? 'active' : ''}>{label}{key === 'criteria' && <span>{challenge.criteria.length}</span>}</button>)}</div>
              <div className="challenge-content" id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
                {tab === 'brief' && <>
                  <div className="micro-label coral">THE SITUATION</div><h4>A real problem to solve.</h4><p className="brief-summary">{challenge.summary}</p>
                  <div className="brief-block"><span className="step-number">A</span><div><h5>Your assignment</h5><p>{challenge.brief[0]}</p></div></div>
                  <div className="brief-block"><span className="step-number">B</span><div><h5>The business rule</h5><p>{challenge.brief[2].replace('Core rule: ', '')}</p></div></div>
                  <div className="brief-block"><span className="step-number">C</span><div><h5>Work within the constraints</h5><p>{challenge.brief[4]}</p><p className="input-contract">{challenge.brief[3]}</p></div></div>
                  {challenge.modules && <div className="nationals-modules"><div className="micro-label coral">CONNECTED MODULES · UNOFFICIAL LAB</div>{challenge.modules.map((module, i) => <div key={module.name}><span>{String(i + 1).padStart(2, '0')}</span><strong>{module.name}</strong><small>{module.minutes} min</small></div>)}<p>The selected time budget is demanding. Public tests are a lower bound; add restart, concurrency and UI evidence.</p></div>}
                  {challenge.difficulty === 'stretch' && <div className="extra-constraint"><Flag size={17} /><div><strong>Extra constraint</strong><p>{challenge.criteria.find(c => c.id === 'stretch')?.detail}</p></div></div>}
                  <div className="deliverables"><h5><ArrowUpRight size={16} />What to hand in</h5>{challenge.deliverables.map(d => <div key={d}><Check size={14} />{d}</div>)}</div>
                  <button className="text-link" onClick={() => setTab('criteria')}>Review the acceptance criteria <ArrowRight size={16} /></button>
                </>}
                {tab === 'criteria' && <><div className="criteria-intro"><div><div className="micro-label coral">THE MARKING PLAN</div><h4>Make every point count.</h4></div><span className="score-total">{session ? score(session) : 0}<small> / 100</small></span></div><p className="muted">Self-assessed practice points. Tick a criterion only after checking its evidence. {session ? 'Your checklist is saved in SQLite.' : 'Start a session to save your checklist.'}</p><div className="criteria-list">{challenge.criteria.map(c => <label key={c.id} className={`criterion ${session?.checked.includes(c.id) ? 'checked' : ''}`}><input type="checkbox" checked={Boolean(session?.checked.includes(c.id))} disabled={!session || Boolean(busy)} onChange={() => { if (session) void updateSession('progress', { checked: session.checked.includes(c.id) ? session.checked.filter(id => id !== c.id) : [...session.checked, c.id] }); }} /><span className="check-box">{session?.checked.includes(c.id) && <Check size={14} />}</span><span className="criterion-text"><span className="criterion-category">{c.category}</span><strong>{c.title}</strong><span>{c.detail}</span></span><span className="points">{c.points}<small>pts</small></span></label>)}</div><div className="test-limit"><Info size={15} />The exported tests cover a subset of the brief. Checklist points are never an official or automated competition score.</div></>}
                {tab === 'kit' && <><div className="micro-label coral">YOUR STARTING MATERIAL</div><h4>Less setup. More practice.</h4><p className="muted">Download the whole kit, open START-HERE.md, and build your solution in your own editor. The trainer does not run submitted code.</p><div className="kit-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => void downloadKit()}><ArrowDownToLine size={16} />Download kit .zip</button><span>{challenge.files.length} files · no helper dependencies</span></div><div className="file-browser"><label className="field-label" htmlFor="file-select">PREVIEW A FILE</label><select id="file-select" value={challenge.files.some(f => f.name === fileName) ? fileName : 'START-HERE.md'} onChange={e => setFileName(e.target.value)}>{challenge.files.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}</select><div className="code-toolbar"><span><FileCode2 size={14} />{fileName}</span><button className="icon-button" aria-label="Download selected file" onClick={() => { const f = challenge.files.find(f => f.name === fileName) || challenge.files.at(-1)!; saveFile(f.name, f.content); }}><ArrowDownToLine size={15} /></button></div><pre className="file-preview"><code>{(challenge.files.find(f => f.name === fileName) || challenge.files.at(-1)!).content}</code></pre></div><div className="fixture-counts">{Object.entries(challenge.fixtures).map(([name, rows]) => <span key={name}><Database size={14} /><strong>{rows.length}</strong> {name}</span>)}</div></>}
                {tab === 'contract' && <><div className="micro-label coral">THE INTERFACE</div><h4>{challenge.endpoints.length ? 'A contract you can test.' : 'A focused exercise.'}</h4>{challenge.endpoints.length ? <><p className="muted">{challenge.difficulty === 'nationals' ? 'CONTRACT.md is part of this brief. It defines every route, public practice token, field and status. ' : 'JSON field names match the supplied fixtures. '}Error responses use <code>{'{"error":"message"}'}</code>. Successful array responses are ordered by id.</p><div className="endpoint-list">{challenge.endpoints.map((endpoint, i) => <details key={i} open={i === 0}><summary><span className={`method method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span><code>{endpoint.path}</code><ChevronRight size={15} /></summary><p>{endpoint.description}</p>{endpoint.request !== undefined && <><div className="field-label">REQUEST</div><pre><code>{JSON.stringify(endpoint.request, null, 2)}</code></pre></>}<div className="field-label">RESPONSE · {endpoint.status}</div><pre><code>{endpoint.status === 204 ? '(empty body)' : JSON.stringify(endpoint.response, null, 2)}</code></pre></details>)}</div></> : <p className="muted">This {modeLabels[challenge.mode].toLowerCase()} exercise works directly with {challenge.mode === 'database' ? 'SQLite queries' : 'a pure business-rule function'}. See Data & tests for its runnable contract and examples.</p>}</>}
              </div>
              <div className="challenge-foot"><span>SEED <strong>{challenge.seed}</strong><button className="icon-button" aria-label="Copy challenge seed" onClick={() => void copy(challenge.seed)}><Copy size={12} /></button></span><span>GENERATOR V{challenge.version} · UNOFFICIAL</span></div>
            </section>
            <aside className="session-column" aria-label="Session controls">
              <section className={`timer-panel ${session?.status === 'running' && !timedOut ? 'timer-running' : ''}`}>
                <div className="timer-header"><span className="micro-label"><Timer size={15} />THE CLOCK</span>{session?.status === 'running' && !timedOut ? <span className="timer-status"><i />RUNNING</span> : <span className="timer-status">{timedOut ? 'TIME’S UP' : session?.status === 'paused' ? 'PAUSED' : session?.status === 'completed' ? 'FINISHED' : 'NOT STARTED'}</span>}</div>
                <div className="clock-time" aria-label={`${time(shownRemaining)} remaining`}>{time(shownRemaining)}</div><div className="time-scale"><span style={{ width: `${100 * (1 - shownRemaining / (challenge.minutes * 60))}%` }} /></div><div className="timer-caption"><span>{challenge.minutes} MINUTE LIMIT</span><span>{session ? session.strict ? 'EXAM' : 'PRACTICE' : strict ? 'EXAM' : 'PRACTICE'}</span></div>
                {!session && <><div className="timer-mode"><button className={!strict ? 'active' : ''} aria-pressed={!strict} onClick={() => setStrict(false)}>Practice</button><button className={strict ? 'active' : ''} aria-pressed={strict} onClick={() => setStrict(true)}>Exam</button></div><p className="timer-help">{strict ? 'No pauses. The timer continues while this page is closed.' : 'Pause when you need to. The timer and checklist survive a reload.'}</p><button className="primary start-button" disabled={Boolean(busy) || Boolean(active)} onClick={() => void start()}><Play size={16} fill="currentColor" />Start session<ArrowRight size={16} /></button>{active && <button className="text-link active-link" onClick={() => openSession(active)}>Return to your active session <ArrowRight size={14} /></button>}</>}
                {session && isActive(session) && !timedOut && <><div className="session-buttons">{!session.strict && <button className="secondary" disabled={Boolean(busy)} onClick={() => void updateSession(session.status === 'paused' ? 'resume' : 'pause')}>{session.status === 'paused' ? <Play size={15} /> : <Pause size={15} />}{session.status === 'paused' ? 'Resume' : 'Pause'}</button>}<button className="primary" disabled={Boolean(busy)} onClick={() => setConfirmFinish(true)}><Square size={14} />Finish</button></div><p className="timer-help">{session.strict ? 'Exam mode · pauses are disabled.' : 'Keep your focus. Save evidence as you go.'}</p></>}
                {session && (timedOut || session.status === 'completed') && <div className="session-result"><CheckCircle2 size={18} /><div><strong>{timedOut ? 'Time limit reached.' : 'Session in the books.'}</strong><span>Review your evidence and add a reflection.</span></div></div>}
              </section>
              <section className="ready-panel"><div className="micro-label">BEFORE YOU BEGIN</div><h4>Read. Plan. Then build.</h4><div><span>01</span><p>Read the full brief and the acceptance criteria.</p></div><div><span>02</span><p>Download your kit. Check the fixtures and test commands.</p></div><div><span>03</span><p>Prioritise a working slice. Leave time for the hand-in.</p></div><button className="secondary download-button" disabled={Boolean(busy)} onClick={() => void downloadKit()}>{busy === 'download' ? <Loader2 size={16} className="spin" /> : <ArrowDownToLine size={16} />}Download practice kit</button></section>
              {session && <section className="reflection-panel"><div className="micro-label">POST-SESSION NOTES</div><h4>What will you do differently?</h4><label className="sr-only" htmlFor="reflection">Session reflection</label><textarea id="reflection" value={notes} onChange={e => setNotes(e.target.value)} maxLength={12000} placeholder="What slowed you down? Which test saved you? What needs another rep?" rows={5} /><button className="secondary" disabled={Boolean(busy) || notes === session.notes} onClick={() => { void updateSession('progress', { notes }).then(saved => { if (saved) setToast('Reflection saved.'); }); }}>Save reflection</button><span className="self-score">Self-assessed <strong>{score(session)} / 100</strong></span></section>}
              <div className="quiet-note"><span className="swiss-cross">+</span><p>Built for your road to 2027.<br />Independent practice, at your pace.</p></div>
            </aside>
          </div> : <div className="loading-state">{busy ? <><Loader2 className="spin" />Preparing your first brief…</> : <><Info />Could not load a brief.<button className="secondary" onClick={() => void generate()}>Try again</button></>}</div>}
        </>}
        {page === 'sessions' && <>
          <PageHeading eyebrow="YOUR TRAINING RECORD" title={<>Put the work<br /><span>on the record.</span></>} description="Review your sessions, keep the lessons, and make the next rep better." />
          <div className="stat-strip"><div><span>SESSIONS COMPLETED</span><strong>{finished.length.toString().padStart(2, '0')}</strong></div><div><span>TIME PRACTISED</span><strong>{totalMinutes}<small> min</small></strong></div><div><span>AVG. SELF-ASSESSMENT</span><strong>{finished.length ? Math.round(finished.reduce((n, s) => n + score(s), 0) / finished.length) : '—'}<small>{finished.length ? ' / 100' : ''}</small></strong></div></div>
          <div className="history-toolbar"><div className="section-label"><span>LOG</span><h2>Your sessions</h2></div><div><select value={historyFilter} aria-label="Filter sessions" onChange={e => setHistoryFilter(e.target.value)}><option value="all">All focuses</option>{modes.map(mode => <option key={mode} value={mode}>{modeLabels[mode]}</option>)}</select><button className="secondary" disabled={!sessions.length} onClick={exportHistory}><ArrowDownToLine size={15} />Export log</button></div></div>
          {sessions.filter(s => historyFilter === 'all' || s.challenge.mode === historyFilter).length ? <div className="history-list">{sessions.filter(s => historyFilter === 'all' || s.challenge.mode === historyFilter).map(s => <button key={s.id} className="history-row" onClick={() => openSession(s)}><span className="history-icon">{isActive(s) ? <Timer size={21} /> : <CheckCircle2 size={21} />}</span><span className="history-title"><strong>{s.challenge.title}</strong><span>{date(s.startedAt)} · {modeLabels[s.challenge.mode]} · {difficultyLabels[s.challenge.difficulty]}</span></span><span className={`history-status ${isActive(s) ? 'status-active' : ''}`}>{s.status.replace('_', ' ')}</span><span className="history-score">{score(s)}<small> / 100</small></span><ArrowUpRight size={19} /></button>)}</div> : <div className="empty-state"><History size={36} strokeWidth={1.2} /><h3>{sessions.length ? 'No sessions in this focus yet.' : 'Your first rep starts here.'}</h3><p>Completed and active sessions appear here with your saved checklist and reflections.</p><button className="primary" onClick={() => navigate('generator')}>Generate a challenge <ArrowRight size={16} /></button></div>}
          <p className="history-note"><Database size={14} />Saved in your local SQLite database. Scores are self-assessed. The log shows the 200 most recent sessions.</p>
        </>}
        {page === 'sources' && <>
          <PageHeading eyebrow="KNOW THE CONTEXT" title={<>Train with intent.<br /><span>Know the difference.</span></>} description="Verified public guidance, the limits of this trainer, and what still needs confirming." />
          <div className="research-callout"><Flag size={25} /><div><h3>A practice stack, not the national environment.</h3><p>{research.stack}</p></div></div>
          <div className="format-grid"><div><span className="micro-label">REGIONAL OVERVIEW</span><strong>3<span>hours</span></strong><p>Desktop application & database access.<br />English individual competition.</p></div><div><span className="micro-label">NATIONAL OVERVIEW</span><strong>7<span>hours</span></strong><p>Connected software tasks & speed work.<br />Published technologies: Java or .NET.</p></div></div>
          <div className="section-top"><div className="section-label"><span>REF</span><h2>The source notes</h2></div><span className="small-muted">Checked {research.checked}</span></div>
          <div className="source-list">{research.sources.map((s, i) => <article className="source-row" key={s.url}><span className="source-index">0{i + 1}</span><div><span className="micro-label">{s.type}</span><h3><a href={s.url} target="_blank" rel="noreferrer">{s.title}<ExternalLink size={16} /></a></h3><p>{s.findings}</p></div></article>)}</div>
          <div className="research-fineprint"><h4>What remains unverified</h4><p>{research.unknown}</p><h4>How generated practice differs</h4><p>Four business scenarios are combined with six focuses and four difficulties. Nationals adds connected allocation modules, temporal capacity, team isolation, idempotency, legacy import parsing and adversarial tests. SQLite work adds window queries and migration evidence; testing includes eight service mutants. “Competition” is a training difficulty; a seven-hour limit is a configurable endurance session, not a replica of a full national paper. English briefs are intentional.</p><p>Briefs are generated locally from versioned templates. No AI service, account or API key is needed. The trainer stores progress, serves kits and runs the clock; implement solutions in your own editor and run their tests separately.</p><p>{research.disclaimer}</p></div>
        </>}
        {page === 'tools' && <>
          <PageHeading eyebrow="SMALL TOOLS. BETTER PREPARATION." title={<>Build your own<br /><span>competitive edge.</span></>} description="Five useful iPhone, Mac and web products you could build for yourself." />
          <div className="tool-list">{toolIdeas.map(tool => <article key={tool.number} className="tool-idea"><span className="tool-number">{tool.number}</span><div><span className="tool-tag">{tool.tag}</span><h3>{tool.title}</h3><p>{tool.description}</p><span className="tool-effort"><Clock3 size={14} />{tool.time}</span></div><ArrowUpRight size={27} /></article>)}</div>
          <div className="build-next-note"><Terminal size={24} /><div><h3>My picks: DeskState or Proofpack.</h3><p>Choose DeskState for a native Mac product you can use every day. Choose Proofpack for a web product that also makes your own project hand-ins and portfolio stronger.</p></div></div>
        </>}
        <footer className="page-footer"><span>Deadline Forge <span>/</span> SOFTWARE PRACTICE</span><span>Independent. Unofficial. Built for the next rep.</span><button onClick={() => navigate('sources')}>Sources & scope <ArrowUpRight size={12} /></button></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
    {confirmFinish && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setConfirmFinish(false); }}><section className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="finish-title"><button className="modal-close icon-button" aria-label="Close finish dialog" onClick={() => setConfirmFinish(false)}><X size={20} /></button><Flag size={30} className="coral" /><h2 id="finish-title">Call this session done?</h2><p>The clock will stop and your session will stay in the log. You can still review the brief, update your checklist and save a reflection.</p><div className="modal-actions"><button className="secondary" onClick={() => setConfirmFinish(false)} autoFocus>Keep working</button><button className="primary" disabled={Boolean(busy)} onClick={() => { void updateSession('finish').then(saved => { if (saved) setConfirmFinish(false); }); }}>Finish session <Check size={16} /></button></div></section></div>}
  </div>;
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: ReactNode; description: string }) {
  return <section className="page-intro secondary-intro"><div><div className="eyebrow"><span className="tiny-line" />{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="intro-side-mark" aria-hidden="true">↗</div></section>;
}
