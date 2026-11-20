"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell, CalendarDays, Check, ChevronLeft, ChevronRight, CircleHelp,
  Clock3, FileText, Grid2X2, Inbox, LayoutDashboard, ListChecks, Mail, Menu,
  MessageCircle, MoreHorizontal, Plus, Search, Settings2, Sparkles, Upload,
  X, Zap,
} from "lucide-react";

type Source = "WhatsApp" | "Email" | "College Portal" | "Classroom" | "PDF";
type Message = { source: Source; text: string };
type Deadline = {
  id: string; subject: string; task: string; dueDate: string; dueTime: string; source: Source;
  sources: Source[]; rawText: string; messages: Message[]; subtasks: string[]; checked: boolean[];
  progress: number; createdAt: string; files: string[];
};
type Extracted = Omit<Deadline, "id" | "sources" | "messages" | "checked" | "progress" | "createdAt" | "files">;
type View = "Home" | "Schedule" | "Batch Judge Test";
type ModalTab = "Paste message" | "Upload PDF" | "Batch test";

const STORAGE_KEY = "deadlinesync.deadlines.v1";
const SOURCES: Source[] = ["WhatsApp", "Email", "College Portal", "Classroom"];
const SAMPLE_TEXTS = [
  "Kal shaam 5 baje tak DBMS file submit kar dena — normalization practical, pages 12-18.",
  "Hi everyone, OS assignment on process scheduling is due next Friday at 5pm. Upload the PDF on the portal.",
  "Reminder: Data Structures lab record submit by 24 Nov, 11:59 PM. Bring the signed observation sheet too.",
  "Tomorrow 2 baje tak CN subnetting worksheet classroom pe upload karna hai.",
  "Dear students, the Software Engineering mini-project proposal is due on Monday, 30 November at 4:30 PM.",
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localToday = () => dateKey(new Date());
const humanDate = (value: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", options).format(date);
};
const sourceIcon = (source: Source, size = 11) => {
  if (source === "WhatsApp") return <MessageCircle size={size} />;
  if (source === "Email") return <Mail size={size} />;
  if (source === "PDF") return <FileText size={size} />;
  return <Inbox size={size} />;
};
const aliases: Record<string, string> = {
  dbms: "database", "data base": "database", "operating system": "os", os: "os",
  "data structure": "datastructures", "computer network": "network", cn: "network",
};
function canonical(value: string) {
  let text = value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\b(the|and|for|of|in|a|an|assignment|submit|submission|work)\b/g, " ").replace(/\s+/g, " ").trim();
  for (const [from, to] of Object.entries(aliases)) text = text.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  return text;
}
function similarity(a: string, b: string) {
  const left = new Set(canonical(a).split(" ").filter((x) => x.length > 1));
  const right = new Set(canonical(b).split(" ").filter((x) => x.length > 1));
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((x) => right.has(x)).length;
  return overlap / new Set([...left, ...right]).size;
}
function dayDistance(a: string, b: string) {
  return Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400000;
}
function shouldMerge(existing: Deadline, next: Extracted) {
  if (dayDistance(existing.dueDate, next.dueDate) > 1) return false;
  const sameSubject = similarity(existing.subject, next.subject) > 0.32 || canonical(existing.subject) === canonical(next.subject);
  if (!sameSubject) return similarity(`${existing.subject} ${existing.task}`, `${next.subject} ${next.task}`) > 0.48;
  const oldTask = canonical(existing.task), newTask = canonical(next.task);
  const generic = /\b(file|practical|lab|record|assignment|worksheet|homework)\b/;
  return similarity(oldTask, newTask) > 0.28 || (generic.test(oldTask) && generic.test(newTask));
}
function makeDeadline(item: Extracted, files: string[] = []): Deadline {
  return { ...item, id: crypto.randomUUID(), sources: [item.source], messages: [{ source: item.source, text: item.rawText }], checked: item.subtasks.map(() => false), progress: 0, createdAt: new Date().toISOString(), files };
}
function mergeDeadline(existing: Deadline, next: Extracted, files: string[] = []): Deadline {
  const sources = Array.from(new Set([...existing.sources, next.source]));
  const messages = existing.messages.some((m) => m.text === next.rawText)
    ? existing.messages : [...existing.messages, { source: next.source, text: next.rawText }];
  const subtasks = Array.from(new Set([...existing.subtasks, ...next.subtasks])).slice(0, 5);
  const checked = subtasks.map((task) => {
    const oldIndex = existing.subtasks.indexOf(task);
    return oldIndex >= 0 ? existing.checked[oldIndex] ?? false : false;
  });
  return { ...existing, sources, source: existing.source, messages, subtasks, checked, files: Array.from(new Set([...existing.files, ...files])) };
}
function displayTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (Number.isNaN(hour)) return value;
  return `${hour % 12 || 12}:${pad(minute)} ${hour >= 12 ? "PM" : "AM"}`;
}
function dateTimeLabel(value: string) {
  if (value === localToday()) return "Today";
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (value === dateKey(tomorrow)) return "Tomorrow";
  return humanDate(value, { weekday: "short", day: "numeric", month: "short" });
}

export default function HomePage() {
  const [view, setView] = useState<View>("Home");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState(localToday());
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<ModalTab>("Paste message");
  const [detail, setDetail] = useState<Deadline | null>(null);
  const [editing, setEditing] = useState<Deadline | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore browser state after SSR hydration to avoid a markup mismatch.
      if (saved) setDeadlines(JSON.parse(saved) as Deadline[]);
    } catch { localStorage.removeItem(STORAGE_KEY); }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify(deadlines)); }, [deadlines, ready]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 3000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setModalOpen(false); setDetail(null); setEditing(null); } };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, []);

  const sorted = useMemo(() => [...deadlines].sort((a,b) => `${a.dueDate}T${a.dueTime}`.localeCompare(`${b.dueDate}T${b.dueTime}`)), [deadlines]);
  const filtered = useMemo(() => sorted.filter((d) => `${d.subject} ${d.task} ${d.sources.join(" ")}`.toLowerCase().includes(query.toLowerCase())), [sorted, query]);
  const completed = deadlines.filter((d) => d.progress >= 100).length;
  const percent = deadlines.length ? Math.round(completed / deadlines.length * 100) : 0;
  const upcoming = sorted.filter((d) => d.dueDate >= localToday() && d.progress < 100);
  const dueOnSelected = sorted.filter((d) => d.dueDate === selectedDate);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; }), []);

  async function extractOne(text: string, source: Source): Promise<Extracted> {
    const response = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, source }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not extract a deadline.");
    return result as Extracted;
  }
  function addExtracted(item: Extracted, files: string[] = []) {
    setDeadlines((current) => {
      const match = current.find((deadline) => shouldMerge(deadline, item));
      return match ? current.map((deadline) => deadline.id === match.id ? mergeDeadline(deadline, item, files) : deadline) : [...current, makeDeadline(item, files)];
    });
  }
  async function extractAndSave(text: string, source: Source, files: string[] = []) {
    setBusy(true);
    try { const result = await extractOne(text, source); addExtracted(result, files); setModalOpen(false); setToast("Deadline added to your schedule"); }
    catch (error) { setToast(error instanceof Error ? error.message : "Extraction failed"); }
    finally { setBusy(false); }
  }
  function updateDeadline(id: string, patch: Partial<Deadline>) {
    setDeadlines((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
    setDetail((item) => item?.id === id ? { ...item, ...patch } : item);
  }
  function toggleSubtask(id: string, index: number) {
    const item = deadlines.find((d) => d.id === id); if (!item) return;
    const checked = item.checked.map((value, i) => i === index ? !value : value);
    const done = checked.filter(Boolean).length;
    updateDeadline(id, { checked, progress: item.subtasks.length ? Math.round(done / item.subtasks.length * 100) : item.progress });
  }
  function removeDeadline(id: string) { setDeadlines((items) => items.filter((d) => d.id !== id)); setDetail(null); setToast("Deadline deleted"); }
  function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const data = new FormData(event.currentTarget);
    updateDeadline(editing.id, { subject: String(data.get("subject")), task: String(data.get("task")), dueDate: String(data.get("dueDate")), dueTime: String(data.get("dueTime")) });
    setEditing(null); setToast("Deadline updated");
  }
  async function runBatch(text: string, source: Source, onResult: (items: Extracted[]) => void) {
    const messages = text.split(/\n\s*\n/).map((m) => m.trim()).filter(Boolean);
    if (!messages.length) { setToast("Add one or more messages first"); return; }
    setBusy(true);
    try {
      const results: Extracted[] = [];
      for (const message of messages) results.push(await extractOne(message, source));
      onResult(results);
    } catch (error) { setToast(error instanceof Error ? error.message : "Batch test failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Zap size={19} fill="white" /></span>DeadlineSync</div>
        <div className="nav-label">Workspace</div>
        <nav className="nav-list">
          {(["Home", "Schedule", "Batch Judge Test"] as View[]).map((item) => <button className={`nav-item ${view === item ? "active" : ""}`} key={item} onClick={() => setView(item)}>
            {item === "Home" ? <LayoutDashboard size={17} /> : item === "Schedule" ? <CalendarDays size={17} /> : <Sparkles size={17} />}{item}
          </button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="nav-label">Personal</div>
          <button className="nav-item"><Settings2 size={17} />Settings</button>
          <button className="nav-item"><CircleHelp size={17} />Help center</button>
          <div className="profile-row"><div className="avatar">DS</div><div><div style={{fontSize:12,fontWeight:700}}>Student space</div><div style={{fontSize:10,color:"#898995",marginTop:4}}>IST · Asia/Kolkata</div></div><MoreHorizontal size={16} color="#8e8e99" style={{marginLeft:"auto"}} /></div>
        </div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div style={{display:"flex",alignItems:"center",gap:11}}>
            <button className="icon-btn mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen((open) => !open)}><Menu size={18}/></button>
            <div><div className="greeting-kicker">{view === "Home" ? "Your campus, in sync" : "Your assignment planner"}</div><h1 className="greeting">{view === "Home" ? "Be productive today" : view}</h1></div>
          </div>
          <div className="top-actions"><button className="icon-btn" aria-label="Help"><CircleHelp size={17}/></button><button className="icon-btn" aria-label="Notifications"><Bell size={17}/><span className="notification-dot"/></button></div>
        </header>
        {mobileNavOpen && <nav className="mobile-nav-popover">{(["Home", "Schedule", "Batch Judge Test"] as View[]).map((item) => <button key={item} className={`nav-item ${view === item ? "active" : ""}`} onClick={() => { setView(item); setMobileNavOpen(false); }}>{item === "Home" ? <LayoutDashboard size={16}/> : item === "Schedule" ? <CalendarDays size={16}/> : <Sparkles size={16}/>} {item}</button>)}</nav>}

        {view === "Home" && <>
          <label className="search-box"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search deadlines or subjects..."/><span style={{fontSize:10,color:"#646470"}}>⌘ K</span></label>
          <section className="progress-card card">
            <div><div className="eyebrow">Your week at a glance</div><div className="progress-title">Upcoming Progress</div><div className="progress-meta">{completed} of {deadlines.length} tasks done <span style={{color:"#545461",margin:"0 5px"}}>·</span> Stay on top of your week</div><div className="today-pill"><CalendarDays size={12}/>{new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",weekday:"short",day:"numeric",month:"short"}).format(new Date())} · IST</div></div>
            <div className="ring" style={{"--progress":`${percent * 3.6}deg`} as React.CSSProperties}><div className="ring-inner">{percent}%<small>complete</small></div></div>
          </section>
          <section>
            <div className="section-head"><h2 className="section-title">Your subjects</h2><button className="section-link" onClick={() => setView("Schedule")}>View schedule →</button></div>
            <div className="bento-grid">
              {filtered.length ? filtered.slice(0,3).map((item,index) => <button key={item.id} className={`deadline-card ${index===0?"large":index===1?"blue":"mint"}`} onClick={() => setDetail(item)}>
                <div className="card-topline"><span className="subject-chip">{item.subject || "Course"}</span><span className="priority-chip">{item.dueDate === localToday() ? "Due today" : item.progress >= 100 ? "Completed" : "Upcoming"}</span></div>
                <div><div className="task-title">{item.task}</div><div className="source-row">{item.sources.map((source) => <span className="source-badge" key={source}>{sourceIcon(source)}{source}</span>)}</div></div>
                <div className="card-bottomline"><div className="progress-track"><div className="progress-fill" style={{width:`${item.progress}%`}}/></div><span className="due-caption">{dateTimeLabel(item.dueDate)} · {displayTime(item.dueTime)}</span></div>
              </button>) : <div className="empty-bento"><Grid2X2 size={20} color="#9c85ff"/><strong>{query ? "No matching deadlines" : "Your board starts here"}</strong><p>{query ? "Try another subject or keyword." : "Paste a class message or add a PDF and your deadlines will find their place."}</p></div>}
            </div>
          </section>
          <section>
            <div className="section-head"><h2 className="section-title">Coming up next</h2><button className="section-link" onClick={() => setView("Schedule")}>See all →</button></div>
            <div className="urgent-list">{filtered.filter((d) => d.dueDate >= localToday()).slice(0,3).map((item) => <button className="urgent-item" key={item.id} onClick={() => setDetail(item)}><div className="urgent-date">{new Date(`${item.dueDate}T12:00:00`).getDate()}<small>{humanDate(item.dueDate,{month:"short"})}</small></div><div className="urgent-info"><strong>{item.task}</strong><span>{item.subject} · {displayTime(item.dueTime)} IST</span></div><ChevronRight size={16} className="urgent-arrow"/></button>)}{!filtered.some((d) => d.dueDate >= localToday()) && <div className="right-empty">Nothing urgent on the horizon. Add a deadline when your next brief arrives.</div>}</div>
          </section>
        </>}

        {view === "Schedule" && <>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:19}}><div><h2 className="page-title">Schedule</h2><p className="page-subtitle" style={{marginBottom:0}}>Your deadlines, all in one timeline.</p></div><button className="btn secondary" onClick={() => {setCalendarMonth(new Date(`${selectedDate}T12:00:00`));setShowCalendar((v)=>!v)}}><CalendarDays size={14}/>{showCalendar?"Week view":"Full month"}</button></div>
          <section className="progress-card card" style={{marginBottom:17}}><div><div className="eyebrow">{MONTHS[new Date(`${selectedDate}T12:00:00`).getMonth()]} {new Date(`${selectedDate}T12:00:00`).getFullYear()}</div><div className="progress-title" style={{fontSize:19}}>{dateTimeLabel(selectedDate)}</div><div className="progress-meta">{dueOnSelected.length} deadline{dueOnSelected.length===1?"":"s"} scheduled</div></div><CalendarDays size={31} color="#7dbbff"/></section>
          {showCalendar ? <MonthCalendar month={calendarMonth} selected={selectedDate} deadlines={sorted} onSelect={(day)=>{setSelectedDate(day);setCalendarMonth(new Date(`${day}T12:00:00`))}} onMonth={(delta)=>setCalendarMonth((m)=>new Date(m.getFullYear(),m.getMonth()+delta,1))}/> : <section className="right-card card" style={{padding:"16px 12px",marginBottom:17}}><div className="week-header">{weekDates.map((d,i)=><span key={i}>{DAYS[d.getDay()]}</span>)}</div><div className="date-strip">{weekDates.map((d)=><button key={dateKey(d)} className={`date-button ${selectedDate===dateKey(d)?"active":""} ${dateKey(d)===localToday()?"today":""}`} onClick={()=>setSelectedDate(dateKey(d))}><strong>{d.getDate()}</strong><span>{d.toLocaleDateString("en-IN",{month:"short"})}</span></button>)}</div></section>}
          <section><div className="section-head"><h2 className="section-title">{dateTimeLabel(selectedDate)}&apos;s deadlines</h2><span style={{fontSize:10,color:"#81818e"}}>{dueOnSelected.length} items</span></div>
            {dueOnSelected.length ? <div className="schedule-list">{dueOnSelected.map((item,i)=><button className={`timeline-card ${i===0?"accent":""}`} key={item.id} onClick={()=>setDetail(item)}><div className="timeline-time">{displayTime(item.dueTime)}</div><div className="timeline-main"><strong>{item.task}</strong><span>{item.subject} · {item.sources.join(" + ")}</span></div><div className="mini-ring" style={{"--progress":`${item.progress*3.6}deg`} as React.CSSProperties}><span>{item.progress}</span></div></button>)}</div> : <div className="right-empty">No deadlines on this day. Keep your calendar calm—or add what’s next.</div>}
          </section>
          <div style={{height:18}}/><section><div className="section-head"><h2 className="section-title">Next deadlines</h2></div><div className="urgent-list">{upcoming.filter((d)=>d.dueDate!==selectedDate).slice(0,4).map(item=><button className="urgent-item" key={item.id} onClick={()=>{setSelectedDate(item.dueDate);setDetail(item)}}><div className="urgent-date">{new Date(`${item.dueDate}T12:00:00`).getDate()}<small>{humanDate(item.dueDate,{month:"short"})}</small></div><div className="urgent-info"><strong>{item.task}</strong><span>{item.subject} · {displayTime(item.dueTime)}</span></div><ChevronRight size={15}/></button>)}</div></section>
        </>}

        {view === "Batch Judge Test" && <BatchView busy={busy} onRun={runBatch} onSave={(items)=>{items.forEach((item)=>addExtracted(item));setToast(`${items.length} test result${items.length===1?"":"s"} saved`);}} />}
      </main>

      <aside className="right-column">
        <section className="right-card card"><div className="month-head"><strong>{MONTHS[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}</strong><div style={{display:"flex",gap:5}}><button aria-label="Previous month" onClick={()=>setCalendarMonth((m)=>new Date(m.getFullYear(),m.getMonth()-1,1))}><ChevronLeft size={13}/></button><button aria-label="Next month" onClick={()=>setCalendarMonth((m)=>new Date(m.getFullYear(),m.getMonth()+1,1))}><ChevronRight size={13}/></button></div></div><div className="week-header" style={{marginBottom:3}}>{DAYS.map((d)=><span key={d}>{d[0]}</span>)}</div><div className="calendar-grid">{Array.from({length:new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),1).getDay()},(_,i)=><span key={`blank${i}`}/>)}{Array.from({length:new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,0).getDate()},(_,i)=>{const day=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),i+1);const key=dateKey(day);return <button key={key} className={`${selectedDate===key?"selected":""} ${sorted.some((d)=>d.dueDate===key)?"has-task":""}`} onClick={()=>{setSelectedDate(key);setView("Schedule")}}>{i+1}</button>})}</div></section>
        <section className="right-card card"><div className="right-title">Today’s deadlines <span style={{float:"right",color:"#777783",fontWeight:500}}>{sorted.filter(d=>d.dueDate===localToday()).length}</span></div>{sorted.filter(d=>d.dueDate===localToday()).length ? <div className="schedule-list">{sorted.filter(d=>d.dueDate===localToday()).slice(0,3).map(item=><button className="timeline-card accent" key={item.id} onClick={()=>setDetail(item)}><div className="timeline-time">{displayTime(item.dueTime)}</div><div className="timeline-main"><strong>{item.task}</strong><span>{item.subject}</span></div></button>)}</div> : <div className="right-empty">Your day is clear. Add a deadline to keep every source in sync.</div>}</section>
      </aside>

      <button className="add-fab" onClick={()=>{setModalTab("Paste message");setModalOpen(true)}}><Plus size={17} strokeWidth={2.7}/>Add deadline</button>
      {toast && <div role="status" style={{position:"fixed",zIndex:70,bottom:82,left:"50%",transform:"translateX(-50%)",background:"#282833",border:"1px solid #ffffff19",color:"#eeeef4",padding:"11px 15px",borderRadius:13,fontSize:11,boxShadow:"0 12px 35px #0008",maxWidth:"90vw"}}>{toast}</div>}
      {modalOpen && <AddModal activeTab={modalTab} setActiveTab={setModalTab} busy={busy} onClose={()=>setModalOpen(false)} onExtract={extractAndSave} onBatch={runBatch} onSaveBatch={(items)=>{items.forEach(item=>addExtracted(item));setModalOpen(false);setToast(`${items.length} deadlines added`);}} />}
      {detail && <DetailModal item={detail} onClose={()=>setDetail(null)} onProgress={(value)=>updateDeadline(detail.id,{progress:value})} onToggle={(index)=>toggleSubtask(detail.id,index)} onEdit={()=>{setEditing(detail);setDetail(null)}} onDelete={()=>removeDeadline(detail.id)} />}
      {editing && <EditModal item={editing} onClose={()=>setEditing(null)} onSave={saveEdit} />}
    </div>
  );
}

function MonthCalendar({month,selected,deadlines,onSelect,onMonth}:{month:Date;selected:string;deadlines:Deadline[];onSelect:(date:string)=>void;onMonth:(delta:number)=>void}) {
  const offset=new Date(month.getFullYear(),month.getMonth(),1).getDay();
  const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  return <div className="calendar-view card" style={{marginBottom:18}}><div className="month-head"><button onClick={()=>onMonth(-1)}><ChevronLeft size={14}/></button><strong>{MONTHS[month.getMonth()]} {month.getFullYear()}</strong><button onClick={()=>onMonth(1)}><ChevronRight size={14}/></button></div><div className="month-calendar">{DAYS.map(d=><span className="cal-label" key={d}>{d}</span>)}{Array.from({length:offset},(_,i)=><span key={`blank${i}`}/>)}{Array.from({length:days},(_,i)=>{const date=new Date(month.getFullYear(),month.getMonth(),i+1);const key=dateKey(date);return <button key={key} onClick={()=>onSelect(key)} className={`${key===selected?"selected":""} ${key===localToday()?"today":""} ${deadlines.some(d=>d.dueDate===key)?"has-task":""}`}>{i+1}</button>})}</div></div>;
}

function BatchView({busy,onRun,onSave}:{busy:boolean;onRun:(text:string,source:Source,onResult:(items:Extracted[])=>void)=>Promise<void>;onSave:(items:Extracted[])=>void}) {
  const [text,setText]=useState("");const [source,setSource]=useState<Source>("WhatsApp");const [results,setResults]=useState<Extracted[]>([]);
  return <><h2 className="page-title">Batch Judge Test</h2><p className="page-subtitle">Stress-test how DeadlineSync reads English, Hinglish, and deadline formats. Separate messages with a blank line.</p><section className="batch-panel card"><div className="batch-toolbar"><strong style={{fontSize:13}}>Test messages</strong><button className="btn secondary" onClick={()=>setText(SAMPLE_TEXTS.join("\n\n"))}><Sparkles size={13}/>Load Sample Hinglish Tests</button></div><div className="source-options" style={{marginBottom:12}}>{SOURCES.map((item)=><button key={item} className={`source-option ${source===item?"active":""}`} onClick={()=>setSource(item)}>{item}</button>)}</div><textarea className="textarea" value={text} onChange={(e)=>setText(e.target.value)} placeholder="Kal shaam 5 baje tak DBMS file submit kar dena...\n\nAssignment 2 is due next Friday at 4pm."/><div className="modal-actions"><span className="sample-note">Current date, weekday, and time are sent in IST with every test.</span><button className="btn purple" disabled={busy} onClick={()=>void onRun(text,source,setResults)}>{busy?"Testing…":<><Zap size={14}/>Run judge test</>}</button></div>
      {results.length>0&&<div className="result-list">{results.map((item,i)=><div className="result-card" key={i}><div style={{display:"flex",justifyContent:"space-between",gap:8}}><strong>{item.subject} · {item.task}</strong><span style={{fontSize:10,color:"#9b8aff"}}>{item.dueDate} · {displayTime(item.dueTime)}</span></div><p>{item.rawText}</p><span style={{fontSize:9,color:"#878794"}}>{item.source} · {item.subtasks.length} suggested subtasks</span></div>)}<button className="btn" style={{marginTop:5}} onClick={()=>onSave(results)}><Check size={14}/>Save results to deadlines</button></div>}
    </section><p className="sample-note" style={{marginTop:14}}>A real API key is required for live extraction. Sample messages are test inputs only; they are never saved unless you choose “Save results.”</p></>;
}

function AddModal({activeTab,setActiveTab,busy,onClose,onExtract,onBatch,onSaveBatch}:{activeTab:ModalTab;setActiveTab:(tab:ModalTab)=>void;busy:boolean;onClose:()=>void;onExtract:(text:string,source:Source,files?:string[])=>Promise<void>;onBatch:(text:string,source:Source,onResult:(items:Extracted[])=>void)=>Promise<void>;onSaveBatch:(items:Extracted[])=>void}) {
  const [text,setText]=useState("");const [source,setSource]=useState<Source>("WhatsApp");const [error,setError]=useState("");const [pdfName,setPdfName]=useState("");const [batchResults,setBatchResults]=useState<Extracted[]>([]);
  async function onPdf(file?:File) {
    if(!file)return;setError("");setPdfName(file.name);
    try {
      const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs",import.meta.url).toString();
      const data=new Uint8Array(await file.arrayBuffer());
      const pdf=await pdfjs.getDocument({data}).promise;
      const pages:string[]=[];
      for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);const content=await page.getTextContent();pages.push(content.items.map((item)=>"str" in item?item.str:"").join(" "));}
      const extracted=pages.join("\n").trim();if(!extracted)throw new Error("No selectable text found in this PDF. Try a text-based notice instead of a scanned image.");
      setText(extracted);setActiveTab("Upload PDF");
    } catch(e){setError(e instanceof Error?e.message:"Could not read this PDF.");}
  }
  const samples=()=>{setText(SAMPLE_TEXTS.join("\n\n"));setActiveTab("Batch test");setError("");};
  return <div className="modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose()}}><section className="modal" role="dialog" aria-modal="true" aria-label="Add deadline"><header className="modal-head"><div><h2>Add a deadline</h2><p>Paste a class message. We’ll pull out the details.</p></div><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={17}/></button></header><div className="modal-content"><div className="tab-row">{(["Paste message","Upload PDF","Batch test"] as ModalTab[]).map(tab=><button key={tab} className={`tab-button ${activeTab===tab?"active":""}`} onClick={()=>{setActiveTab(tab);setError("")}}>{tab}</button>)}</div>
      {activeTab==="Paste message"&&<><label className="form-label">Where did it come from?</label><div className="source-options">{SOURCES.map(s=><button key={s} className={`source-option ${source===s?"active":""}`} onClick={()=>setSource(s)}>{sourceIcon(s,12)} {s}</button>)}</div><label className="form-label">Original message</label><textarea className="textarea" style={{minHeight:150}} value={text} onChange={e=>setText(e.target.value)} placeholder="Paste the full assignment message here… Hinglish works too."/><button className="btn secondary" style={{marginTop:11}} onClick={samples}><Sparkles size={13}/>Load Sample Hinglish Tests</button></>}
      {activeTab==="Upload PDF"&&<><label className="form-label">Assignment notice or syllabus PDF</label><label className="drop-zone" style={{display:"block",cursor:"pointer"}}><Upload size={22} color="#a489ff"/><p>{pdfName||"Choose a PDF or drop one here"}<br/><span style={{color:"#777784"}}>Selectable text is extracted locally before it’s sent for parsing.</span></p><input type="file" aria-label="Choose a PDF" accept="application/pdf,.pdf" onChange={e=>void onPdf(e.target.files?.[0])}/></label>{text&&<><label className="form-label">Extracted text · {text.length.toLocaleString()} characters</label><textarea className="textarea" style={{minHeight:105}} value={text} onChange={e=>setText(e.target.value)}/></>}<p className="sample-note">PDF content is sent to Gemini only when you choose Extract deadline.</p></>}
      {activeTab==="Batch test"&&<><div className="batch-toolbar"><span className="sample-note">Separate each message with a blank line.</span><button className="btn secondary" onClick={samples}><Sparkles size={13}/>Load Sample Hinglish Tests</button></div><div className="source-options" style={{marginBottom:10}}>{SOURCES.map(s=><button key={s} className={`source-option ${source===s?"active":""}`} onClick={()=>setSource(s)}>{s}</button>)}</div><textarea className="textarea" value={text} onChange={e=>setText(e.target.value)} placeholder="Paste multiple deadline messages…"/>{batchResults.length>0&&<div className="result-list">{batchResults.map((r,i)=><div className="result-card" key={i}><strong>{r.subject} · {r.task}</strong><p>{r.dueDate} · {displayTime(r.dueTime)} · {r.source}</p></div>)}</div>}</>}
      {error&&<div className="inline-error">{error}</div>}
      <div className="modal-actions"><span className="sample-note">Dates are interpreted in Asia/Kolkata (IST).</span>{activeTab==="Batch test"?<button className="btn purple" disabled={busy} onClick={()=>void onBatch(text,source,setBatchResults)}>{busy?"Testing…":"Test messages"}</button>:<button className="btn" disabled={busy||!text.trim()} onClick={async()=>{setError("");if(activeTab==="Upload PDF"&&pdfName){await onExtract(text,"PDF",[pdfName]);}else await onExtract(text,source)}}>{busy?"Extracting…":<><Sparkles size={14}/>Extract deadline</>}</button>}</div>
      {activeTab==="Batch test"&&batchResults.length>0&&<button className="btn" style={{width:"100%",marginTop:11}} onClick={()=>onSaveBatch(batchResults)}><Check size={14}/>Save test results</button>}
    </div></section></div>;
}

function DetailModal({item,onClose,onProgress,onToggle,onEdit,onDelete}:{item:Deadline;onClose:()=>void;onProgress:(v:number)=>void;onToggle:(i:number)=>void;onEdit:()=>void;onDelete:()=>void}) {
  return <div className="modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose()}}><section className="detail-panel" role="dialog" aria-modal="true"><header className="detail-hero"><div style={{display:"flex",justifyContent:"space-between",position:"relative",zIndex:1}}><div className="source-row">{item.sources.map(s=><span className="source-badge" key={s}>{sourceIcon(s)}{s}</span>)}</div><button className="icon-btn" aria-label="Close details" onClick={onClose} style={{background:"#ffffff18",color:"white",border:0,width:34,height:34}}><X size={16}/></button></div><div className="eyebrow" style={{color:"#dfd6ff",marginTop:19}}>{item.subject}</div><h2 style={{fontSize:23,lineHeight:1.2,letterSpacing:"-.6px",margin:"7px 0"}}>{item.task}</h2><div style={{fontSize:11,color:"#e4dcff"}}><Clock3 size={12} style={{display:"inline",verticalAlign:"-2px",marginRight:5}}/>{humanDate(item.dueDate,{weekday:"long",day:"numeric",month:"long",year:"numeric"})} · {displayTime(item.dueTime)} IST</div></header><div className="detail-body"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><h3 style={{marginTop:0}}>Progress</h3><span style={{fontSize:10,color:"#83d9b3"}}>{item.progress===100?"Completed":"In progress"}</span></div><div className="slider-row"><ListChecks size={16} color="#7cddb4"/><input aria-label="Progress" type="range" min="0" max="100" step="5" value={item.progress} onChange={e=>onProgress(Number(e.target.value))}/><span className="slider-value">{item.progress}%</span></div>
        <h3>Original messages</h3>{item.messages.map((message,i)=><div className="message-quote" key={i}><span style={{fontSize:9,color:"#aa93ff",fontWeight:700}}>{message.source}</span><br/>{message.text}</div>)}
        <h3>Sources & attached files</h3><div className="file-row">{item.sources.map(s=><span className="file-pill" key={s}>{sourceIcon(s,13)}{s}</span>)}{item.files.map(file=><span className="file-pill" key={file}><FileText size={13}/>{file}</span>)}</div>
        <h3>Suggested subtasks</h3>{item.subtasks.map((task,i)=><label className="subtask" key={i}><input type="checkbox" checked={item.checked[i]??false} onChange={()=>onToggle(i)}/><span style={{textDecoration:item.checked[i]?"line-through":"none",color:item.checked[i]?"#83838e":"#d5d5df"}}>{task}</span></label>)}
        <div className="detail-footer"><button className="btn secondary" onClick={onEdit}>Edit details</button><button className="btn ghost" style={{color:"#ff8997"}} onClick={onDelete}>Delete</button></div>
      </div></section></div>;
}

function EditModal({item,onClose,onSave}:{item:Deadline;onClose:()=>void;onSave:(event:React.FormEvent<HTMLFormElement>)=>void}) {
  return <div className="modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose()}}><section className="modal" role="dialog" aria-modal="true"><header className="modal-head"><div><h2>Edit deadline</h2><p>Update the assignment details.</p></div><button className="icon-btn" onClick={onClose}><X size={16}/></button></header><form className="modal-content" onSubmit={onSave}><label className="form-label">Subject</label><input className="field" name="subject" required defaultValue={item.subject}/><label className="form-label">Task title</label><input className="field" name="task" required defaultValue={item.task}/><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><div><label className="form-label">Due date</label><input className="field" type="date" name="dueDate" required defaultValue={item.dueDate}/></div><div><label className="form-label">Due time (IST)</label><input className="field" type="time" name="dueTime" required defaultValue={item.dueTime}/></div></div><div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn">Save changes</button></div></form></section></div>;
}
