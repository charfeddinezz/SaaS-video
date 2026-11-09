import * as React from 'react';
import type { Artifact, SiteEntry } from '../core/types.js';
import { runArabicShortsJob } from '../jobrunner.js';
import type { ShortsPackage } from '../core/studio.js';

type View = 'studio' | 'catalog' | 'library';
type SavedProject = ShortsPackage & { savedAt: string };

const STORAGE_KEY = 'reelforge.projects.v1';
const workflowSteps = [
  { stage: 'brief', number: '01', title: 'صياغة السيناريو', caption: 'مقدمة، نص، وخاتمة' },
  { stage: 'script', number: '02', title: 'تخطيط المشاهد', caption: 'أربع لقطات مع أوصاف بصرية' },
  { stage: 'qc', number: '03', title: 'مراجعة أساسية', caption: 'اكتمال النص ومخطط التصوير' },
  { stage: 'publish', number: '04', title: 'حفظ المشروع', caption: 'تنزيل JSON أو مراجعته لاحقًا' },
] as const;
const catalogCategories = [
  ['all', 'الكل'], ['video', 'فيديو'], ['image', 'صور'], ['audio', 'صوت'], ['edit', 'تحرير'],
] as const;
function readProjects(): SavedProject[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored as SavedProject[] : [];
  } catch {
    return [];
  }
}

function getPackage(artifact?: Artifact): ShortsPackage | null {
  const production = artifact?.meta['production'];
  return production && typeof production === 'object' ? production as ShortsPackage : null;
}

function formatAllowance(site: SiteEntry): string {
  if (!site.free) return 'لا يوجد رصيد مجاني';
  const period = { day: 'يوميًا', week: 'أسبوعيًا', month: 'شهريًا', once: 'تجريبي' }[site.free.period];
  return `${site.free.amount} ${site.free.unit} ${period}`;
}

export function App() {
  const [availableSites, setAvailableSites] = React.useState<SiteEntry[]>([]);
  const [view, setView] = React.useState<View>('studio');
  const [topic, setTopic] = React.useState('');
  const [duration, setDuration] = React.useState(45);
  const [style, setStyle] = React.useState('وثائقي سينمائي');
  const [audience, setAudience] = React.useState('الجمهور العام');
  const [running, setRunning] = React.useState(false);
  const [events, setEvents] = React.useState<string[]>([]);
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState<ShortsPackage | null>(null);
  const [projects, setProjects] = React.useState<SavedProject[]>(readProjects);
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState('all');
  const [toast, setToast] = React.useState('');

  React.useEffect(() => {
    fetch('/sites.json')
      .then((response) => {
        if (!response.ok) throw new Error('catalog unavailable');
        return response.json() as Promise<{ sites: SiteEntry[] }>;
      })
      .then((data) => setAvailableSites(data.sites))
      .catch(() => setAvailableSites([]));
  }, []);

  const announce = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  };

  const createProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (topic.trim().length < 3 || running) return;
    setRunning(true);
    setError('');
    setResult(null);
    setEvents([]);
    const outcome = await runArabicShortsJob(topic, {
      durationSec: duration,
      style,
      audience,
      sleep: async () => undefined,
      onEvent: (pipelineEvent) => {
        if (pipelineEvent.type === 'stage:start') {
          setEvents((current) => [...current, pipelineEvent.stage]);
        }
      },
    });
    setRunning(false);
    if (outcome.status !== 'done') {
      setError(outcome.output);
      return;
    }
    const production = getPackage(outcome.artifact);
    if (!production) {
      setError('تعذر قراءة ملف المشروع الناتج.');
      return;
    }
    setResult(production);
    const saved = { ...production, savedAt: new Date().toISOString() };
    setProjects((current) => {
      const updated = [saved, ...current.filter((project) => project.id !== saved.id)].slice(0, 30);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const downloadProject = (project: ShortsPackage) => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      announce('تم النسخ');
    } catch {
      announce('تعذر النسخ من هذا المتصفح');
    }
  };

  const removeProject = (id: string) => {
    setProjects((current) => {
      const updated = current.filter((project) => project.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const visibleSites = availableSites.filter((site) => {
    const matchesText = `${site.name} ${site.notes}`.toLowerCase().includes(search.toLowerCase());
    return matchesText && (category === 'all' || site.category === category);
  });

  return (
    <div className="app-shell" dir="rtl">
      <aside className="sidebar">
        <a className="brand" href="#studio" onClick={() => setView('studio')} aria-label="ReelForge الرئيسية">
          <span className="brand-mark">R</span>
          <span><strong>ReelForge</strong><small>استوديو المحتوى</small></span>
        </a>
        <div className="workspace-label">مساحة العمل</div>
        <nav className="primary-nav" aria-label="التنقل الرئيسي">
          <button className={view === 'studio' ? 'nav-item active' : 'nav-item'} onClick={() => setView('studio')}>
            <span className="nav-symbol">✳</span> استوديو جديد
          </button>
          <button className={view === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => setView('library')}>
            <span className="nav-symbol">▤</span> المشاريع <span className="nav-count">{projects.length}</span>
          </button>
          <button className={view === 'catalog' ? 'nav-item active' : 'nav-item'} onClick={() => setView('catalog')}>
            <span className="nav-symbol">◉</span> كتالوج الأدوات
          </button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <span className="note-dot" />
          <div><strong>وضع المسودة</strong><p>الإنشاء محلي ولا يرسل بياناتك.</p></div>
        </div>
        <div className="sidebar-footer">الإصدار 0.1 · معاينة</div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>مساحة العمل</span><b>/</b><strong>{view === 'studio' ? 'استوديو جديد' : view === 'catalog' ? 'كتالوج الأدوات' : 'المشاريع'}</strong></div>
          <div className="topbar-right"><span className="status-pill"><i /> محرك محلي جاهز</span><span className="avatar">م</span></div>
        </header>

        {view === 'studio' && (
          <div className="page-content studio-page">
            <section className="page-heading">
              <div><span className="eyebrow">مساحة الإبداع</span><h1>حوّل الفكرة إلى خطة تصوير.</h1><p>ابدأ بموضوع، واخرج بسيناريو عربي ولوحة مشاهد جاهزة للإنتاج.</p></div>
              <span className="heading-index">01 <i /> 03</span>
            </section>

            <section className="studio-grid">
              <form className="brief-panel" onSubmit={createProject}>
                <div className="panel-heading"><div><span className="step-number">01</span><h2>موجز الفيديو</h2></div><span className="required-note">* مطلوب</span></div>
                <label className="field-label" htmlFor="topic">ما الفكرة التي تريد طرحها؟</label>
                <textarea id="topic" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="مثال: لماذا يصعب علينا التركيز في الصباح؟" maxLength={240} required minLength={3} disabled={running} />
                <div className="field-meta"><span>اكتب الفكرة بجملة واحدة</span><span>{topic.length}/240</span></div>
                <div className="form-row">
                  <label className="field-block"><span className="field-label">مدة الفيديو</span><select value={duration} onChange={(event) => setDuration(Number(event.target.value))} disabled={running}><option value={30}>30 ثانية</option><option value={45}>45 ثانية</option><option value={60}>60 ثانية</option></select></label>
                  <label className="field-block"><span className="field-label">الأسلوب البصري</span><select value={style} onChange={(event) => setStyle(event.target.value)} disabled={running}><option>وثائقي سينمائي</option><option>تعليمي مشرق</option><option>تحريري هادئ</option><option>حيوي وسريع</option></select></label>
                </div>
                <label className="field-block audience-field"><span className="field-label">الجمهور المستهدف</span><input value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="الجمهور العام" disabled={running} /></label>
                {error && <div className="inline-error" role="alert">{error}</div>}
                <div className="form-actions"><span>لا حاجة إلى مفتاح API</span><button className="primary-button" type="submit" disabled={running || topic.trim().length < 3}>{running ? <><span className="spinner" /> جارٍ إعداد المشروع</> : <>إنشاء خطة التصوير <span>←</span></>}</button></div>
              </form>

              <aside className="workflow-panel">
                <div className="panel-heading"><div><span className="step-number muted-step">02</span><h2>مسار الإنتاج</h2></div><span className="local-chip">محلي</span></div>
                <p className="workflow-intro">تُبنى الحزمة داخل المتصفح، وتبقى قابلة للتحرير قبل أي توليد أو نشر خارجي.</p>
                <ol className="workflow-list">
                  {workflowSteps.map(({ stage, number, title, caption }) => (
                    <li key={number} className={events.includes(stage) ? 'workflow-step complete' : ''}><span className="workflow-number">{number}</span><div><strong>{title}</strong><small>{caption}</small></div><span className="workflow-check">{events.includes(stage) ? '✓' : '·'}</span></li>
                  ))}
                </ol>
                <div className="workflow-disclaimer"><span>i</span><p>هذه النسخة تنشئ السيناريو ولوحة التصوير فقط. توليد الفيديو والتعليق الصوتي والنشر تحتاج مزودًا متصلًا وموافقة منفصلة.</p></div>
              </aside>
            </section>

            {result && <section className="result-section" aria-live="polite">
              <div className="result-header"><div><span className="eyebrow">تم إعداد المشروع</span><h2>{result.title}</h2></div><div className="result-actions"><button className="quiet-button" onClick={() => copyText(result.script)}>نسخ السيناريو</button><button className="primary-button compact-button" onClick={() => downloadProject(result)}>تنزيل المشروع <span>↓</span></button></div></div>
              <div className="result-meta"><span>◷ {result.durationSec} ثانية</span><span>▧ عمودي 9:16</span><span>◉ {result.shots.length} مشاهد</span><span>مسودة نصية</span></div>
              <div className="result-columns"><article className="script-result"><div className="subheading"><h3>السيناريو الصوتي</h3><span>عربي</span></div><blockquote>{result.hook}</blockquote><div className="script-copy">{result.script.split('\n\n').slice(1).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div><div className="tag-row">{result.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div></article>
                <article className="shots-result"><div className="subheading"><h3>لوحة المشاهد</h3><span>{result.shots.length} لقطات</span></div><div className="shot-list">{result.shots.map((shot, index) => <div className="shot-row" key={shot.id}><span className="shot-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{shot.beat}</strong><p>{shot.visualPrompt}</p></div><span className="shot-duration">{shot.durationSec}ث</span></div>)}</div></article></div>
              <div className="output-footnote"><span>i</span> الحزمة لا تحتوي على فيديو أو صوت مولّد. راجع النص والأوصاف قبل استخدامها في أداة خارجية.</div>
            </section>}
          </div>
        )}

        {view === 'catalog' && <section className="page-content directory-page">
          <div className="page-heading"><div><span className="eyebrow">دليل الإنتاج</span><h1>كتالوج الأدوات</h1><p>مراجع مزودي الفيديو والصور والصوت والتحرير المتاحة في بيانات المشروع.</p></div><span className="catalog-total">{availableSites.length}<small> أداة مجانية مدرجة</small></span></div>
          <div className="directory-controls"><label className="search-box"><span>⌕</span><input aria-label="ابحث عن أداة" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن أداة أو ملاحظة..." /></label><div className="category-tabs" role="group" aria-label="تصفية حسب الفئة">{catalogCategories.map(([value, label]) => <button key={value} className={category === value ? 'selected' : ''} onClick={() => setCategory(value)}>{label}</button>)}</div></div>
          <div className="site-table-wrap"><table className="site-table"><thead><tr><th>الأداة</th><th>الفئة</th><th>القدرات</th><th>الحد المجاني المسجل</th><th>الثقة</th><th>المصدر</th></tr></thead><tbody>{visibleSites.map((site) => <tr key={site.id}><td><a href={site.url} target="_blank" rel="noreferrer">{site.name}<span>↗</span></a></td><td>{site.category}</td><td><div className="cap-list">{site.caps.slice(0, 3).map((cap) => <span key={cap}>{cap}</span>)}</div></td><td>{formatAllowance(site)}</td><td><span className={`confidence ${site.confidence}`}>{site.confidence === 'high' ? 'مرتفع' : site.confidence === 'medium' ? 'متوسط' : 'منخفض'}</span></td><td>{site.access === 'api' || site.access === 'both' ? 'API متاح' : 'واجهة ويب'}</td></tr>)}</tbody></table>{visibleSites.length === 0 && <div className="empty-state">لا توجد نتائج مطابقة.</div>}</div>
          <p className="catalog-disclaimer">الأرصدة تتغير حسب المنطقة والحساب. تحقق من شروط كل خدمة قبل الاستخدام؛ إدراج أداة لا يعني اتصالها آليًا.</p>
        </section>}

        {view === 'library' && <section className="page-content library-page"><div className="page-heading"><div><span className="eyebrow">مساحة العمل</span><h1>المشاريع المحفوظة</h1><p>مسوداتك محفوظة على هذا الجهاز فقط.</p></div><button className="primary-button" onClick={() => setView('studio')}>إنشاء مشروع <span>←</span></button></div>
          {projects.length === 0 ? <div className="empty-projects"><span>▤</span><h2>لا توجد مشاريع بعد</h2><p>أنشئ أول سيناريو وستجد مسودتك هنا.</p><button className="quiet-button" onClick={() => setView('studio')}>البدء بمشروع جديد</button></div> : <div className="project-list">{projects.map((project) => <article className="project-row" key={project.id}><div className="project-type">نص<br />9:16</div><div className="project-info"><h2>{project.title}</h2><p>{project.topic}</p><span>{new Date(project.savedAt).toLocaleDateString('ar')} · {project.durationSec} ثانية · {project.shots.length} مشاهد</span></div><button className="quiet-button" onClick={() => { setResult(project); setTopic(project.topic); setView('studio'); }}>فتح</button><button className="icon-button" aria-label="تنزيل المشروع" title="تنزيل المشروع" onClick={() => downloadProject(project)}>↓</button><button className="icon-button danger-button" aria-label="حذف المشروع" title="حذف المشروع" onClick={() => removeProject(project.id)}>×</button></article>)}</div>}
        </section>}

        <footer className="app-footer"><span>ReelForge <b>·</b> مساحة عمل للمحتوى القصير</span><span>لا يتم توليد وسائط أو رفع محتوى تلقائيًا</span></footer>
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}