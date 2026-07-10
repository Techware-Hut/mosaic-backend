const parseDurationMinutes = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const numericValue = Number(trimmed);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue;
    }

    const matched = trimmed.match(/(\d+(?:\.\d+)?)/);
    if (matched) {
      const parsed = Number(matched[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return null;
};

const parsePrice = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) {
    return null;
  }

  return price;
};

const normalizeStringList = (value = []) => {
  const items = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? [value] : []);

  return items
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
};

const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

const isValidObjectIdString = (value) =>
  typeof value === 'string' && OBJECT_ID_PATTERN.test(value);

const resolveTaxonomyIdFromBody = (body = {}, fieldName, aliasFieldName) => {
  const direct = body[fieldName];
  if (isValidObjectIdString(direct)) return direct;
  if (direct && typeof direct === 'object' && direct._id) {
    const id = String(direct._id);
    if (isValidObjectIdString(id)) return id;
  }

  const alias = body[aliasFieldName];
  if (alias && typeof alias === 'object' && alias._id) {
    const id = String(alias._id);
    if (isValidObjectIdString(id)) return id;
  }
  if (isValidObjectIdString(alias)) return alias;

  return null;
};

const normalizeBusinessHoursForStorage = (slots) => {
  if (!Array.isArray(slots)) return [];

  return slots
    .map((slot) => {
      const day = String(slot?.day ?? '').trim();
      if (!day) return null;

      let hours = typeof slot?.hours === 'string' ? slot.hours.trim() : '';
      let closed = typeof slot?.closed === 'boolean' ? slot.closed : false;

      const openTime = slot?.openTime ? String(slot.openTime).trim() : '';
      const closeTime = slot?.closeTime ? String(slot.closeTime).trim() : '';

      if (!hours && openTime && closeTime) {
        hours = `${openTime}-${closeTime}`;
      }

      if (typeof slot?.closed === 'boolean') {
        closed = slot.closed;
      } else if (typeof slot?.isOpen === 'boolean') {
        closed = !slot.isOpen;
      }

      // Treat both an empty hours string AND an explicit "Closed" value as closed.
      // This ensures `closed` is always true when the day is not open.
      if (!hours || hours === 'Closed') {
        hours = 'Closed';
        closed = true;
      }

      return { day, hours, closed };
    })
    .filter(Boolean);
};

const normalizeBusinessHoursForOwnerResponse = (slots) => {
  if (!Array.isArray(slots)) return [];

  return slots.map((slot) => {
    let openTime = slot?.openTime ? String(slot.openTime).trim() : '';
    let closeTime = slot?.closeTime ? String(slot.closeTime).trim() : '';
    let isOpen = typeof slot?.isOpen === 'boolean' ? slot.isOpen : true;

    if ((!openTime || !closeTime) && typeof slot?.hours === 'string') {
      const parts = slot.hours.split('-').map((part) => part.trim());
      if (parts.length === 2) {
        openTime = openTime || parts[0];
        closeTime = closeTime || parts[1];
      }
    }

    // Check the `hours` string first — "Closed" is a definitive signal regardless
    // of what the `closed` flag says (handles data saved before the storage fix).
    if (slot?.hours === 'Closed') {
      isOpen = false;
    } else if (typeof slot?.closed === 'boolean') {
      isOpen = !slot.closed;
    }

    return {
      day: slot?.day ? String(slot.day).trim() : '',
      openTime,
      closeTime,
      isOpen,
    };
  });
};

const normalizeFaqList = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      question: String(item?.question ?? '').trim(),
      answer: String(item?.answer ?? '').trim(),
    }))
    .filter((item) => item.question && item.answer);
};

const normalizeAmenitiesList = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      label: String(item?.label ?? '').trim(),
      available: Boolean(item?.available),
    }))
    .filter((item) => item.label);
};

const childMissingPrice = (item) =>
  item.price === undefined || item.price === null || item.price === '';

const childMissingDuration = (item) =>
  item.durationMinutes === undefined
  || item.durationMinutes === null
  || item.durationMinutes === ''
  || (item.duration === undefined || item.duration === null || item.duration === '');

const isNameOnlyChild = (item) => {
  if (!item || !item.name || !String(item.name).trim()) {
    return false;
  }

  return childMissingPrice(item) && childMissingDuration(item);
};

const applyTopLevelBackfill = (body, childServices) => {
  if (!Array.isArray(childServices) || childServices.length !== 1) {
    return childServices;
  }

  if (!isNameOnlyChild(childServices[0])) {
    return childServices;
  }

  const topLevelPrice = parsePrice(body.price);
  const topLevelDuration = parseDurationMinutes(body.durationMinutes ?? body.duration);

  if (topLevelPrice === null || topLevelDuration === null) {
    return childServices;
  }

  return [{
    ...childServices[0],
    price: topLevelPrice,
    durationMinutes: topLevelDuration,
    duration: body.duration ?? `${topLevelDuration}`,
  }];
};

const normalizeChildService = (item = {}) => {
  const normalizedImages = Array.isArray(item.images)
    ? item.images.filter(Boolean)
    : [];
  const fallbackImage = item.image || item.imagePath || item.path || normalizedImages[0] || '';
  const durationMinutes = parseDurationMinutes(item.durationMinutes ?? item.duration);
  const price = parsePrice(item.price);

  return {
    name: item.name ? String(item.name).trim() : '',
    description: item.description ? String(item.description).trim() : '',
    image: fallbackImage,
    images: normalizedImages.length ? normalizedImages : (fallbackImage ? [fallbackImage] : []),
    durationMinutes,
    price,
  };
};

const normalizeChildServices = (childServices = []) => {
  return childServices.map(normalizeChildService);
};

const getMinimumChildServicePrice = (childServices = [], fallbackPrice = 0) => {
  const prices = childServices
    .map((item) => Number(item.price))
    .filter((price) => Number.isFinite(price) && price >= 0);

  return prices.length > 0 ? Math.min(...prices) : fallbackPrice;
};

const normalizeServicePayload = (body = {}) => {
  const backfilledChildren = applyTopLevelBackfill(body, Array.isArray(body.services) ? body.services : []);
  const normalizedServices = normalizeChildServices(backfilledChildren);

  return {
    title: body.title ? String(body.title).trim() : 'Service',
    description: body.description ? String(body.description).trim() : '',
    isPublished: body.isPublished === true || body.isPublished === 'true',
    normalizedServices,
    features: normalizeStringList(body.features),
    parentPrice: getMinimumChildServicePrice(normalizedServices, 0),
    parentDuration: body.duration ? String(body.duration).trim() : '',
  };
};

const validateChildServices = (children = []) => {
  const fieldErrors = {};

  if (!Array.isArray(children) || children.length === 0) {
    fieldErrors.services = 'At least one child service is required.';
    return { ok: false, fieldErrors };
  }

  children.forEach((item, index) => {
    if (!item.name) {
      fieldErrors[`services[${index}].name`] = 'Child service name is required.';
    }

    if (item.price === null || item.price === undefined) {
      fieldErrors[`services[${index}].price`] =
        'Child service price is required and must be a number greater than 0.';
    } else if (!Number.isFinite(Number(item.price)) || Number(item.price) <= 0) {
      fieldErrors[`services[${index}].price`] =
        'Child service price is required and must be a number greater than 0.';
    }

    if (!item.durationMinutes) {
      fieldErrors[`services[${index}].durationMinutes`] =
        'Child service duration is required. Provide durationMinutes or a parseable duration value.';
    }
  });

  return {
    ok: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
};

const deriveParentPricing = (children = []) => ({
  price: getMinimumChildServicePrice(children, 0),
  duration: children.length > 0 ? '' : '',
});

const PUBLISH_CHILD_SERVICE_REQUIRED_MESSAGE = 'Add at least one service offering before publishing.';

const evaluateServicePublication = ({ service, business }) => {
  const isPublished = Boolean(service?.isPublished);
  const children = Array.isArray(service?.services) ? service.services : [];
  const childValidation = validateChildServices(children);

  if (!isPublished) {
    return {
      isPublished,
      isPubliclyVisible: false,
      visibilityReason: 'SERVICE_UNPUBLISHED',
    };
  }

  if (!childValidation.ok) {
    return {
      isPublished,
      isPubliclyVisible: false,
      visibilityReason: 'INVALID_SERVICE_DATA',
    };
  }

  if (!business) {
    return {
      isPublished,
      isPubliclyVisible: false,
      visibilityReason: 'BUSINESS_NOT_PUBLICLY_ELIGIBLE',
    };
  }

  if (business.isActive !== true) {
    return {
      isPublished,
      isPubliclyVisible: false,
      visibilityReason: 'BUSINESS_INACTIVE',
    };
  }

  return {
    isPublished,
    isPubliclyVisible: true,
    visibilityReason: null,
  };
};

const validatePublishRequest = ({ isPublished, normalizedServices }) => {
  if (!isPublished) {
    return { ok: true, fieldErrors: {} };
  }

  if (!Array.isArray(normalizedServices) || normalizedServices.length === 0) {
    return {
      ok: false,
      message: PUBLISH_CHILD_SERVICE_REQUIRED_MESSAGE,
      fieldErrors: {
        services: PUBLISH_CHILD_SERVICE_REQUIRED_MESSAGE,
        isPublished: PUBLISH_CHILD_SERVICE_REQUIRED_MESSAGE,
      },
    };
  }

  const validation = validateChildServices(normalizedServices);
  if (!validation.ok) {
    return {
      ok: false,
      message: 'Add at least one service offering with name, price, and duration before publishing.',
      fieldErrors: {
        ...validation.fieldErrors,
        isPublished: 'Add at least one service offering with name, price, and duration before publishing.',
      },
    };
  }

  return { ok: true, fieldErrors: {} };
};

const toPlainService = (service) => {
  if (!service) return null;
  if (typeof service.toObject === 'function') {
    return service.toObject();
  }
  return service;
};

const formatOwnerServiceForResponse = (plainService) => {
  if (!plainService) return plainService;

  const formatted = { ...plainService };

  if (formatted.categoryId && typeof formatted.categoryId === 'object' && formatted.categoryId._id) {
    formatted.categoryId = {
      _id: formatted.categoryId._id,
      name: formatted.categoryId.name || '',
    };
  }

  if (formatted.subcategoryId && typeof formatted.subcategoryId === 'object' && formatted.subcategoryId._id) {
    formatted.subcategoryId = {
      _id: formatted.subcategoryId._id,
      name: formatted.subcategoryId.name || '',
    };
  }

  formatted.businessHours = normalizeBusinessHoursForOwnerResponse(formatted.businessHours);
  formatted.faq = Array.isArray(formatted.faq) ? formatted.faq : [];
  formatted.amenities = Array.isArray(formatted.amenities) ? formatted.amenities : [];
  formatted.features = Array.isArray(formatted.features) ? formatted.features : [];

  return formatted;
};

const formatOwnerServiceResponse = (service, business, message) => {
  const plainService = formatOwnerServiceForResponse(toPlainService(service));
  const publication = evaluateServicePublication({ service: plainService, business });

  return {
    success: true,
    message,
    service: plainService,
    data: {
      service: plainService,
      publication,
    },
  };
};

const formatValidationErrorResponse = (fieldErrors, message = 'Validation failed') => ({
  success: false,
  message,
  error: message,
  fieldErrors,
});

module.exports = {
  parseDurationMinutes,
  parsePrice,
  normalizeStringList,
  isValidObjectIdString,
  resolveTaxonomyIdFromBody,
  normalizeBusinessHoursForStorage,
  normalizeBusinessHoursForOwnerResponse,
  normalizeFaqList,
  normalizeAmenitiesList,
  normalizeChildService,
  normalizeChildServices,
  normalizeServicePayload,
  validateChildServices,
  validatePublishRequest,
  deriveParentPricing,
  PUBLISH_CHILD_SERVICE_REQUIRED_MESSAGE,
  getMinimumChildServicePrice,
  evaluateServicePublication,
  formatOwnerServiceForResponse,
  formatOwnerServiceResponse,
  formatValidationErrorResponse,
};
