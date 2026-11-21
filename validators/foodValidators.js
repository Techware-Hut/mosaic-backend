'use strict';

const { body } = require('express-validator');

const requiredText = (field, message) =>
  body(field)
    .custom((value) => typeof value === 'string' && value.trim().length > 0)
    .withMessage(message);

/**
 * POST /api/food/add-food. createFood previously defaulted a missing title to
 * "Food" and accepted no description or cover image. category/subcategory/
 * business are still checked in the controller.
 */
exports.validateFoodCreate = [
  requiredText('title', 'Food title is required.'),
  requiredText('description', 'Food description is required.'),
  requiredText('coverImage', 'Cover image is required.'),
  body('images')
    .optional({ nullable: true })
    .isArray().withMessage('Gallery images must be a list.'),
  body('images.*')
    .custom((value) => typeof value === 'string')
    .withMessage('Gallery images must be strings.'),
];
