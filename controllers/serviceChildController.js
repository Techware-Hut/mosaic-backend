const mongoose = require('mongoose');
const Service = require('../models/Service');
const Business = require('../models/Business');
const deleteCloudinaryFile = require('../utils/deleteCloudinaryFile');
const {
  getMinimumChildServicePrice,
  formatOwnerServiceResponse,
} = require('../lib/service/serviceContract');

const NOT_FOUND_MESSAGE = 'Service not found or unauthorized.';

exports.deleteChildService = async (req, res) => {
  try {
    const { parentServiceId, childServiceId } = req.params;
    const userId = req.user._id;

    if (
      !mongoose.Types.ObjectId.isValid(parentServiceId) ||
      !mongoose.Types.ObjectId.isValid(childServiceId)
    ) {
      return res.status(404).json({ error: NOT_FOUND_MESSAGE });
    }

    const parentService = await Service.findOne({
      _id: parentServiceId,
      ownerId: userId,
    });

    if (!parentService) {
      return res.status(404).json({ error: NOT_FOUND_MESSAGE });
    }

    const childToDelete = parentService.services.id(childServiceId);
    if (!childToDelete) {
      return res.status(404).json({ error: NOT_FOUND_MESSAGE });
    }

    const imagesToCleanup = [
      childToDelete.image,
      ...(Array.isArray(childToDelete.images) ? childToDelete.images : []),
    ].filter(Boolean);

    const remainingServices = parentService.services.filter(
      (service) => String(service._id) !== String(childServiceId)
    );

    if (remainingServices.length > 0) {
      parentService.services = remainingServices;
      parentService.price = getMinimumChildServicePrice(remainingServices, 0);
      parentService.duration = '';
    } else {
      parentService.services = [];
      parentService.price = 0;
      parentService.duration = '';
      parentService.isPublished = false;
    }

    await parentService.save();

    for (const image of imagesToCleanup) {
      await deleteCloudinaryFile(image).catch(() => {});
    }

    const business = await Business.findById(parentService.businessId).select(
      'isActive isApproved owner'
    );

    const response = formatOwnerServiceResponse(
      parentService,
      business,
      'Child service deleted successfully.'
    );

    return res.status(200).json({
      ...response,
      deletedChildServiceId: String(childServiceId),
    });
  } catch (err) {
    console.error('Failed to delete child service:', err.message);
    return res.status(500).json({ error: 'Failed to delete child service.' });
  }
};
