export type MealMoment = 'breakfast' | 'lunch' | 'dinner'
export type TravelMode = 'walk' | 'bike' | 'car'

export type AssistantPlace = {
  id: string
  name: string
  cuisine: string
  neighborhood: string
  address: string
  street: string
  price: string
  serving: number
  rating: number | null
  travelMinutes: number
  waitMinutes: number
  note: string
  dishes: string[]
}

export type AssistantRequest = {
  message: string
  location: string
  neighborhood: string | null
  mode: TravelMode
  budget: number | null
  mealMoment: MealMoment
  places: AssistantPlace[]
}

export type AssistantResponse = {
  reply: string
  preference: string | null
  neighborhood: string | null
  maxTravelMinutes: number | null
  maxBudget: number | null
  rankedIds: string[]
  reasons: Record<string, string>
  source: 'local' | 'remote'
  error?: string
}
