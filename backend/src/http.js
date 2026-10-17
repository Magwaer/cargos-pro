export function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

export function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

export function changes(body, spec) {
  const values = []
  const sets = []
  for (const [column, coerce] of Object.entries(spec)) {
    if (body[column] === undefined) continue
    values.push(coerce ? coerce(body[column]) : body[column])
    sets.push(`${column} = $${values.length}`)
  }
  return { values, sets }
}
