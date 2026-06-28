// controllers/invoiceController.js
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { renderInvoicePdfById } = require('../services/invoiceService');

function comparableId(value) {
  if (!value) return null;
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (value._id) return comparableId(value._id);
  return String(value);
}

function canAccessOrderInvoice(user, order) {
  if (!user || !order) return false;
  if (user.role === 'admin') return true;

  const userId = comparableId(user._id || user.id);
  if (!userId) return false;

  return [order.userId, order.vendorId].some((ownerId) => comparableId(ownerId) === userId);
}

async function getInvoicePdf(req, res) {
  try {
    const { id } = req.params;
    const { download } = req.query;

    if (!id || !mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid order id' });
    }

    const order = await Order.findById(id).select('userId vendorId').lean();

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (!canAccessOrderInvoice(req.user, order)) {
      return res.status(403).json({ error: 'Not authorized to access this invoice' });
    }

    const pdf = await renderInvoicePdfById(id);
    const filename = `invoice-${id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      download === '1' || download === 'true'
        ? `attachment; filename="${filename}"`
        : `inline; filename="${filename}"`
    );
    return res.send(pdf);
  } catch (err) {
    const code = err.status || 500;
    console.error('getInvoicePdf error:', err);
    return res.status(code).json({ error: err.message || 'Failed to generate invoice' });
  }
}

module.exports = { getInvoicePdf, canAccessOrderInvoice };
