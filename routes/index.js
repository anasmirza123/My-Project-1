/* ============================================================
   ROUTE MOUNTING — All API routes registered here
   ============================================================ */
const express = require('express');
const router = express.Router();

// Debug: list all registered routes
router.get('/debug/routes', (req, res) => {
  const routes = [];
  router.stack.forEach(layer => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
      routes.push({ path: '/api' + layer.route.path, methods });
    }
  });
  res.json({ count: routes.length, routes });
});

router.use('/', require('./health'));
router.use('/', require('./dashboard'));
router.use('/', require('./customers'));
router.use('/', require('./categories'));
router.use('/', require('./orders'));
router.use('/', require('./payments'));
router.use('/', require('./followups'));
router.use('/', require('./hardware'));
router.use('/', require('./messages'));
router.use('/', require('./expenses'));
router.use('/', require('./reports'));
router.use('/', require('./backup'));
router.use('/', require('./settings'));

module.exports = router;
