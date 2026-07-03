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
    parentPrice: getMinimumChildServicePrice(normalizedServices, 0),
    parentDuration: normalizedServices.length > 0 ? '' : (body.duration ? String(body.duration).trim() : ''),
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
      fieldErrors[`services[${index}].price`] = 'Child service price is required and must be a number >= 0.';
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

const formatOwnerServiceResponse = (service, business, message) => {
  const plainService = toPlainService(service);
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
  normalizeChildService,
  normalizeChildServices,
  normalizeServicePayload,
  validateChildServices,
  validatePublishRequest,
  deriveParentPricing,
  PUBLISH_CHILD_SERVICE_REQUIRED_MESSAGE,
  getMinimumChildServicePrice,
  evaluateServicePublication,
  formatOwnerServiceResponse,
  formatValidationErrorResponse,
};
