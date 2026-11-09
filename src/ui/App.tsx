import * as React from 'react'
import { SITE_CAPABILITIES, SITE_LIST } from '../core/types.js'
import { CreditLedger } from '../core/ledger.js'
import { PolicyGuard } from '../core/policy.js'

// UI Types
type JobStatus = 'idle' | 'running' | 'completed' | 'error'
type SiteStatus = 'available' | 'at_limit' | 'unavailable'

interface JobResult {
  status: string
  artifact?: any
  output?: string
}

// Site display type
interface SiteInfo {
  name: string
  dailyCredits: number
  weeklyCredits: number
  monthlyCredits: number
  type: string
  confidence: 'high' | 'medium' | 'low'
}

// Main Application Component
const App: React.FC = () => {
  const [topic, setTopic] = React.useState('')
  const [status, setStatus] = React.useState<JobStatus>('idle')
  const [result, setResult] = useState<JobResult | null>(null)
  const [creditsInfo, setCreditsInfo] = useState<Record<string, number>>({})
  const [sites, setSites] = useState<SiteInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  // Load available sites and credit info on mount
  React.useEffect(() => {
    loadSitesAndCredits()
  }, [])

  const loadSitesAndCredits = async () => {
    try {
      // Get site information from catalog
      const availableSites = SITE_LIST.filter(s => s.freeTier > 0)
      setSites(availableSites.map(site => ({
        name: site.name,
        dailyCredits: site.creditsDaily || 0,
        weeklyCredits: site.creditsWeekly || 0,
        monthlyCredits: site.creditsMonthly || 0,
        type: site.type || 'unknown',
        confidence: site.confidence || 'medium'
      })))

      // Initialize credit ledger info
      const ledger = new CreditLedger()
      const creditStatus = await ledger.getStatus()
      setCreditsInfo(creditStatus)
    } catch (err) {
      console.error('Failed to load sites/credits:', err)
    }
  }

  const handleRunJob = async () => {
    if (!topic.trim() || isRunning) return

    setIsRunning(true)
    setStatus('running')
    setError(null)
    setResult(null)

    try {
      // Call the existing reel-forge pipeline
      const result: JobResult = await runArabicShortsJob(topic, {
        onEvent: (event: any) => {
          // Handle events from the pipeline
          console.log('Pipeline event:', event.type, event.detail)
        },
        sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
      })

      setStatus('completed')
      setResult(result)
    } catch (err: any) {
      setStatus('error')
      setError(err.message || 'Unknown error occurred')
      console.error('Job failed:', err)
    } finally {
      setIsRunning(false)
    }
  }

  const formatCredits = (credits: number): string => {
    if (credits >= 1000000) {
      return `${(credits / 1000000).toFixed(1)}M`
    }
    if (credits >= 1000) {
      return `${(credits / 1000).toFixed(1)}K`
    }
    return `${credits}`
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>🎬 reel-forge Dashboard</h1>
        <p>Arabic AI Video Platform - Free-tier only</p>
      </header>

      <main className="app-main">
        {/* Topic Input Section */}
        <section className="input-section">
          <div className="input-group">
            <label htmlFor="topic-input" className="input-label">
              فيديو عن:
            </label>
            <input
              id="topic-input"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="موضوع الفيديو (مثلاً: فوائد المشي للصحة)"
              className="input-field"
              required
              disabled={isRunning}
            />
            <button
              onClick={handleRunJob}
              className="run-button"
              disabled={!topic.trim() || isRunning}
            >
              {isRunning ? 'جاري...' : 'إنشاء الفيديو'}
            </button>
          </div>
        </section>

        {/* Status & Results Section */}
        <section className="status-section">
          {status === 'running' && (
            <div className="running-indicator">
              <span>جاري توليد الفيديو...</span>
            </div>
          )}

          {status === 'completed' && result && (
            <div className="results-card">
              <h3>✅ الانتهاء</h3>
              <p>تم إنجاح المهمة!</p>
              <p>استهلاك الريدجر: {formatCredits(result.output?.match(/credits consumed: (\d+)/)?.[1] || '0')} ائتمان</p>
              <p>مدة العملية: {(Date.now() - (result.output?.match(/job duration: (\d+)/)?.[1] || 0)) / 1000}s</p>
              <div className="result-details">
                <p><strong>العنوان:</strong> {(result.output?.match(/title: (.+)/)?.[1] || topic).substring(0, 50)}...</p>
                <p><strong>المدة:</strong> 45 ثانية (تقديرية)</p>
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(
                  result.output?.match(/title: (.+)/)?.[1] || topic
                )}
                className="copy-button"
              >
                نسخ العنوان
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="error-boundary">
              <h3>❌ خطأ</h3>
              <p>{error}</p>
              <button onClick={() => setError(null)} className="retry-btn">حاول مرة أخرى</button>
            </div>
          )}

          {status === 'idle' && (
            <div className="idle-state">
              <p>أدخل موضوعاً وانقر على "إنشاء الفيديو" للبدء</p>
            </div>
          )}
        </section>

        {/* Credits & Sites Section */}
        <section className="stats-section">
          <h3>💳 رصيد الريدجر</h3>
          <div className="credits-grid">
            {Object.entries(creditsInfo).map(([site, used]) => {
              const dailyLimit = SITE_LIST.find(s => s.name === site)?.creditsDaily || 100
              const remaining = dailyLimit - used
              const percentage = (used / dailyLimit) * 100
              const isOver = used >= dailyLimit

              return (
                <div key={site} className="credits-card">
                  <span className="site-name">{site}</span>
                  <div className="credits-bar">
                    <div 
                      className="credits-fill"
                      style={{ width: `${percentage}%` }}
                      title={isOver ? 'تم تجاوز الحد اليومي' : `${remaining} متبقي من ${dailyLimit}`}
                    />
                  </div>
                  <span className="credits-value">
                    {formatCredits(used)} / {formatCredits(dailyLimit)}
                  </span>
                </div>
              )
            })}
          </div>

          <h3>📊 مواقع متاحة</h3>
          <div className="sites-list">
            {sites.map((site, idx) => (
              <div key={idx} className="site-item">
                <span className="site-confidence {site.confidence}">
                  {site.confidence}
                </span>
                <span>{site.name}</span>
                <span>{site.dailyCredits}+ Credits/يوم</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export { App }