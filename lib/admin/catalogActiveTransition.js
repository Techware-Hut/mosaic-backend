/**
 * Catalog active/inactive is a visibility toggle, not a publish/unpublish toggle.
 *
 * Deactivate must hide the listing (isActive=false) without converting a live
 * listing into a vendor draft (isPublished=false). Reactivate must restore
 * published listings to published, while genuine unpublished drafts stay drafts.
 */
function isCurrentlyActive(listing = {}) {
  return listing.isActive !== false;
}

function applyCatalogActiveTransition(listing = {}, nextIsActive, options = {}) {
  if (nextIsActive !== true && nextIsActive !== false) {
    return {};
  }

  const currentlyPublished = Boolean(listing.isPublished);
  const currentlyActive = isCurrentlyActive(listing);
  const rememberedPublished = listing.wasPublishedAtDeactivation === true;
  const hasPublishedVariant = Boolean(options.hasPublishedVariant);

  if (nextIsActive === false) {
    return {
      isActive: false,
      isPublished: currentlyPublished,
      wasPublishedAtDeactivation:
        currentlyPublished || rememberedPublished || hasPublishedVariant,
    };
  }

  const knownNeverPublished =
    listing.wasPublishedAtDeactivation === false &&
    !currentlyPublished &&
    !hasPublishedVariant;

  const restorePublished =
    !knownNeverPublished &&
    (currentlyPublished ||
      rememberedPublished ||
      hasPublishedVariant ||
      (!currentlyActive && listing.wasPublishedAtDeactivation !== false));

  return {
    isActive: true,
    isPublished: knownNeverPublished ? false : restorePublished,
    wasPublishedAtDeactivation: false,
  };
}

module.exports = {
  applyCatalogActiveTransition,
};
