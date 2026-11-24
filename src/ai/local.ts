import type { AssistantPlace, AssistantRequest, AssistantResponse, MealMoment } from './types'

export const COMFORT_CUISINES = ['Italian', 'Japanese', 'American', 'Chinese', 'Pizza', 'Southern', 'Cafe', 'Deli']

const CUISINE_RULES: Array<[string, RegExp]> = [
  ['Pizza', /\bpizza\b/],
  ['Thai', /\bthai\b|\bcurry\b/],
  ['Vietnamese', /\bvietnamese\b|\bpho\b|\bbanh mi\b/],
  ['Chinese', /\bchinese\b|\bdumplings?\b|\bdim sum\b|\bxiao long\b/],
  ['Japanese', /\bjapanese\b|\bsushi\b|\bsoba\b|\bomakase\b|\bramen\b/],
  ['Mexican', /\bmexican\b|\btacos?\b|\boaxaca\b|\bmezcal\b/],
  ['Caribbean', /\bcaribbean\b|\bpaseo\b/],
  ['Seafood', /\bseafood\b|\boysters?\b|\bchowder\b|\bfish\b/],
  ['French', /\bfrench\b|\bbistro\b/],
  ['Greek', /\bgreek\b/],
  ['Southern', /\bsouthern\b|\bcajun\b|\bcreole\b|\bbeignets?\b|\bgumbo\b/],
  ['Hawaiian', /\bhawaiian\b|\bfried chicken\b/],
  ['Cafe', /\bcafe\b|\bcoffee\b|\bpastr(?:y|ies)\b|\bbakery\b|\bbrunch\b|\bcroissant\b/],
  ['Deli', /\bdeli\b|\bice cream\b/],
  ['Korean', /\bkorean\b/],
  ['Filipino', /\bfilipino\b/],
  ['Turkish', /\bturkish\b|\bkebap\b|\bkebab\b/],
  ['Laotian', /\blaotian\b/],
  ['Spanish', /\bspanish\b|\bbasque\b|\bpaella\b/],
  ['Lebanese', /\blebanese\b|\bmezze\b|\bhummus\b/],
  ['Guamanian', /\bguamanian\b|\bchamorro\b|\bguam\b/],
  ['Soul Food', /\bsoul food\b/],
  ['Italian', /\bitalian\b|\bpasta\b|\blasagna\b/],
  ['Pacific Northwest', /\bpacific northwest\b|\btasting menu\b|\bfine dining\b/],
  ['American', /\bamerican\b|\bburgers?\b|\bpub\b/],
]

const STOP = new Set([
  'have', 'with', 'from', 'that', 'this', 'food', 'want', 'some', 'near', 'minutes', 'minute',
  'under', 'about', 'please', 'would', 'like', 'something', 'place', 'places', 'spot', 'spots',
  'good', 'best', 'cheap', 'quick', 'show', 'find', 'need', 'looking', 'really', 'seattle',
  'shortest', 'travel', 'time', 'trip', 'total', 'within',
  'dinner', 'lunch', 'breakfast', 'tonight', 'today', 'where', 'what', 'when', 'your', 'just',
])

const MOMENT_CUISINES: Record<MealMoment, string[]> = {
  breakfast: ['Cafe', 'Deli', 'American'],
  lunch: ['Vietnamese', 'Chinese', 'Seafood', 'Caribbean', 'Deli', 'Cafe'],
  dinner: ['Italian', 'Japanese', 'Seafood', 'Pacific Northwest', 'French', 'Southern'],
}

export function pickForMoment(mealMoment: MealMoment, places: AssistantPlace[]): AssistantPlace | null {
  const preferred = MOMENT_CUISINES[mealMoment]
  return places.find((place) => preferred.includes(place.cuisine)) ?? places[0] ?? null
}

export function localAssistant(request: AssistantRequest): AssistantResponse {
  const text = request.message.trim()
  const lower = text.toLowerCase()
  const neighborhoods = [...new Set(request.places.map((place) => place.neighborhood))].sort(
    (a, b) => b.length - a.length,
  )
  const namedNeighborhood = neighborhoods.find((name) => lower.includes(name.toLowerCase())) ?? null
  const cuisine = CUISINE_RULES.find(([, pattern]) => pattern.test(lower))?.[0] ?? null
  const preference = cuisine ?? (/\bcomfort\b/.test(lower) ? 'Comfort food' : /\bsurprise\b/.test(lower) ? 'Surprise me' : null)
  const minuteMatch = lower.match(/(\d+)\s*(minutes|minute|mins|min)\b/)
  const shortest = /\bshortest\b/.test(lower)
  const dollarMatch = lower.match(/(?:\$|dollars?)\s*(\d+)|(\d+)\s*dollars?/)
  const maxBudget = dollarMatch ? Number(dollarMatch[1] || dollarMatch[2]) : null
  const useTotal = /\btotal\b/.test(lower)

  let pool = request.places.slice()
  const activeBudget = maxBudget ?? request.budget
  if (activeBudget) pool = pool.filter((place) => place.serving <= activeBudget)
  if (namedNeighborhood) pool = pool.filter((place) => place.neighborhood === namedNeighborhood)
  else if (request.neighborhood) pool = pool.filter((place) => place.neighborhood === request.neighborhood)

  if (preference === 'Comfort food') pool = pool.filter((place) => COMFORT_CUISINES.includes(place.cuisine))
  else if (preference && preference !== 'Surprise me') pool = pool.filter((place) => place.cuisine === preference)

  const greeting = /^(hi|hey|hello|help)\b/.test(lower)
  if (!greeting && !preference) {
    const words = lower.split(/[^a-z0-9']+/).filter((word) => word.length > 3 && !STOP.has(word))
    if (words.length) {
      const narrowed = pool.filter((place) => words.some((word) => blob(place).includes(word)))
      if (narrowed.length) pool = narrowed
      else if (!namedNeighborhood) pool = []
    }
  }

  let maxTravelMinutes: number | null = null
  if (minuteMatch) {
    maxTravelMinutes = Number(minuteMatch[1])
    pool = pool.filter((place) => (useTotal ? place.travelMinutes + place.waitMinutes : place.travelMinutes) <= maxTravelMinutes!)
  } else if (shortest && pool.length) {
    const fastest = Math.min(...pool.map((place) => place.travelMinutes))
    maxTravelMinutes = fastest + 5
    pool = pool.filter((place) => place.travelMinutes <= maxTravelMinutes!)
  }

  const ranked = sortPlaces(pool, request, preference, shortest).slice(0, 3)
  const reasons: Record<string, string> = {}
  for (const place of ranked) {
    reasons[place.id] = `${place.name} is ${place.cuisine} in ${place.neighborhood}, about ${place.travelMinutes} min by ${request.mode}, with an estimated $${place.serving} plate.`
  }

  return {
    reply: replyFor(ranked, preference, namedNeighborhood, maxTravelMinutes, request.mode, text),
    preference,
    neighborhood: namedNeighborhood,
    maxTravelMinutes,
    maxBudget,
    rankedIds: ranked.map((place) => place.id),
    reasons,
    source: 'local',
  }
}

function blob(place: AssistantPlace): string {
  return `${place.name} ${place.cuisine} ${place.neighborhood} ${place.address} ${place.street} ${place.note} ${place.dishes.join(' ')}`.toLowerCase()
}

function sortPlaces(
  pool: AssistantPlace[],
  request: AssistantRequest,
  preference: string | null,
  shortest: boolean,
): AssistantPlace[] {
  const copy = pool.slice()
  if (shortest || preference === null) {
    copy.sort((a, b) => a.travelMinutes - b.travelMinutes || (b.rating ?? 0) - (a.rating ?? 0))
  }
  if (preference === 'Surprise me') {
    const seed = request.message.length + copy.length
    copy.sort((a, b) => hash(a.id + seed) - hash(b.id + seed))
    return copy
  }
  if (!shortest && preference) {
    copy.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.travelMinutes - b.travelMinutes)
  }
  return copy
}

function hash(value: string): number {
  let total = 0
  for (const char of value) total = (total * 33 + char.charCodeAt(0)) >>> 0
  return total
}

function replyFor(
  ranked: AssistantPlace[],
  preference: string | null,
  neighborhood: string | null,
  maxTravel: number | null,
  mode: string,
  original: string,
): string {
  if (/^(hi|hey|hello|help)\b/i.test(original.trim()) && ranked.length) {
    return `Tell me a cuisine, a neighborhood, a budget, or how long you want to travel. ${ranked[0].name} in ${ranked[0].neighborhood} is one place already on the list.`
  }
  if (!ranked.length) {
    return 'No exact matches yet. Try a wider travel time, a higher budget, or another neighborhood.'
  }
  const names = ranked.map((place) => place.name)
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const focus = [
    preference ? `for ${preference.toLowerCase()}` : '',
    neighborhood ? `in ${neighborhood}` : '',
    maxTravel ? `within about ${maxTravel} minutes by ${mode}` : '',
  ].filter(Boolean).join(' ')
  const count = ranked.length === 1 ? 'one strong match' : ranked.length === 2 ? 'two strong matches' : 'three strong matches'
  const review = ranked.length === 1 ? 'You can review it or add it to your calendar below.' : 'You can review them or add one to your calendar below.'
  return `I found ${count}${focus ? ` ${focus}` : ''}: ${list}. ${review}`
}
