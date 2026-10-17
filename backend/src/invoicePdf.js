// A one-page invoice PDF. Helvetica covers the Latin names in this app, so the
// document does not need a PDF library.

function pdfText(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .replace(/[^\x20-\x7E]/g, '?')
    .slice(0, 110)
}

function moneyLabel(cents, currency) {
  const amount = (Number(cents) || 0) / 100
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}`.trim()
}

function day(value) {
  if (!value) return ''
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const date = String(value.getDate()).padStart(2, '0')
    return `${value.getFullYear()}-${month}-${date}`
  }
  return String(value).slice(0, 10)
}

export function renderInvoicePdf(invoice) {
  const commands = []
  let y = 790
  const line = (font, size, text, x = 48, gap = 16) => {
    commands.push(`BT /${font} ${size} Tf ${x} ${y} Td (${pdfText(text)}) Tj ET`)
    y -= gap
  }

  line('F2', 11, invoice.issuer_name || invoice.tenant_name || 'Invoice', 48, 16)
  if (invoice.issuer_address) line('F1', 10, invoice.issuer_address, 48, 13)
  const issuerPlace = [invoice.issuer_city, invoice.issuer_country].filter(Boolean).join(', ')
  if (issuerPlace) line('F1', 10, issuerPlace, 48, 13)
  if (invoice.issuer_vat) line('F1', 10, `VAT ${invoice.issuer_vat}`, 48, 13)
  if (invoice.issuer_email) line('F1', 10, invoice.issuer_email, 48, 13)
  if (invoice.issuer_phone) line('F1', 10, invoice.issuer_phone, 48, 13)
  if (invoice.issuer_bank) line('F1', 10, invoice.issuer_bank, 48, 13)
  if (invoice.issuer_iban) line('F1', 10, invoice.issuer_iban, 48, 13)
  if (invoice.issuer_swift) line('F1', 10, invoice.issuer_swift, 48, 13)
  y -= 12
  line('F2', 22, invoice.number || 'Invoice', 48, 22)
  line('F1', 11, `Status  ${invoice.status || ''}`)
  if (invoice.issued_at) line('F1', 11, `Issued  ${day(invoice.issued_at)}`)
  if (invoice.due_at) line('F1', 11, `Due  ${day(invoice.due_at)}`)
  if (invoice.paid_at) line('F1', 11, `Paid  ${day(invoice.paid_at)}`)

  y -= 10
  line('F2', 11, 'Bill to', 48, 18)
  line('F1', 12, invoice.company_name || '')
  const place = [invoice.company_city, invoice.company_country].filter(Boolean).join(', ')
  if (place) line('F1', 11, place)
  if (invoice.company_vat) line('F1', 11, `VAT ${invoice.company_vat}`)

  y -= 10
  line('F2', 11, 'Shipment', 48, 18)
  if (invoice.reference) line('F1', 11, invoice.reference)
  const lane = [invoice.origin, invoice.destination].filter(Boolean).join(' -> ')
  if (lane) line('F1', 11, lane)
  if (invoice.cargo) line('F1', 11, invoice.cargo)

  y -= 16
  line('F2', 16, moneyLabel(invoice.amount_cents, invoice.currency), 48, 20)

  if (invoice.issuer_footer) {
    let foot = 64
    for (const part of String(invoice.issuer_footer).split(/\n+/)) {
      if (!part.trim() || foot < 36) continue
      commands.push(`BT /F1 9 Tf 48 ${foot} Td (${pdfText(part)}) Tj ET`)
      foot -= 12
    }
  }

  const stream = commands.join('\n')
  return buildPdf(stream)
}

function buildPdf(stream) {
  // Object numbers are fixed: 1 Helvetica, 2 Helvetica-Bold, 3 content, 4 page, 5 pages, 6 catalog.
  const objects = [
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Page /Parent 5 0 R /MediaBox [0 0 595 842] /Contents 3 0 R /Resources << /Font << /F1 1 0 R /F2 2 0 R >> >> >>',
    '<< /Type /Pages /Count 1 /Kids [4 0 R] >>',
    '<< /Type /Catalog /Pages 5 0 R >>',
  ]

  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n`
  body += '0000000000 65535 f \n'
  for (let i = 1; i < offsets.length; i += 1) body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  body += `trailer << /Size ${objects.length + 1} /Root 6 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(body)
}
