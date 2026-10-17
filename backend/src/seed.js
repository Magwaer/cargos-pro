import bcrypt from 'bcryptjs'
import { pool } from './db.js'
import { computeRoute } from './routing.js'
import { storeBufferDocument } from './uploads.js'

async function routeFor(origin, destination) {
  return (await computeRoute(origin, destination)) || { distanceKm: null, durationMin: null, source: null }
}

export async function seedIfEmpty() {
  if (process.env.SEED_DEMO !== 'true') return
  const existing = await pool.query('SELECT count(*)::int AS n FROM tenants')
  if (existing.rows[0].n > 0) return

  const password = await bcrypt.hash('demo1234', 10)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const tenant = (await client.query(
      `INSERT INTO tenants (name, slug, plan, seat_limit, driver_limit, default_currency)
       VALUES ('Northlane Logistics', 'northlane', 'active', 8, 10, 'EUR') RETURNING id`,
    )).rows[0]

    const tid = tenant.id
    async function user(email, name, role) {
      const { rows } = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, name, role)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tid, email, password, name, role],
      )
      return rows[0].id
    }

    const anna = await user('anna@northlane.example', 'Anna Kowalska', 'owner')
    const marek = await user('marek@northlane.example', 'Marek Nowak', 'dispatcher')
    await user('ioana@northlane.example', 'Ioana Popescu', 'sales')
    const elena = await user('elena@northlane.example', 'Elena Ionescu', 'finance')
    const piotr = await user('piotr@northlane.example', 'Piotr Zieliński', 'driver')

    async function company(row) {
      const { rows } = await client.query(
        `INSERT INTO companies (
           tenant_id, name, role, email, phone, vat, vat_eu, city, country, payment_terms_days,
           rating, insurance_expires, warning, blacklisted, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [tid, row.name, row.role, row.email, row.phone, row.vat, row.vatEu === undefined ? row.vat : row.vatEu, row.city, row.country, row.terms,
          row.rating ?? null, row.insurance ?? null, row.warning || false, row.blacklisted || false, row.notes || null],
      )
      return rows[0].id
    }

    const baltic = await company({ name: 'Baltic Grain Sp. z o.o.', role: 'customer', email: 'ap@balticgrain.example', phone: '+48221234567', vat: 'PL5213456789', city: 'Warsaw', country: 'PL', terms: 21, notes: 'Prefers morning pickups at the silo gate.' })
    const danube = await company({ name: 'Danube Retail SRL', role: 'customer', email: 'logistics@danuberetail.example', phone: '+40213456789', vat: 'RO12345678', city: 'Bucharest', country: 'RO', terms: 30 })
    const fresh = await company({ name: 'Moldovan Fresh', role: 'customer', email: 'office@moldovanfresh.example', phone: '+37322111222', vat: 'MD445566', vatEu: null, city: 'Chisinau', country: 'MD', terms: 14 })
    const rhine = await company({ name: 'Rhine Chemicals GmbH', role: 'customer', email: 'traffic@rhinechemicals.example', phone: '+49203333444', vat: 'DE811222333', city: 'Duisburg', country: 'DE', terms: 30, notes: 'ADR loads only with a certified driver.' })
    const karpaty = await company({ name: 'TransKarpaty', role: 'carrier', email: 'dispatch@transkarpaty.example', phone: '+48123400999', vat: 'PL9988776655', city: 'Rzeszow', country: 'PL', terms: 21, rating: 4.6, insurance: '2027-03-01' })
    const sudest = await company({ name: 'SudEst Haulage', role: 'carrier', email: 'ops@sudest.example', phone: '+40722111000', vat: 'RO33445566', city: 'Constanta', country: 'RO', terms: 14, rating: 4.2, insurance: '2026-11-15' })
    const eastbroker = await company({ name: 'EastBridge Freight', role: 'broker', email: 'desk@eastbridge.example', phone: '+48229990011', vat: 'PL1122334455', city: 'Warsaw', country: 'PL', terms: 14, notes: 'Spot loads from CEE shippers.' })
    await company({ name: 'Blacklist Cargo', role: 'carrier', email: 'desk@blacklistcargo.example', phone: '+490000000', vat: 'DE000', city: 'Cologne', country: 'DE', terms: 7, rating: 2.1, warning: true, blacklisted: true, notes: 'Missed two loadings in June. Do not subcontract.' })

    async function contact(companyId, name, email, phone, title, extra = {}) {
      const { rows } = await client.query(
        `INSERT INTO contacts (tenant_id, company_id, name, email, phone, mobile, fax, title) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [tid, companyId, name, email, phone, extra.mobile || null, extra.fax || null, title],
      )
      return rows[0].id
    }
    const jan = await contact(baltic, 'Jan Mazur', 'jan.mazur@balticgrain.example', '+48221234001', 'Logistics buyer', { mobile: '+48600111222', fax: '+48221234009' })
    await contact(danube, 'Andreea Stan', 'andreea.stan@danuberetail.example', '+40213456780', 'Transport manager', { mobile: '+40722123456' })
    await contact(fresh, 'Victor Rusu', 'victor.rusu@moldovanfresh.example', '+37322111220', 'Owner', { mobile: '+37369111222' })
    await contact(rhine, 'Klara Vogel', 'klara.vogel@rhinechemicals.example', '+49203333440', 'Traffic desk', { mobile: '+491511234567', fax: '+49203333449' })
    await contact(karpaty, 'Tomasz Wójcik', 'tomasz@transkarpaty.example', '+48123400990', 'Dispatcher', { mobile: '+48600222333' })
    await contact(sudest, 'Mihai Iacob', 'mihai@sudest.example', '+40241111000', 'Fleet owner', { mobile: '+40733000111' })
    const magda = await contact(eastbroker, 'Magda Lis', 'magda@eastbridge.example', '+48229990010', 'Broker', { mobile: '+48600999888' })

    async function vehicle(plate, kind, capacity, status, location, cost, insurance, inspection) {
      const { rows } = await client.query(
        `INSERT INTO vehicles (tenant_id, plate, kind, capacity_kg, status, location, cost_per_km_cents, insurance_expires, inspection_expires)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tid, plate, kind, capacity, status, location, cost, insurance, inspection],
      )
      return rows[0].id
    }

    const soon = new Date(Date.now() + 18 * 86400000).toISOString().slice(0, 10)
    const volvo = await vehicle('WGM 12345', 'tractor', 24000, 'on_trip', 'Poznan, PL', 95, '2027-01-20', '2027-06-01')
    const scania = await vehicle('B 456 TMS', 'tractor', 24000, 'available', 'Bucharest, RO', 88, '2026-12-01', soon)
    await vehicle('KR 9081', 'rigid', 12000, 'maintenance', 'Krakow workshop', 110, '2026-10-02', '2026-09-28')

    const piotrDriver = (await client.query(
      `INSERT INTO drivers (tenant_id, user_id, vehicle_id, name, phone, license_no, adr, license_expires)
       VALUES ($1,$2,$3,'Piotr Zieliński','+48600777888','PL-99281', false, '2028-04-12') RETURNING id`,
      [tid, piotr, volvo],
    )).rows[0].id
    await client.query(
      `INSERT INTO drivers (tenant_id, name, phone, license_no, adr, license_expires, vehicle_id)
       VALUES ($1,'Andrei Popa','+40722100999','RO-44120', true, '2027-08-01', $2)`,
      [tid, scania],
    )

    async function order(row) {
      const leg = await routeFor(row.origin, row.destination)
      const { rows } = await client.query(
        `INSERT INTO orders (
           tenant_id, company_id, owner_id, reference, status, origin, destination, cargo,
           weight_kg, load_type, price_cents, currency, pickup_at, delivery_at, delivered_at,
           distance_km, duration_min, distance_source, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [tid, row.company, row.owner || marek, row.reference, row.status, row.origin, row.destination,
          row.cargo, row.weight, row.load || 'FTL', row.price, row.currency || 'EUR', row.pickup, row.delivery,
          row.delivered || null, leg.distanceKm, leg.durationMin, leg.source, row.notes || null],
      )
      if (row.company) {
        await client.query(
          `INSERT INTO order_parties (tenant_id, order_id, role, company_id, contact_id)
           VALUES ($1,$2,'customer',$3,$4) ON CONFLICT DO NOTHING`,
          [tid, rows[0].id, row.company, row.contact || null],
        )
      }
      if (row.broker) {
        await client.query(
          `INSERT INTO order_parties (tenant_id, order_id, role, company_id, contact_id)
           VALUES ($1,$2,'broker',$3,$4) ON CONFLICT DO NOTHING`,
          [tid, rows[0].id, row.broker, row.brokerContact || null],
        )
      }
      if (row.carrier) {
        await client.query(
          `INSERT INTO order_parties (tenant_id, order_id, role, company_id)
           VALUES ($1,$2,'carrier',$3) ON CONFLICT DO NOTHING`,
          [tid, rows[0].id, row.carrier],
        )
      }
      if (row.origin) {
        await client.query(
          `INSERT INTO addresses (tenant_id, company_id, label) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [tid, row.company, row.origin],
        )
      }
      if (row.destination) {
        await client.query(
          `INSERT INTO addresses (tenant_id, company_id, label) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [tid, row.company, row.destination],
        )
      }
      return rows[0]
    }

    const day = 86400000
    const now = Date.now()
    const berlin = await order({
      company: baltic, contact: jan, broker: eastbroker, brokerContact: magda, owner: marek, reference: 'NL-24021', status: 'in_transit', origin: 'Warsaw, PL', destination: 'Berlin, DE',
      cargo: 'Milling wheat, 24t', weight: 24000, price: 186000, pickup: new Date(now - day).toISOString(), delivery: new Date(now + day).toISOString(),
    })
    const milan = await order({
      company: danube, carrier: sudest, owner: marek, reference: 'NL-24022', status: 'assigned', origin: 'Bucharest, RO', destination: 'Milan, IT',
      cargo: 'Retail mixed pallets', weight: 18000, price: 245000, pickup: new Date(now + day).toISOString(), delivery: new Date(now + 3 * day).toISOString(),
    })
    await order({
      company: rhine, owner: marek, reference: 'NL-24023', status: 'booked', origin: 'Gdansk, PL', destination: 'Rotterdam, NL',
      cargo: 'Packaged chemicals, non-ADR', weight: 14000, load: 'LTL', price: 210000, pickup: new Date(now + 2 * day).toISOString(), delivery: new Date(now + 4 * day).toISOString(),
      notes: 'Waiting on a truck. Customer asked for a morning slot in Rotterdam.',
    })
    const freshOrder = await order({
      company: fresh, owner: marek, reference: 'NL-24024', status: 'invoiced', origin: 'Chisinau, MD', destination: 'Warsaw, PL',
      cargo: 'Apples, temperature +4°C', weight: 20000, price: 168000, pickup: new Date(now - 6 * day).toISOString(),
      delivery: new Date(now - 4 * day).toISOString(), delivered: new Date(now - 4 * day).toISOString(),
    })
    const prague = await order({
      company: baltic, contact: jan, carrier: karpaty, owner: marek, reference: 'NL-24025', status: 'invoiced', origin: 'Krakow, PL', destination: 'Prague, CZ',
      cargo: 'Bagged feed', weight: 22000, price: 96000, pickup: new Date(now - 40 * day).toISOString(),
      delivery: new Date(now - 39 * day).toISOString(), delivered: new Date(now - 39 * day).toISOString(),
    })

    await client.query(
      `INSERT INTO order_expenses (tenant_id, order_id, company_id, label, amount_cents, occurred_on, payment_type, currency) VALUES
       ($1,$2,NULL,'Fuel',42000,$5,'fuel_card','EUR'),
       ($1,$2,NULL,'Tolls',8500,$5,'card','EUR'),
       ($1,$3,$6,'Carrier hire',171000,$7,'wire','EUR'),
       ($1,$4,$8,'Carrier hire',64000,$9,'wire','EUR')`,
      [tid, berlin.id, milan.id, prague.id, berlin.pickup_at, sudest, milan.pickup_at, karpaty, prague.pickup_at],
    )
    await client.query(
      `INSERT INTO order_expenses (tenant_id, order_id, company_id, label, amount_cents, occurred_on, payment_type, currency)
       VALUES ($1,NULL,NULL,'Office rent',185000,$2,'wire','EUR'),
              ($1,NULL,NULL,'Warehouse parking',24000,$2,'cash','EUR')`,
      [tid, new Date(now - 3 * day).toISOString().slice(0, 10)],
    )

    const berlinCost = Math.round((berlin.distance_km || 580) * 95)
    await client.query(
      `INSERT INTO relations (tenant_id, order_id, kind, vehicle_id, driver_id, cost_cents, currency, status)
       VALUES ($1,$2,'own_fleet',$3,$4,$5,'EUR','in_transit')`,
      [tid, berlin.id, volvo, piotrDriver, berlinCost],
    )
    await client.query(
      `INSERT INTO relations (tenant_id, order_id, kind, carrier_company_id, cost_cents, currency, status)
       VALUES ($1,$2,'subcontracted',$3,$4,'EUR','assigned')`,
      [tid, milan.id, sudest, 171000],
    )
    await client.query(
      `INSERT INTO relations (tenant_id, order_id, kind, vehicle_id, driver_id, cost_cents, currency, status)
       VALUES ($1,$2,'own_fleet',$3,$4,$5,'EUR','delivered')`,
      [tid, freshOrder.id, scania, piotrDriver, Math.round((freshOrder.distance_km || 900) * 88)],
    )
    await client.query(
      `INSERT INTO relations (tenant_id, order_id, kind, carrier_company_id, cost_cents, currency, status)
       VALUES ($1,$2,'subcontracted',$3,64000,'EUR','delivered')`,
      [tid, prague.id, karpaty],
    )

    await client.query(
      `INSERT INTO invoices (tenant_id, company_id, order_id, number, status, amount_cents, currency, issued_at, due_at, paid_at)
       VALUES ($1,$2,$3,'INV-1001','paid',168000,'EUR',$4,$5,$6)`,
      [tid, fresh, freshOrder.id, new Date(now - 3 * day).toISOString().slice(0, 10), new Date(now + 11 * day).toISOString().slice(0, 10), new Date(now - day).toISOString().slice(0, 10)],
    )
    await client.query(
      `INSERT INTO invoices (tenant_id, company_id, order_id, number, status, amount_cents, currency, issued_at, due_at)
       VALUES ($1,$2,$3,'INV-1002','sent',96000,'EUR',$4,$5)`,
      [tid, baltic, prague.id, new Date(now - 35 * day).toISOString().slice(0, 10), new Date(now - 14 * day).toISOString().slice(0, 10)],
    )
    await client.query(
      `INSERT INTO invoices (tenant_id, company_id, number, status, amount_cents, currency, issued_at, due_at)
       VALUES ($1,$2,'INV-1003','draft',245000,'EUR',$3,$4)`,
      [tid, danube, new Date().toISOString().slice(0, 10), new Date(now + 30 * day).toISOString().slice(0, 10)],
    )

    await client.query(
      `INSERT INTO activities (tenant_id, object_type, object_id, kind, title, body, owner_id, created_by)
       VALUES ($1,'order',$2,'note','Gate note','Silo 2, ask for Jan on arrival.',$3,$3)`,
      [tid, berlin.id, marek],
    )
    await client.query(
      `INSERT INTO activities (tenant_id, object_type, object_id, kind, title, due_at, owner_id, created_by)
       VALUES ($1,'order',$2,'task','Confirm Rotterdam time slot', now() + interval '1 day', $3, $4)`,
      [tid, (await client.query(`SELECT id FROM orders WHERE tenant_id = $1 AND reference = 'NL-24023'`, [tid])).rows[0].id, marek, anna],
    )
    await client.query(
      `INSERT INTO activities (tenant_id, object_type, object_id, kind, title, due_at, owner_id, created_by, done)
       VALUES ($1,'company',$2,'task','Send updated rate card', now() + interval '2 days', $3, $3, false)`,
      [tid, danube, anna],
    )

    await client.query(
      `INSERT INTO workflows (tenant_id, name, object_type, trigger_event, trigger_property, trigger_value, actions)
       VALUES
       ($1, 'Delivery creates an invoice draft', 'order', 'property_changed', 'status', 'delivered', $2::jsonb),
       ($1, 'Overdue invoice alerts finance', 'invoice', 'property_changed', 'status', 'overdue', $3::jsonb)`,
      [
        tid,
        JSON.stringify([
          { type: 'create_task', title: 'Review delivery {{reference}} and send the invoice', assignRole: 'finance' },
          { type: 'create_invoice' },
        ]),
        JSON.stringify([
          { type: 'create_task', title: 'Chase overdue invoice {{number}}', assignRole: 'finance' },
          { type: 'email', subject: 'Payment reminder for {{number}}', body: 'Hello,\n\nInvoice {{number}} is overdue. Please arrange payment.\n\nNorthlane Logistics' },
        ]),
      ],
    )

    await client.query(
      `INSERT INTO order_property_defs (tenant_id, name, key, type, options, sort_order)
       VALUES ($1, 'Temperature', 'temperature', 'select', '["Ambient","+4°C","-18°C"]'::jsonb, 0),
              ($1, 'ADR', 'adr', 'radio', '["No","Yes"]'::jsonb, 1)`,
      [tid],
    )

    await client.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, object_type, object_id, detail)
       VALUES ($1,$2,'seed','tenant',$3,'{"source":"demo"}')`,
      [tid, anna, tid],
    )

    await client.query('COMMIT')

    const pod = Buffer.from('Proof of delivery\nOrder NL-24024\nChisinau → Warsaw\nReceived in full.\n')
    await storeBufferDocument({
      tenantId: tid, objectType: 'order', objectId: freshOrder.id, kind: 'pod',
      filename: 'POD-NL-24024.txt', buffer: pod, mime: 'text/plain', userId: piotr,
    })

    console.log('Seeded Northlane Logistics. Sign in as anna@northlane.example / demo1234')
    void elena
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
