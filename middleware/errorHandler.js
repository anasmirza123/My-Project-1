/* ============================================================
   CENTRALIZED ERROR HANDLER
   ============================================================ */
function notFoundHandler(req, res, next) {
  // Only handles /api/* paths; non-API falls through to SPA
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: 'API endpoint not found',
      method: req.method,
      path: req.path
    });
  }
  next();
}

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error('[ERROR]', req.method, req.path, '-', err.message);
    if (err.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
  }
  if (res.headersSent) return next(err);
  res.status(status).json({
    error: err.message || 'Internal server error'
  });
}

module.exports = { notFoundHandler, errorHandler };
