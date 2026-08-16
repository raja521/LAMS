/** Wrap an async route so a rejected promise reaches the error middleware. */
export default function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
