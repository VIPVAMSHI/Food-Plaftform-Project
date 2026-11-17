import { useEffect, useMemo, useState } from 'react'
import { askFoodAssistant } from './ai/provider'
import { COMFORT_CUISINES, pickForMoment } from './ai/local'
import type { AssistantPlace, MealMoment } from './ai/types'
import { CUISINES, NEIGHBORHOODS, places, type Mode, type Place } from './data/places'
import { formatMiles, travelMinutes } from './data/travel'
import { Icon, type IconName } from './icons'

type Plan = { placeId: string; date: string; time: string }
type ViewPlace = Place & { travel: number; distanceLabel: string }
type Confirmation = { place: ViewPlace; date: string; time: string }

const MODES: { key: Mode; label: string }[] = [
  { key: 'walk', label: 'Walk' },
  { key: 'bike', label: 'Bike' },
  { key: 'car', label: 'Drive' },
]

function seattleToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function seattleHour(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: 'America/Los_Angeles',
    }).format(new Date()),
  )
}

function mealMoment(hour: number): MealMoment {
  if (hour < 11) return 'breakfast'
  if (hour < 16) return 'lunch'
  return 'dinner'
}

function isCitywide(area: string): boolean {
  const value = area.trim().toLowerCase()
  return value === '' || value === 'seattle' || value === 'seattle, wa' || value === 'seattle wa'
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) || '')
    return parsed as T
  } catch {
    return fallback
  }
}

function formatWhen(date: string, time?: string): string {
  const day = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  if (!time) return day
  const clock = new Date(`2000-01-01T${time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${day} at ${clock}`
}

function toSummary(place: ViewPlace): AssistantPlace {
  return {
    id: place.id,
    name: place.name,
    cuisine: place.cuisine,
    neighborhood: place.neighborhood,
    address: place.address,
    street: place.street,
    price: place.price,
    serving: place.serving,
    rating: place.rating,
    travelMinutes: place.travel,
    waitMinutes: place.wait,
    note: place.note,
    dishes: place.dishes,
  }
}

function PlacePhoto({ place, label }: { place: Place; label?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="photo-fallback" role="img" aria-label={`Photo unavailable for ${place.name}`}>
        Photo unavailable
      </div>
    )
  }
  return (
    <img
      src={place.image}
      alt={label ?? `${place.name}, a ${place.cuisine.toLowerCase()} stand-in photo`}
      onError={() => setFailed(true)}
    />
  )
}

function Nav({ tab, setTab }: { tab: string; setTab: (value: string) => void }) {
  const items: Array<[IconName, string]> = [
    ['home', 'Discover'],
    ['calendar', 'Plans'],
    ['heart', 'Saved'],
    ['user', 'Profile'],
  ]
  return (
    <nav className="nav">
      {items.map(([icon, label]) => (
        <button
          key={icon}
          type="button"
          data-testid={`nav-${icon}`}
          onClick={() => setTab(icon)}
          className={tab === icon ? 'nav-item active' : 'nav-item'}
        >
          <Icon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}

function ResultCard({
  place,
  mode,
  saved,
  reason,
  onSave,
  onDetails,
  onPlan,
}: {
  place: ViewPlace
  mode: Mode
  saved: boolean
  reason?: string
  onSave: () => void
  onDetails: () => void
  onPlan: () => void
}) {
  return (
    <article className="result-card" data-testid="place-card" data-place-id={place.id}>
      <div className="result-image">
        <PlacePhoto place={place} />
        <button
          type="button"
          className={saved ? 'save saved' : 'save'}
          onClick={onSave}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${place.name} from saved` : `Save ${place.name}`}
        >
          <Icon name="heart" size={19} filled={saved} />
        </button>
        <span className="cuisine-pill">{place.cuisine}</span>
      </div>
      <div className="result-body">
        <div className="restaurant-info">
          <div>
            <h3>{place.name}</h3>
            <p>
              {place.price} · {place.distanceLabel} · {place.neighborhood}
            </p>
          </div>
          {place.rating != null && (
            <span className="rating">
              <Icon name="star" size={14} />
              {place.rating}
            </span>
          )}
        </div>
        <p className="note">{place.note}</p>
        {reason && (
          <p className="ai-reason">
            <Icon name="spark" size={15} />
            <span>
              <strong>Why it fits: </strong>
              {reason}
            </span>
          </p>
        )}
        <div className="serving-price">
          <span>Approx. one serving per person</span>
          <strong>${place.serving}</strong>
        </div>
        <div className="time-breakdown">
          <div>
            <Icon name={mode} />
            <span>
              <strong>{place.travel} min</strong> travel
            </span>
          </div>
          <b>+</b>
          <div>
            <Icon name="clock" />
            <span>
              <strong>{place.wait} min</strong> wait
            </span>
          </div>
          <div className="total">
            <strong>{place.travel + place.wait} min</strong>
            <span>total</span>
          </div>
        </div>
        <div className="card-actions">
          <button type="button" onClick={onDetails}>
            View details
          </button>
          <button type="button" className="plan-btn" onClick={onPlan}>
            Add to calendar <Icon name="calendar" size={16} />
          </button>
        </div>
      </div>
    </article>
  )
}

export default function App() {
  const today = seattleToday()
  const moment = mealMoment(seattleHour())
  const [tab, setTab] = useState('home')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [area, setArea] = useState('Seattle, WA')
  const [cuisine, setCuisine] = useState('All food')
  const [budget, setBudget] = useState('')
  const [date, setDate] = useState(today)
  const [mode, setMode] = useState<Mode>('walk')
  const [saved, setSaved] = useState<string[]>(() => {
    const stored = readJson<unknown[]>('bite-saved', [])
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
  })
  const [plans, setPlans] = useState<Plan[]>(() => {
    const stored = readJson<Plan[]>('bite-plans', [])
    return Array.isArray(stored) ? stored.filter((plan) => plan && typeof plan.placeId === 'string') : []
  })
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(`${today}T12:00:00`))
  const [assistantVisible, setAssistantVisible] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState<string[]>([])
  const [assistantBusy, setAssistantBusy] = useState(false)
  const [assistantError, setAssistantError] = useState('')
  const [assistantPreference, setAssistantPreference] = useState<string | null>(null)
  const [assistantMaxTravel, setAssistantMaxTravel] = useState<number | null>(null)
  const [showChatResults, setShowChatResults] = useState(false)
  const [chatIds, setChatIds] = useState<string[]>([])
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [schedulePlace, setSchedulePlace] = useState<ViewPlace | null>(null)
  const [scheduleTime, setScheduleTime] = useState('')
  const [details, setDetails] = useState<ViewPlace | null>(null)
  const [listening, setListening] = useState(false)
  const [locationNote, setLocationNote] = useState('')

  useEffect(() => localStorage.setItem('bite-saved', JSON.stringify(saved)), [saved])
  useEffect(() => localStorage.setItem('bite-plans', JSON.stringify(plans)), [plans])

  const view = useMemo<ViewPlace[]>(
    () =>
      places.map((place) => ({
        ...place,
        travel: travelMinutes(place.miles, mode),
        distanceLabel: `about ${formatMiles(place.miles)}`,
      })),
    [mode],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const named = NEIGHBORHOODS.find((name) => name.toLowerCase() === area.trim().toLowerCase())
    const budgetCap = budget ? Number(budget) : null
    return view.filter((place) => {
      const blob = `${place.name} ${place.cuisine} ${place.neighborhood} ${place.address} ${place.dishes.join(' ')} ${place.note}`.toLowerCase()
      if (needle && !blob.includes(needle)) return false
      if (!isCitywide(area)) {
        if (named) {
          if (place.neighborhood !== named) return false
        } else if (!blob.includes(area.trim().toLowerCase())) return false
      }
      if (cuisine !== 'All food' && place.cuisine !== cuisine) return false
      if (budgetCap && place.serving > budgetCap) return false
      if (assistantPreference === 'Comfort food' && !COMFORT_CUISINES.includes(place.cuisine)) return false
      if (assistantPreference && assistantPreference !== 'Comfort food' && assistantPreference !== 'Surprise me' && place.cuisine !== assistantPreference) {
        return false
      }
      if (assistantMaxTravel && place.travel > assistantMaxTravel) return false
      return true
    })
  }, [view, query, area, cuisine, budget, assistantPreference, assistantMaxTravel])

  const grouped = useMemo(() => {
    if (!isCitywide(area) || query.trim()) return [{ name: '', places: filtered }]
    return NEIGHBORHOODS.map((name) => ({
      name,
      places: filtered.filter((place) => place.neighborhood === name),
    })).filter((group) => group.places.length)
  }, [filtered, area, query])

  const momentPick = useMemo(() => {
    const summaries = view.map(toSummary)
    const pick = pickForMoment(moment, summaries)
    return pick ? view.find((place) => place.id === pick.id) ?? null : null
  }, [view, moment])

  const chatPlaces = chatIds.map((id) => view.find((place) => place.id === id)).filter((place): place is ViewPlace => Boolean(place))
  const selectedDate = formatWhen(date)
  const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
  const monthDays = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate()
  const calendarCells = [...Array(monthStart.getDay()).fill(null), ...Array.from({ length: monthDays }, (_, index) => index + 1)]

  function dateKey(day: number): string {
    return `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  function toggleSave(id: string) {
    setSaved((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  function resetFilters() {
    setCuisine('All food')
    setBudget('')
    setArea('Seattle, WA')
    setDate(today)
    setAssistantPreference(null)
    setAssistantMaxTravel(null)
    setQuery('')
  }

  function confirmPlan() {
    if (!schedulePlace || !date || !scheduleTime) return
    setPlans((current) => [
      ...current.filter((plan) => plan.placeId !== schedulePlace.id),
      { placeId: schedulePlace.id, date, time: scheduleTime },
    ])
    setConfirmation({ place: schedulePlace, date, time: scheduleTime })
    setSchedulePlace(null)
  }

  async function sendMessage(text = chatInput) {
    const trimmed = text.trim()
    if (!trimmed || assistantBusy) return
    setChatInput('')
    setShowChatResults(false)
    setAssistantError('')
    setMessages((current) => [...current, `You: ${trimmed}`])
    setAssistantBusy(true)
    const named = NEIGHBORHOODS.find((name) => name.toLowerCase() === area.trim().toLowerCase()) ?? null
    try {
      const response = await askFoodAssistant({
        message: trimmed,
        location: area,
        neighborhood: named,
        mode,
        budget: budget ? Number(budget) : null,
        mealMoment: moment,
        places: view.map(toSummary),
      })
      if (response.preference) setAssistantPreference(response.preference)
      if (response.maxTravelMinutes) setAssistantMaxTravel(response.maxTravelMinutes)
      if (response.neighborhood) setArea(response.neighborhood)
      if (response.maxBudget) setBudget(String(response.maxBudget))
      setReasons(response.reasons)
      setChatIds(response.rankedIds)
      setShowChatResults(true)
      setMessages((current) => [...current, response.reply])
      if (response.error) setAssistantError(response.error)
    } catch {
      setAssistantError('The assistant failed before it could answer.')
      setMessages((current) => [...current, 'Something went wrong before I could look at the list. Please try that again.'])
    } finally {
      setAssistantBusy(false)
    }
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocationNote('This browser has no location service. Browse by neighborhood instead.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      () => setLocationNote('Location is on. Pick a neighborhood to narrow the list. This demo does not rerank by GPS.'),
      () => setLocationNote('Location permission was blocked. Browse by neighborhood instead.'),
    )
  }

  function startVoice() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Speech) {
      setMessages((current) => [...current, 'Voice input is not supported in this browser. Type your request instead.'])
      setAssistantVisible(true)
      return
    }
    const recognition = new Speech()
    setListening(true)
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      setChatInput(event.results[0][0].transcript)
      setListening(false)
    }
    recognition.onerror = () => {
      setListening(false)
      setAssistantError('The microphone did not return a request. Type it instead.')
    }
    recognition.onend = () => setListening(false)
    recognition.start()
  }

  const plansForDay = plans.filter((plan) => plan.date === date)

  return (
    <main className="stage">
      <section className="phone">
        <header className="topbar">
          <button type="button" className="avatar" onClick={() => setTab('user')} aria-label="Open profile">
            AM
          </button>
          <button type="button" className="location" onClick={() => setFiltersOpen(true)}>
            <span>YOUR LOCATION</span>
            <strong>
              <Icon name="pin" size={15} />
              <em>{area}</em>
            </strong>
          </button>
          <button type="button" className="icon-btn" data-testid="open-filters" onClick={() => setFiltersOpen(true)} aria-label="Filters">
            <Icon name="sliders" />
          </button>
        </header>
        <div className="content">
          {tab === 'home' && (
            <>
              <div className="intro">
                <p className="eyebrow">FIND YOUR NEXT BITE</p>
                <h1>What are you craving?</h1>
              </div>
              {!assistantVisible && (
                <button type="button" className="customization-button" data-testid="open-assistant" onClick={() => setAssistantVisible(true)}>
                  <span>
                    <Icon name="sliders" />
                    <span>
                      <strong>Customization</strong>
                      <small>Personalize food picks with your AI assistant</small>
                    </span>
                  </span>
                  <Icon name="arrow" />
                </button>
              )}
              {assistantVisible && (
                <section className="ai-assistant" data-testid="assistant">
                  <button type="button" className="ai-heading" onClick={() => setAssistantVisible(true)}>
                    <span className="ai-mark">
                      <Icon name="spark" />
                    </span>
                    <span>
                      <strong>Your food assistant</strong>
                      <small>On-device matches, unless an assistant URL is configured</small>
                    </span>
                    <Icon name="arrow" />
                  </button>
                  {!messages.length && momentPick && (
                    <div className="context-intro">
                      <div className="context-weather">
                        <span>
                          <Icon name="clock" size={15} />
                          {moment}
                        </span>
                        <span>Overcast · 52°F</span>
                        <i>SIMULATED</i>
                      </div>
                      <p>
                        Hello Alex! It’s overcast and 52°F in Seattle. That weather is simulated, not a live forecast. For {moment}, a
                        strong pick is <strong>{momentPick.name}</strong> on {momentPick.street} in {momentPick.neighborhood}.
                      </p>
                      <div className="context-pick">
                        <PlacePhoto place={momentPick} />
                        <div>
                          <span>ONE PICK FOR RIGHT NOW</span>
                          <strong>{momentPick.name}</strong>
                          <small>
                            ${momentPick.serving}/person · {momentPick.travel} min {mode}
                          </small>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSchedulePlace(momentPick)
                            setScheduleTime('')
                          }}
                          aria-label={`Plan a visit to ${momentPick.name}`}
                        >
                          <Icon name="calendar" size={17} />
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="chat-body">
                    {messages.map((message, index) => (
                      <div className={message.startsWith('You:') ? 'message user-message' : 'message'} key={`${message}-${index}`}>
                        {message}
                      </div>
                    ))}
                    {assistantError && (
                      <div className="chat-error" role="alert" data-testid="assistant-error">
                        {assistantError}
                      </div>
                    )}
                    {assistantBusy && <div className="message">Looking through Seattle places…</div>}
                    {showChatResults && (
                      <div className="chat-results" data-testid="chat-results">
                        <p>TOP CHOICES FOR YOU</p>
                        {chatPlaces.map((place, index) => (
                          <article className="chat-choice" key={place.id}>
                            <PlacePhoto place={place} />
                            <div>
                              <span>
                                #{index + 1} · {place.cuisine}
                              </span>
                              <strong>{place.name}</strong>
                              <small>
                                ${place.serving}/person · {place.travel} min {mode} · {place.wait} min wait
                              </small>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSchedulePlace(place)
                                setScheduleTime('')
                              }}
                              aria-label={`Add ${place.name} to calendar`}
                            >
                              <Icon name="calendar" size={17} />
                            </button>
                          </article>
                        ))}
                        {!chatPlaces.length && (
                          <div className="chat-no-results" data-testid="chat-empty">
                            No exact matches yet. Try increasing your travel time or budget.
                          </div>
                        )}
                        <small className="chat-results-note">Travel and wait times are estimates, not live traffic.</small>
                      </div>
                    )}
                    <div className="suggested">
                      <button type="button" onClick={() => void sendMessage('Comfort food')}>
                        Comfort food
                      </button>
                      <button type="button" onClick={() => void sendMessage('I have 30 minutes')}>
                        30 minutes
                      </button>
                      <button type="button" onClick={() => void sendMessage('Shortest travel time')}>
                        Shortest trip
                      </button>
                      <button type="button" onClick={() => void sendMessage('Surprise me')}>
                        Surprise me
                      </button>
                    </div>
                    <button type="button" className="location-permission" data-testid="use-location" onClick={requestLocation}>
                      <Icon name="pin" size={15} /> Use my current location
                    </button>
                    {locationNote && (
                      <p className="location-note" role="status" data-testid="location-note">
                        {locationNote}
                      </p>
                    )}
                    <div className="chat-input">
                      <input
                        data-testid="chat-input"
                        value={chatInput}
                        onChange={(event) => setChatInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void sendMessage()
                        }}
                        placeholder="Ask for pasta under $30…"
                      />
                      <button type="button" className={listening ? 'listening' : ''} onClick={startVoice} aria-label="Speak request">
                        <Icon name="mic" />
                      </button>
                      <button type="button" onClick={() => void sendMessage()} disabled={assistantBusy} aria-label="Send">
                        <Icon name="send" />
                      </button>
                    </div>
                  </div>
                </section>
              )}
              <label className="search">
                <Icon name="search" size={22} />
                <input
                  data-testid="search-input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Restaurant, dish, or cuisine"
                />
                <button type="button" onClick={() => setQuery('')} aria-label={query ? 'Clear search' : 'Search'}>
                  {query ? '×' : 'GO'}
                </button>
              </label>
              <div className="filters">
                <button type="button" className="chip selected" onClick={() => setFiltersOpen(true)}>
                  <Icon name="calendar" size={16} />
                  {new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </button>
                <button type="button" className="chip" onClick={() => setFiltersOpen(true)}>
                  {cuisine}
                </button>
                <button type="button" className="chip" onClick={() => setFiltersOpen(true)}>
                  {budget ? `Up to $${budget}` : 'Any budget'}
                </button>
                {assistantPreference && (
                  <button type="button" className="chip assistant" onClick={() => setAssistantPreference(null)}>
                    {assistantPreference} ×
                  </button>
                )}
                {assistantMaxTravel != null && (
                  <button type="button" className="chip assistant" onClick={() => setAssistantMaxTravel(null)}>
                    ≤ {assistantMaxTravel} min ×
                  </button>
                )}
              </div>
              <div className="filters areas" data-testid="neighborhoods">
                <button type="button" className={isCitywide(area) ? 'chip selected' : 'chip'} onClick={() => setArea('Seattle, WA')}>
                  All
                </button>
                {NEIGHBORHOODS.map((name) => (
                  <button
                    type="button"
                    key={name}
                    className={area === name ? 'chip selected' : 'chip'}
                    onClick={() => setArea(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <button type="button" className="filter-hero" onClick={() => setFiltersOpen(true)}>
                <span>
                  <Icon name="sliders" />
                  <span>
                    <strong>Plan your meal</strong>
                    <small>Set date, cuisine, neighborhood & budget</small>
                  </span>
                </span>
                <Icon name="arrow" />
              </button>
              <div className="transport">
                <span>GETTING THERE</span>
                {MODES.map((item) => (
                  <button type="button" key={item.key} className={mode === item.key ? 'active' : ''} onClick={() => setMode(item.key)}>
                    <Icon name={item.key} />
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="section-title">
                <div>
                  <p className="eyebrow">
                    {filtered.length} {filtered.length === 1 ? 'PLACE' : 'PLACES'}{' '}
                    {isCitywide(area) ? 'IN SEATTLE' : `IN ${area.toUpperCase()}`}
                  </p>
                  <h2>{query ? `Results for “${query}”` : 'Restaurants for you'}</h2>
                </div>
              </div>
              <p className="estimate-note">Prices, travel, and waits are estimates measured from Pike Place Market. Not live traffic.</p>
              <div className="restaurant-list">
                {grouped.map((group) => (
                  <section key={group.name || 'matches'}>
                    {group.name && <h3 className="group-label">{group.name.toUpperCase()}</h3>}
                    <div className="restaurant-list">
                      {group.places.map((place) => (
                        <ResultCard
                          key={place.id}
                          place={place}
                          mode={mode}
                          saved={saved.includes(place.id)}
                          reason={reasons[place.id]}
                          onSave={() => toggleSave(place.id)}
                          onDetails={() => setDetails(place)}
                          onPlan={() => {
                            setSchedulePlace(place)
                            setScheduleTime('')
                          }}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              {!filtered.length && (
                <div className="empty" data-testid="empty-results">
                  <Icon name="search" size={32} />
                  <h2>No exact matches</h2>
                  <p>Try another cuisine, neighborhood, or a higher budget.</p>
                  <button type="button" onClick={resetFilters}>
                    Clear filters
                  </button>
                </div>
              )}
            </>
          )}

          {tab === 'calendar' && (
            <div data-testid="calendar">
              <div className="calendar-head">
                <p className="eyebrow">YOUR DINING CALENDAR</p>
                <h1>Make time for good food.</h1>
                <p>Choose any future date, then add a restaurant. Plans stay on this device.</p>
              </div>
              <div className="calendar-toolbar">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}
                >
                  ‹
                </button>
                <h2>{calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}
                >
                  ›
                </button>
              </div>
              <div className="month-calendar">
                {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((day) => (
                  <span className="weekday" key={day}>
                    {day}
                  </span>
                ))}
                {calendarCells.map((day, index) =>
                  day ? (
                    <button
                      type="button"
                      key={day}
                      className={
                        dateKey(day) === date ? 'calendar-day selected' : plans.some((plan) => plan.date === dateKey(day)) ? 'calendar-day has-plan' : 'calendar-day'
                      }
                      onClick={() => setDate(dateKey(day))}
                    >
                      <strong>{day}</strong>
                      {plans
                        .filter((plan) => plan.date === dateKey(day))
                        .slice(0, 2)
                        .map((plan) => (
                          <i key={plan.placeId}>{places.find((place) => place.id === plan.placeId)?.name.slice(0, 1)}</i>
                        ))}
                    </button>
                  ) : (
                    <span className="calendar-day blank" key={`blank-${index}`} />
                  ),
                )}
              </div>
              <div className="calendar-legend">
                <span>
                  <i /> Restaurant planned
                </span>
                <strong>
                  {plans.length} total plan{plans.length === 1 ? '' : 's'}
                </strong>
              </div>
              <label className="date-picker">
                <span>
                  <Icon name="calendar" />
                  SELECTED DATE
                </span>
                <input
                  type="date"
                  min={today}
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value)
                    setCalendarMonth(new Date(`${event.target.value}T12:00:00`))
                  }}
                />
              </label>
              <h2 className="chosen-date">Plans for {selectedDate}</h2>
              <button type="button" className="back-discover" onClick={() => setTab('home')}>
                ← Back to restaurants
              </button>
              {plansForDay.length ? (
                <div className="plan-overview">
                  {plansForDay.map((plan) => {
                    const place = view.find((item) => item.id === plan.placeId)
                    if (!place) return null
                    return (
                      <article className="planned-card" key={plan.placeId}>
                        <PlacePhoto place={place} />
                        <div className="planned-copy">
                          <p>DINING PLAN</p>
                          <h3>{place.name}</h3>
                          <span>{formatWhen(plan.date, plan.time)}</span>
                          <small>
                            ${place.serving}/person · {place.travel + place.wait} min total with {mode}
                          </small>
                        </div>
                        <Icon name="check" />
                        {editing === place.id ? (
                          <div className="edit-panel">
                            <label>
                              Change date
                              <input
                                type="date"
                                min={today}
                                value={plan.date}
                                onChange={(event) =>
                                  setPlans((current) => current.map((item) => (item.placeId === place.id ? { ...item, date: event.target.value } : item)))
                                }
                              />
                            </label>
                            <label>
                              Arrival time
                              <input
                                type="time"
                                value={plan.time}
                                onChange={(event) =>
                                  setPlans((current) => current.map((item) => (item.placeId === place.id ? { ...item, time: event.target.value } : item)))
                                }
                              />
                            </label>
                            <div>
                              <button type="button" onClick={() => setEditing(null)}>
                                Done
                              </button>
                              <button
                                type="button"
                                className="remove"
                                onClick={() => {
                                  setPlans((current) => current.filter((item) => item.placeId !== place.id))
                                  setEditing(null)
                                }}
                              >
                                Remove plan
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" className="edit-plan" onClick={() => setEditing(place.id)}>
                            View or edit plan
                          </button>
                        )}
                      </article>
                    )
                  })}
                  <button type="button" className="add-another" onClick={() => setTab('home')}>
                    <Icon name="plus" /> Add another restaurant
                  </button>
                </div>
              ) : (
                <div className="empty calendar-empty" data-testid="calendar-empty">
                  <Icon name="calendar" size={32} />
                  <h2>No meal on this date</h2>
                  <p>Select a marked date to see its restaurant, or plan a new meal.</p>
                  <button type="button" onClick={() => setTab('home')}>
                    Find a restaurant
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'heart' && (
            <div data-testid="saved">
              <div className="simple-page">
                <p className="eyebrow">YOUR COLLECTION</p>
                <h1>Saved places</h1>
                <p>
                  {saved.length
                    ? `${saved.length} restaurant${saved.length > 1 ? 's' : ''} saved on this device.`
                    : 'Restaurants you love will appear here.'}
                </p>
              </div>
              <div className="restaurant-list saved-list">
                {view
                  .filter((place) => saved.includes(place.id))
                  .map((place) => (
                    <article className="saved-row" key={place.id}>
                      <PlacePhoto place={place} />
                      <div>
                        <span>{place.cuisine}</span>
                        <h3>{place.name}</h3>
                        <p>
                          {place.neighborhood} · {place.price} · {place.travel + place.wait} min total
                        </p>
                      </div>
                      <button type="button" onClick={() => toggleSave(place.id)} aria-label={`Remove ${place.name} from saved`}>
                        <Icon name="heart" filled />
                      </button>
                    </article>
                  ))}
              </div>
              {!saved.length && (
                <div className="empty" data-testid="saved-empty">
                  <Icon name="heart" size={32} />
                  <h2>Nothing saved yet</h2>
                  <button type="button" onClick={() => setTab('home')}>
                    Explore restaurants
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'user' && (
            <div className="simple-page profile" data-testid="profile">
              <div className="profile-avatar">AM</div>
              <h1>Alex Morgan</h1>
              <p>Taste profile: adventurous, cozy, and always up for pasta.</p>
              <div className="preference">
                <span>Current location</span>
                <strong>{area}</strong>
              </div>
              <div className="preference">
                <span>Maximum budget</span>
                <strong>{budget ? `$${budget} per person` : 'No limit'}</strong>
              </div>
              <div className="preference">
                <span>Travel preference</span>
                <strong>{MODES.find((item) => item.key === mode)?.label}</strong>
              </div>
              <div className="preference">
                <span>Saved on this device</span>
                <strong>
                  {saved.length} place{saved.length === 1 ? '' : 's'}
                </strong>
              </div>
            </div>
          )}
        </div>
        <Nav tab={tab} setTab={setTab} />

        {filtersOpen && (
          <div className="sheet-backdrop" data-testid="filter-sheet" onClick={() => setFiltersOpen(false)}>
            <section className="filter-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Filters">
              <div className="sheet-title">
                <div>
                  <p className="eyebrow">REFINE YOUR SEARCH</p>
                  <h2>Filters</h2>
                </div>
                <button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters">
                  <Icon name="close" />
                </button>
              </div>
              <label className="field">
                <span>Location</span>
                <div>
                  <Icon name="pin" />
                  <input value={area} onChange={(event) => setArea(event.target.value)} placeholder="City or neighborhood" />
                </div>
              </label>
              <fieldset>
                <legend>Neighborhood</legend>
                <div className="option-grid areas">
                  <button type="button" className={isCitywide(area) ? 'active' : ''} onClick={() => setArea('Seattle, WA')}>
                    All
                  </button>
                  {NEIGHBORHOODS.map((name) => (
                    <button type="button" className={area === name ? 'active' : ''} onClick={() => setArea(name)} key={name}>
                      {name}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="field">
                <span>Date</span>
                <div>
                  <Icon name="calendar" />
                  <input type="date" min={today} value={date} onChange={(event) => setDate(event.target.value)} />
                </div>
              </label>
              <fieldset>
                <legend>Food type</legend>
                <div className="option-grid">
                  {['All food', ...CUISINES].map((name) => (
                    <button type="button" className={cuisine === name ? 'active' : ''} onClick={() => setCuisine(name)} key={name}>
                      {name}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="field">
                <span>Maximum budget per person</span>
                <div>
                  <strong>$</strong>
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={budget}
                    onChange={(event) => setBudget(event.target.value)}
                    placeholder="Enter amount, e.g. 35"
                  />
                </div>
                <small className="field-hint">Only places with an estimated serving at or below this amount appear.</small>
              </label>
              <button
                type="button"
                className="apply"
                onClick={() => {
                  setFiltersOpen(false)
                  setTab('home')
                }}
              >
                Show {filtered.length} restaurants
              </button>
              <button type="button" className="reset" onClick={resetFilters}>
                Reset all filters
              </button>
            </section>
          </div>
        )}

        {schedulePlace && (
          <div className="confirmation-backdrop">
            <section className="schedule-card" role="dialog" aria-label="Create a dining plan" data-testid="schedule">
              <div className="sheet-title">
                <div>
                  <p className="eyebrow">CREATE A DINING PLAN</p>
                  <h2>When would you like to go?</h2>
                </div>
                <button type="button" onClick={() => setSchedulePlace(null)} aria-label="Close scheduling">
                  <Icon name="close" />
                </button>
              </div>
              <div className="schedule-restaurant">
                <PlacePhoto place={schedulePlace} />
                <div>
                  <strong>{schedulePlace.name}</strong>
                  <span>
                    {schedulePlace.neighborhood} · ${schedulePlace.serving}/person
                  </span>
                </div>
              </div>
              <label className="field">
                <span>Date</span>
                <div>
                  <Icon name="calendar" />
                  <input type="date" min={today} value={date} onChange={(event) => setDate(event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span>Preferred arrival time</span>
                <div>
                  <Icon name="clock" />
                  <input data-testid="schedule-time" type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} />
                </div>
              </label>
              <div className="plan-summary">
                <strong>Plan summary</strong>
                <span>{schedulePlace.name}</span>
                <span>{scheduleTime ? formatWhen(date, scheduleTime) : selectedDate}</span>
                <small>This saves a personal dining plan. It does not reserve a table.</small>
              </div>
              <button type="button" className="continue-btn" data-testid="save-plan" disabled={!date || !scheduleTime} onClick={confirmPlan}>
                Save Dining Plan
              </button>
            </section>
          </div>
        )}

        {details && (
          <div className="confirmation-backdrop" onClick={() => setDetails(null)}>
            <section className="detail-card" data-testid="details" onClick={(event) => event.stopPropagation()} role="dialog" aria-label={details.name}>
              <PlacePhoto place={details} />
              <button type="button" className="detail-close" onClick={() => setDetails(null)} aria-label="Close details">
                <Icon name="close" />
              </button>
              <div>
                <p className="eyebrow">
                  {details.cuisine} · {details.neighborhood}
                </p>
                <h2>{details.name}</h2>
                <p className="address-line">
                  <Icon name="pin" size={14} />
                  {details.address}
                </p>
                <p>{details.note}</p>
                <div className="detail-facts">
                  <span>
                    <strong>${details.serving}</strong> per person
                  </span>
                  <span>
                    <strong>{details.rating ?? '—'}</strong> {details.rating ? 'public rating' : 'no public score'}
                  </span>
                  <span>
                    <strong>{details.travel + details.wait} min</strong> est. total
                  </span>
                </div>
                <p className="fine-print">
                  The photo is a stand-in for the cuisine, not a picture of this restaurant. Prices, travel, and wait times are estimates.
                  Adding it to the calendar does not reserve a table.
                </p>
                <button
                  type="button"
                  className="continue-btn"
                  onClick={() => {
                    setSchedulePlace(details)
                    setDetails(null)
                  }}
                >
                  Add to calendar
                </button>
              </div>
            </section>
          </div>
        )}

        {confirmation && (
          <div className="confirmation-backdrop">
            <section className="confirmation-card" role="dialog" aria-label="Dining plan saved" data-testid="confirmation">
              <span className="success-icon">
                <Icon name="check" size={28} />
              </span>
              <p className="eyebrow">DINING PLAN SAVED</p>
              <h2>Restaurant added</h2>
              <p className="confirmation-copy">Your restaurant visit has been added to your calendar. No table reservation was made.</p>
              <div className="confirmation-detail">
                <PlacePhoto place={confirmation.place} />
                <div>
                  <strong>{confirmation.place.name}</strong>
                  <span>
                    <Icon name="calendar" size={15} />
                    {formatWhen(confirmation.date)}
                  </span>
                  <small>
                    {new Date(`2000-01-01T${confirmation.time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · $
                    {confirmation.place.serving}/person
                  </small>
                </div>
              </div>
              <button
                type="button"
                className="continue-btn"
                onClick={() => {
                  setCalendarMonth(new Date(`${confirmation.date}T12:00:00`))
                  setDate(confirmation.date)
                  setConfirmation(null)
                  setTab('calendar')
                }}
              >
                Continue to my calendar <Icon name="arrow" />
              </button>
              <button type="button" className="keep-browsing" onClick={() => setConfirmation(null)}>
                Keep browsing
              </button>
            </section>
          </div>
        )}
      </section>
    </main>
  )
}
