const PLACES = [
  ['Warsaw', 'PL', 52.2297, 21.0122, ['warszawa']],
  ['Krakow', 'PL', 50.0647, 19.945, ['kraków', 'cracow']],
  ['Gdansk', 'PL', 54.352, 18.6466, ['gdańsk', 'danzig']],
  ['Poznan', 'PL', 52.4064, 16.9252, ['poznań']],
  ['Wroclaw', 'PL', 51.1079, 17.0385, ['wrocław']],
  ['Lodz', 'PL', 51.7592, 19.456, ['łódź']],
  ['Berlin', 'DE', 52.52, 13.405],
  ['Hamburg', 'DE', 53.5511, 9.9937],
  ['Munich', 'DE', 48.1351, 11.582, ['münchen', 'munchen']],
  ['Frankfurt', 'DE', 50.1109, 8.6821],
  ['Cologne', 'DE', 50.9375, 6.9603, ['köln', 'koln']],
  ['Duisburg', 'DE', 51.4344, 6.7623],
  ['Stuttgart', 'DE', 48.7758, 9.1829],
  ['Bucharest', 'RO', 44.4268, 26.1025, ['bucuresti', 'bucurești']],
  ['Constanta', 'RO', 44.1598, 28.6348, ['constanța']],
  ['Timisoara', 'RO', 45.7489, 21.2087, ['timișoara']],
  ['Cluj-Napoca', 'RO', 46.7712, 23.6236, ['cluj']],
  ['Chisinau', 'MD', 47.0105, 28.8638, ['chișinău', 'kishinev']],
  ['Milan', 'IT', 45.4642, 9.19, ['milano']],
  ['Rome', 'IT', 41.9028, 12.4964, ['roma']],
  ['Rotterdam', 'NL', 51.9244, 4.4777],
  ['Amsterdam', 'NL', 52.3676, 4.9041],
  ['Prague', 'CZ', 50.0755, 14.4378, ['praha']],
  ['Vienna', 'AT', 48.2082, 16.3738, ['wien']],
  ['Budapest', 'HU', 47.4979, 19.0402],
  ['Bratislava', 'SK', 48.1486, 17.1077],
  ['Paris', 'FR', 48.8566, 2.3522],
  ['Lyon', 'FR', 45.764, 4.8357],
  ['Brussels', 'BE', 50.8503, 4.3517, ['bruxelles']],
  ['Vilnius', 'LT', 54.6872, 25.2797],
  ['Riga', 'LV', 56.9496, 24.1052],
  ['Tallinn', 'EE', 59.437, 24.7536],
  ['Sofia', 'BG', 42.6977, 23.3219],
  ['Madrid', 'ES', 40.4168, -3.7038],
  ['Barcelona', 'ES', 41.3874, 2.1686],
  ['Lisbon', 'PT', 38.7223, -9.1393, ['lisboa']],
  ['London', 'GB', 51.5074, -0.1278],
  ['Manchester', 'GB', 53.4808, -2.2426],
  ['Dublin', 'IE', 53.3498, -6.2603],
  ['Zurich', 'CH', 47.3769, 8.5417, ['zürich']],
]

function fold(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

const INDEX = PLACES.map(([name, country, lat, lng, aliases = []]) => ({
  name,
  country,
  lat,
  lng,
  keys: [fold(name), ...aliases.map(fold)],
}))

export function findCity(input) {
  const q = fold(input)
  if (!q) return null
  const hit = INDEX
    .flatMap((place) => place.keys.map((key) => ({ place, key })))
    .sort((a, b) => b.key.length - a.key.length)
    .find((item) => q.includes(item.key))
  return hit ? hit.place : null
}

function haversine(a, b) {
  const r = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s1 = Math.sin(dLat / 2) ** 2
  const s2 = Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(s1 + s2))
}

export function estimateRoute(origin, destination) {
  const from = findCity(origin)
  const to = findCity(destination)
  if (!from || !to) return null
  const distanceKm = Math.round(haversine(from, to) * 1.2)
  const durationMin = Math.max(30, Math.round((distanceKm / 68) * 60))
  return { distanceKm, durationMin, source: 'estimate' }
}

export async function computeRoute(origin, destination) {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (key && origin && destination) {
    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json')
    url.searchParams.set('origins', origin)
    url.searchParams.set('destinations', destination)
    url.searchParams.set('mode', 'driving')
    url.searchParams.set('units', 'metric')
    url.searchParams.set('key', key)
    try {
      const res = await fetch(url)
      const data = await res.json()
      const element = data.rows?.[0]?.elements?.[0]
      if (element?.status === 'OK') {
        return {
          distanceKm: Math.round(element.distance.value / 1000),
          durationMin: Math.round(element.duration.value / 60),
          source: 'google',
        }
      }
    } catch (err) {
      console.error('Google routing failed', err.message)
    }
  }
  return estimateRoute(origin, destination)
}
