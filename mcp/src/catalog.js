export const RESOURCES = {
  company: {
    collection: '/api/companies',
    item: (id) => `/api/companies/${id}`,
    listQuery: ['q', 'role', 'limit'],
    methods: { list: 'GET', get: 'GET', insert: 'POST', update: 'PATCH', delete: 'DELETE' },
  },
  contact: {
    collection: '/api/contacts',
    item: (id) => `/api/contacts/${id}`,
    listQuery: ['q', 'companyId', 'limit'],
    methods: { list: 'GET', get: 'GET', insert: 'POST', update: 'PATCH', delete: 'DELETE' },
  },
  order: {
    collection: '/api/orders',
    item: (id) => `/api/orders/${id}`,
    listQuery: ['q', 'limit'],
    methods: { list: 'GET', get: 'GET', insert: 'POST', update: 'PATCH', delete: 'DELETE' },
  },
  expense: {
    collection: '/api/expenses',
    item: (id) => `/api/expenses/${id}`,
    listQuery: ['from', 'to', 'q', 'paymentType', 'companyId', 'orderId', 'currency'],
    methods: { list: 'GET', insert: 'POST', update: 'PATCH', delete: 'DELETE' },
  },
  invoice: {
    collection: '/api/invoices',
    item: (id) => `/api/invoices/${id}`,
    listQuery: [],
    methods: { list: 'GET', get: 'GET', insert: 'POST', update: 'PATCH' },
  },
  vehicle: {
    collection: '/api/vehicles',
    item: (id) => `/api/vehicles/${id}`,
    listQuery: [],
    methods: { list: 'GET', insert: 'POST', update: 'PATCH', delete: 'DELETE' },
  },
  driver: {
    collection: '/api/drivers',
    item: (id) => `/api/drivers/${id}`,
    listQuery: [],
    methods: { list: 'GET', insert: 'POST', update: 'PATCH', delete: 'DELETE' },
  },
  activity: {
    collection: '/api/activities',
    item: (id) => `/api/activities/${id}`,
    listQuery: ['objectType', 'objectId', 'open', 'tasks', 'status'],
    methods: { list: 'GET', insert: 'POST', update: 'PATCH' },
  },
  workflow: {
    collection: '/api/workflows',
    item: (id) => `/api/workflows/${id}`,
    listQuery: [],
    methods: { list: 'GET', get: 'GET', insert: 'POST', update: 'PATCH', delete: 'DELETE' },
  },
  document: {
    collection: '/api/documents',
    item: (id) => `/api/documents/${id}`,
    listQuery: ['objectType', 'objectId'],
    methods: { list: 'GET', delete: 'DELETE' },
  },
  user: {
    collection: '/api/users',
    item: (id) => `/api/users/${id}`,
    listQuery: [],
    methods: { list: 'GET', insert: 'POST', update: 'PATCH' },
  },
  address: {
    collection: '/api/addresses',
    item: null,
    listQuery: ['q'],
    methods: { list: 'GET' },
  },
}

export const RESOURCE_NAMES = Object.keys(RESOURCES)
export const BATCH_OPS = ['insert', 'update', 'delete']

export function pickQuery(resource, args = {}) {
  const keys = RESOURCES[resource]?.listQuery || []
  const query = {}
  for (const key of keys) {
    if (args[key] != null && args[key] !== '') query[key] = args[key]
  }
  return query
}
