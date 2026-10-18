import type { Endpoint, SmokeCase } from '../shared/types';

export type Scenario = {
  id: string;
  title: string;
  client: string;
  summary: string;
  entity: string;
  collection: string;
  fields: string;
  rule: string;
  schema: string;
  fixtures: Record<string, Record<string, unknown>[]>;
  endpoints: Endpoint[];
  tests: SmokeCase[];
  queries: { name: string; description: string; expected: unknown[] }[];
  bug: string;
  correct: string;
  unitTests: { name: string; input: unknown[]; expected: unknown }[];
};

export function makeScenarios(n: number, city: string): Scenario[] {
  const capacity = 8 + n % 9;
  const stock = 20 + n % 40;
  const price = 1250 + (n % 12) * 100;
  return [
    {
      id: 'booking', title: 'Workspace booking', client: `${city} Workspace`, entity: 'booking', collection: 'bookings',
      summary: 'A coworking team needs a reliable way to book rooms without double-booking. Replace its spreadsheet with a small, dependable reservation system.',
      fields: 'room_id (existing integer), starts_at and ends_at (ISO 8601 UTC strings), organiser (trimmed, 2–80 characters)',
      rule: 'For the same room, half-open intervals [start, end) must not overlap: start < existingEnd AND end > existingStart. Adjacent bookings are allowed. Reject start >= end. Use UTC; display local times as Europe/Zurich.',
      schema: 'CREATE TABLE rooms (id INTEGER PRIMARY KEY, name TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity>0));\nCREATE TABLE bookings (id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, organiser TEXT NOT NULL CHECK(length(trim(organiser)) BETWEEN 2 AND 80), CHECK(starts_at < ends_at));\nCREATE INDEX booking_room_time ON bookings(room_id, starts_at, ends_at);',
      fixtures: {
        rooms: [{ id: 1, name: 'Aare', capacity }, { id: 2, name: 'Alpen', capacity: 4 }, { id: 3, name: 'Jura', capacity: 6 }],
        bookings: [{ id: 1, room_id: 1, starts_at: '2027-02-08T10:00:00Z', ends_at: '2027-02-08T11:00:00Z', organiser: 'Mara Keller' }],
      },
      endpoints: [
        { method: 'GET', path: '/api/rooms', description: 'Return all rooms ordered by id.', response: [{ id: 1, name: 'Aare', capacity }], status: 200 },
        { method: 'GET', path: '/api/bookings', description: 'Return all bookings as a JSON array, ordered by id.', response: [{ id: 1, room_id: 1, starts_at: '2027-02-08T10:00:00Z', ends_at: '2027-02-08T11:00:00Z', organiser: 'Mara Keller' }], status: 200 },
        { method: 'POST', path: '/api/bookings', description: 'Create a booking. Validate fields (400), missing room (404), overlap (409); success returns persisted record.', request: { room_id: 1, starts_at: '2027-02-08T11:00:00Z', ends_at: '2027-02-08T12:00:00Z', organiser: 'Nina Meier' }, response: { id: 2, room_id: 1, starts_at: '2027-02-08T11:00:00Z', ends_at: '2027-02-08T12:00:00Z', organiser: 'Nina Meier' }, status: 201 },
        { method: 'DELETE', path: '/api/bookings/:id', description: 'Delete an existing booking (204, no body); missing record is 404.', response: null, status: 204 },
      ],
      tests: [
        { name: 'Seeded rooms are available', method: 'GET', path: '/api/rooms', status: 200, length: 3 },
        { name: 'Seeded booking is available', method: 'GET', path: '/api/bookings', status: 200, length: 1 },
        { name: 'Overlapping booking is rejected', method: 'POST', path: '/api/bookings', body: { room_id: 1, starts_at: '2027-02-08T10:30:00Z', ends_at: '2027-02-08T11:30:00Z', organiser: 'Nina Meier' }, status: 409 },
        { name: 'Reversed interval is invalid', method: 'POST', path: '/api/bookings', body: { room_id: 1, starts_at: '2027-02-08T12:00:00Z', ends_at: '2027-02-08T11:00:00Z', organiser: 'Nina Meier' }, status: 400 },
        { name: 'Missing room is not created', method: 'POST', path: '/api/bookings', body: { room_id: 9999, starts_at: '2027-02-08T11:00:00Z', ends_at: '2027-02-08T12:00:00Z', organiser: 'Nina Meier' }, status: 404 },
        { name: 'Boundary-touching booking is allowed', method: 'POST', path: '/api/bookings', body: { room_id: 1, starts_at: '2027-02-08T11:00:00Z', ends_at: '2027-02-08T12:00:00Z', organiser: 'Nina Meier' }, status: 201, equals: { room_id: 1, organiser: 'Nina Meier' } },
        { name: 'Created booking is visible', method: 'GET', path: '/api/bookings', status: 200, length: 2 },
        { name: 'Unknown deletion returns 404', method: 'DELETE', path: '/api/bookings/9999', status: 404 },
      ],
      queries: [
        { name: 'room-occupancy', description: 'Return every room with booking_count, including unused rooms. Columns: id, name, booking_count. Order by id.', expected: [{ id: 1, name: 'Aare', booking_count: 1 }, { id: 2, name: 'Alpen', booking_count: 0 }, { id: 3, name: 'Jura', booking_count: 0 }] },
        { name: 'booked-minutes', description: 'Return total booked minutes per room, including zero. Columns: id, booked_minutes (integer). Order by id. Seeded timestamps are UTC.', expected: [{ id: 1, booked_minutes: 60 }, { id: 2, booked_minutes: 0 }, { id: 3, booked_minutes: 0 }] },
      ],
      bug: 'export function evaluate(start, end, existingStart, existingEnd) {\n  return start <= existingEnd && end >= existingStart;\n}',
      correct: 'export function evaluate(start, end, existingStart, existingEnd) {\n  return start < existingEnd && end > existingStart;\n}',
      unitTests: [
        { name: 'Overlap in the middle', input: [15, 25, 10, 20], expected: true },
        { name: 'Adjacent after is free', input: [20, 30, 10, 20], expected: false },
        { name: 'Adjacent before is free', input: [0, 10, 10, 20], expected: false },
        { name: 'Contained interval overlaps', input: [12, 18, 10, 20], expected: true },
        { name: 'Separate interval is free', input: [30, 40, 10, 20], expected: false },
      ],
    },
    {
      id: 'inventory', title: 'Workshop stock control', client: `${city} Velowerk`, entity: 'movement', collection: 'movements',
      summary: 'A bicycle workshop keeps selling parts that are no longer in stock. Build a stock ledger that makes every movement traceable and prevents negative quantities.',
      fields: 'product_id (existing integer), delta (nonzero integer), reason (trimmed, 2–80 characters)',
      rule: 'A movement atomically changes stock and appends a ledger record. Stock must stay >= 0. Quantities are integers. Store prices as integer CHF cents. Initial product stock is an opening balance; seeded movements are empty.',
      schema: 'CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, stock INTEGER NOT NULL CHECK(stock>=0), price_cents INTEGER NOT NULL CHECK(price_cents>=0));\nCREATE TABLE movements (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), delta INTEGER NOT NULL CHECK(delta<>0), reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 2 AND 80));\nCREATE INDEX movement_product ON movements(product_id);',
      fixtures: {
        products: [{ id: 1, name: 'Brake pads', stock, price_cents: price }, { id: 2, name: 'Inner tube', stock: 0, price_cents: 800 }, { id: 3, name: 'Chain', stock: 5, price_cents: 2500 }], movements: [],
      },
      endpoints: [
        { method: 'GET', path: '/api/products', description: 'Return all products ordered by id.', response: [{ id: 1, name: 'Brake pads', stock, price_cents: price }], status: 200 },
        { method: 'GET', path: '/api/movements', description: 'Return the movement ledger as a JSON array ordered by id.', response: [], status: 200 },
        { method: 'POST', path: '/api/movements', description: 'Atomically insert movement and update stock. Invalid data 400, missing product 404, insufficient stock 409.', request: { product_id: 1, delta: -2, reason: 'Repair order' }, response: { id: 1, product_id: 1, delta: -2, reason: 'Repair order' }, status: 201 },
      ],
      tests: [
        { name: 'Opening stock is seeded', method: 'GET', path: '/api/products', status: 200, length: 3 },
        { name: 'Opening ledger is empty', method: 'GET', path: '/api/movements', status: 200, length: 0 },
        { name: 'Cannot oversell stock', method: 'POST', path: '/api/movements', body: { product_id: 1, delta: -stock - 1, reason: 'Large sale' }, status: 409 },
        { name: 'Fractional stock is rejected', method: 'POST', path: '/api/movements', body: { product_id: 1, delta: -0.5, reason: 'Invalid sale' }, status: 400 },
        { name: 'Missing product is rejected', method: 'POST', path: '/api/movements', body: { product_id: 9999, delta: 1, reason: 'Delivery' }, status: 404 },
        { name: 'Valid stock movement is recorded', method: 'POST', path: '/api/movements', body: { product_id: 1, delta: -2, reason: 'Repair order' }, status: 201, equals: { product_id: 1, delta: -2 } },
        { name: 'Rejected operations left no ledger entries', method: 'GET', path: '/api/movements', status: 200, length: 1 },
      ],
      queries: [
        { name: 'stock-value', description: 'Return each product with its value_cents = stock * price_cents. Columns: id, value_cents. Order by id.', expected: [{ id: 1, value_cents: stock * price }, { id: 2, value_cents: 0 }, { id: 3, value_cents: 12500 }] },
        { name: 'low-stock', description: 'Return products with stock <= 5, sorted by stock then id. Columns: id, name, stock.', expected: [{ id: 2, name: 'Inner tube', stock: 0 }, { id: 3, name: 'Chain', stock: 5 }] },
      ],
      bug: 'export function evaluate(stock, delta) {\n  if (stock + delta <= 0) return false;\n  return true;\n}',
      correct: 'export function evaluate(stock, delta) {\n  return Number.isInteger(stock) && stock >= 0 && Number.isInteger(delta) && delta !== 0 && stock + delta >= 0;\n}',
      unitTests: [
        { name: 'A normal sale is valid', input: [stock, -2], expected: true },
        { name: 'Selling final unit is valid', input: [1, -1], expected: true },
        { name: 'Overselling is invalid', input: [2, -3], expected: false },
        { name: 'Fractional movement is invalid', input: [3, 0.5], expected: false },
        { name: 'Zero movement is invalid', input: [3, 0], expected: false },
        { name: 'Receiving into empty stock is valid', input: [0, 2], expected: true },
      ],
    },
    {
      id: 'tickets', title: 'Repair desk workflow', client: `${city} Repair Collective`, entity: 'ticket', collection: 'tickets',
      summary: 'A community repair desk loses track of jobs between intake and collection. Give volunteers a clear queue and enforce a predictable ticket lifecycle.',
      fields: 'title (trimmed, 2–80 characters), priority (integer 1–3). A new ticket starts in open status.',
      rule: 'Only open → in_progress → resolved transitions are allowed. A resolved ticket is final. Reject invalid transitions with 409, unknown status values with 400. Lists are ordered by id; UI can offer a separate priority sort.',
      schema: "CREATE TABLE tickets (id INTEGER PRIMARY KEY, title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 80), priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 3), status TEXT NOT NULL CHECK(status IN ('open','in_progress','resolved')));\nCREATE INDEX ticket_status ON tickets(status, priority);",
      fixtures: { tickets: [{ id: 1, title: 'Coffee machine leaking', priority: 1, status: 'open' }, { id: 2, title: 'Lamp switch broken', priority: 3, status: 'in_progress' }, { id: 3, title: 'Radio restored', priority: 2, status: 'resolved' }] },
      endpoints: [
        { method: 'GET', path: '/api/tickets', description: 'Return tickets as a JSON array ordered by id.', response: [{ id: 1, title: 'Coffee machine leaking', priority: 1, status: 'open' }], status: 200 },
        { method: 'POST', path: '/api/tickets', description: 'Create a ticket with status open. Invalid fields return 400.', request: { title: 'Toaster not heating', priority: 2 }, response: { id: 4, title: 'Toaster not heating', priority: 2, status: 'open' }, status: 201 },
        { method: 'PATCH', path: '/api/tickets/:id', description: 'Transition status; missing ticket 404, invalid transition 409, invalid status 400.', request: { status: 'in_progress' }, response: { id: 1, title: 'Coffee machine leaking', priority: 1, status: 'in_progress' }, status: 200 },
      ],
      tests: [
        { name: 'Queue is seeded', method: 'GET', path: '/api/tickets', status: 200, length: 3 },
        { name: 'Ticket cannot skip a stage', method: 'PATCH', path: '/api/tickets/1', body: { status: 'resolved' }, status: 409 },
        { name: 'Resolved ticket is final', method: 'PATCH', path: '/api/tickets/3', body: { status: 'open' }, status: 409 },
        { name: 'Unknown status is invalid', method: 'PATCH', path: '/api/tickets/1', body: { status: 'lost' }, status: 400 },
        { name: 'Missing ticket is rejected', method: 'PATCH', path: '/api/tickets/9999', body: { status: 'in_progress' }, status: 404 },
        { name: 'Valid transition is saved', method: 'PATCH', path: '/api/tickets/1', body: { status: 'in_progress' }, status: 200, equals: { id: 1, status: 'in_progress' } },
        { name: 'Blank title is invalid', method: 'POST', path: '/api/tickets', body: { title: ' ', priority: 1 }, status: 400 },
        { name: 'New ticket starts open', method: 'POST', path: '/api/tickets', body: { title: 'Toaster not heating', priority: 2 }, status: 201, equals: { status: 'open' } },
      ],
      queries: [
        { name: 'active-queue', description: 'Return unresolved tickets sorted by priority ascending then id. Columns: id, title, status.', expected: [{ id: 1, title: 'Coffee machine leaking', status: 'open' }, { id: 2, title: 'Lamp switch broken', status: 'in_progress' }] },
        { name: 'status-counts', description: 'Return each existing status and ticket_count, sorted alphabetically by status.', expected: [{ status: 'in_progress', ticket_count: 1 }, { status: 'open', ticket_count: 1 }, { status: 'resolved', ticket_count: 1 }] },
      ],
      bug: "export function evaluate(from, to) {\n  return from !== to && ['open', 'in_progress', 'resolved'].includes(to);\n}",
      correct: "export function evaluate(from, to) {\n  return (from === 'open' && to === 'in_progress') || (from === 'in_progress' && to === 'resolved');\n}",
      unitTests: [
        { name: 'Start a ticket', input: ['open', 'in_progress'], expected: true },
        { name: 'Resolve work in progress', input: ['in_progress', 'resolved'], expected: true },
        { name: 'Cannot skip work', input: ['open', 'resolved'], expected: false },
        { name: 'Cannot reopen resolved work', input: ['resolved', 'open'], expected: false },
        { name: 'Same status is not a transition', input: ['open', 'open'], expected: false },
        { name: 'Unknown origin is invalid', input: ['lost', 'open'], expected: false },
      ],
    },
    {
      id: 'events', title: 'Workshop registrations', client: `${city} Makerspace`, entity: 'registration', collection: 'registrations',
      summary: 'A makerspace runs small workshops with limited seats. Build a registration desk that prevents duplicate sign-ups and never overbooks a workshop.',
      fields: 'event_id (existing integer), email (trimmed valid address, max 120 characters; normalise to lowercase)',
      rule: 'Each event/email pair is unique regardless of email case. Count registrations and insert atomically; never exceed event capacity. Cancellation releases a seat. Reject duplicates and full events with 409.',
      schema: 'CREATE TABLE events (id INTEGER PRIMARY KEY, title TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity>0));\nCREATE TABLE registrations (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), email TEXT NOT NULL COLLATE NOCASE CHECK(length(email) BETWEEN 3 AND 120), UNIQUE(event_id, email));\nCREATE INDEX registration_event ON registrations(event_id);',
      fixtures: { events: [{ id: 1, title: 'Intro to soldering', capacity: 1 }, { id: 2, title: '3D printing basics', capacity }, { id: 3, title: 'Laser cutting', capacity: 4 }], registrations: [{ id: 1, event_id: 1, email: 'mara@example.test' }] },
      endpoints: [
        { method: 'GET', path: '/api/events', description: 'Return workshops as a JSON array ordered by id.', response: [{ id: 1, title: 'Intro to soldering', capacity: 1 }], status: 200 },
        { method: 'GET', path: '/api/registrations', description: 'Return registrations as a JSON array ordered by id.', response: [{ id: 1, event_id: 1, email: 'mara@example.test' }], status: 200 },
        { method: 'POST', path: '/api/registrations', description: 'Create a registration. Invalid email/id 400, missing event 404, full/duplicate 409.', request: { event_id: 2, email: 'nina@example.test' }, response: { id: 2, event_id: 2, email: 'nina@example.test' }, status: 201 },
        { method: 'DELETE', path: '/api/registrations/:id', description: 'Cancel existing registration: 204, no body. Unknown id: 404.', response: null, status: 204 },
      ],
      tests: [
        { name: 'Workshops are seeded', method: 'GET', path: '/api/events', status: 200, length: 3 },
        { name: 'Registration is seeded', method: 'GET', path: '/api/registrations', status: 200, length: 1 },
        { name: 'Full event rejects registration', method: 'POST', path: '/api/registrations', body: { event_id: 1, email: 'nina@example.test' }, status: 409 },
        { name: 'Invalid email is rejected', method: 'POST', path: '/api/registrations', body: { event_id: 2, email: 'not-an-email' }, status: 400 },
        { name: 'Unknown event is rejected', method: 'POST', path: '/api/registrations', body: { event_id: 9999, email: 'nina@example.test' }, status: 404 },
        { name: 'Valid registration is normalised', method: 'POST', path: '/api/registrations', body: { event_id: 2, email: 'Nina@Example.test' }, status: 201, equals: { event_id: 2, email: 'nina@example.test' } },
        { name: 'Case-insensitive duplicate is rejected', method: 'POST', path: '/api/registrations', body: { event_id: 2, email: 'NINA@EXAMPLE.TEST' }, status: 409 },
        { name: 'Cancellation releases seeded seat', method: 'DELETE', path: '/api/registrations/1', status: 204 },
        { name: 'Released seat can be booked', method: 'POST', path: '/api/registrations', body: { event_id: 1, email: 'luca@example.test' }, status: 201, equals: { event_id: 1 } },
      ],
      queries: [
        { name: 'available-seats', description: 'Return every event and remaining_seats (capacity minus registrations). Columns: id, remaining_seats. Order by id.', expected: [{ id: 1, remaining_seats: 0 }, { id: 2, remaining_seats: capacity }, { id: 3, remaining_seats: 4 }] },
        { name: 'empty-events', description: 'Return events without registrations. Columns: id, title. Order by id.', expected: [{ id: 2, title: '3D printing basics' }, { id: 3, title: 'Laser cutting' }] },
      ],
      bug: 'export function evaluate(capacity, count, emails, email) {\n  return count <= capacity && !emails.includes(email);\n}',
      correct: 'export function evaluate(capacity, count, emails, email) {\n  const normalised = email.trim().toLowerCase();\n  return Number.isInteger(capacity) && Number.isInteger(count) && count >= 0 && count < capacity && !emails.some(item => item.trim().toLowerCase() === normalised);\n}',
      unitTests: [
        { name: 'A free seat can be booked', input: [capacity, 0, [], 'nina@example.test'], expected: true },
        { name: 'A full event cannot be booked', input: [1, 1, ['mara@example.test'], 'nina@example.test'], expected: false },
        { name: 'Duplicate ignores email case', input: [capacity, 1, ['mara@example.test'], 'MARA@EXAMPLE.TEST'], expected: false },
        { name: 'Duplicate ignores whitespace', input: [capacity, 1, ['mara@example.test'], ' mara@example.test '], expected: false },
        { name: 'Last seat is available', input: [capacity, capacity - 1, [], 'nina@example.test'], expected: true },
      ],
    },
  ];
}
