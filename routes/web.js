const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/PaymentController');

// Создать платёж и редирект на Paytrail
router.get('/create', ctrl.createAndRedirect);

// Результат после возврата (success/cancel)
router.get('/', ctrl.renderResult);

// Callback от Paytrail (POST)
router.post('/', ctrl.handleCallback);

module.exports = router;
