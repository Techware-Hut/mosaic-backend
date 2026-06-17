const VendorOnboarding = require('../../models/VendorOnboardingStage1');
const User = require('../../models/User');
const Business = require('../../models/Business');
const { 
  sendVendorApprovedEmail,
  sendVendorRejectionEmail,
  sendVendorTrustBadgeAssignedEmail
} = require('../../utils/WellcomeMailer');

// Admin pending queue contains only applications that have completed vendor
// submission and are waiting for stage-1 review. Rejected resubmissions re-enter
// the queue by transitioning back to `submitted` in vendorOnboarding.controller.
const PENDING_REVIEW_STATUSES = Object.freeze(['submitted']);

exports.PENDING_REVIEW_STATUSES = PENDING_REVIEW_STATUSES;

const syncBusinessPoints = async (application, badge) => {
  const ownerId = application.userId?._id || application.userId;
  const update = {
    points: application.totalVerificationPoints,
  };

  if (badge !== undefined) {
    update.badge = badge;
  }

  await Business.findOneAndUpdate(
    { owner: ownerId },
    { $set: update }
  );
};

const autoVerifyMinorityDocsIfMissing = async (application) => {
  const hasMinorityProofDocuments = Array.isArray(application.minorityProofDocuments)
    && application.minorityProofDocuments.length > 0;

  if (hasMinorityProofDocuments || application.verificationChecklist.minorityDocs) {
    return 0;
  }

  application.verificationChecklist.minorityDocs = true;
  application.totalVerificationPoints += 10;
  await application.save();
  await syncBusinessPoints(application);

  return 10;
};

/* =====================================================
   GET PENDING APPLICATIONS
===================================================== */


exports.getPendingApplications = async (req, res) => {
  try {
    const applications = await VendorOnboarding.find({
      status: { $in: PENDING_REVIEW_STATUSES }
    })
      .populate('userId', 'name email')
      .sort({ submittedAt: -1, createdAt: -1 });

    await Promise.all(
      applications.map((application) => autoVerifyMinorityDocsIfMissing(application))
    );

    return res.status(200).json({
      success: true,
      data: applications
    });
  } catch (error) {
    console.error('Get all applications error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch applications'
    });
  }
};


// exports.getPendingApplications = async (req, res) => {
//   try {
//     const applications = await VendorOnboarding.find({ 
//       status: 'submitted' 
//     }).populate('userId', 'name email').sort({ submittedAt: -1 });

//     return res.status(200).json({
//       success: true,
//       data: applications
//     });
//   } catch (error) {
//     console.error('Get pending applications error:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to fetch applications'
//     });
//   }
// };

/* =====================================================
   GET SINGLE APPLICATION DETAILS
===================================================== */

exports.getApplicationDetails = async (req, res) => {
  try {
    const { applicationId } = req.params;
    
    // ✅ FIX: Search by applicationId field instead of _id
    const application = await VendorOnboarding.findOne({ applicationId })
      .populate('userId', 'name email phone');

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    await autoVerifyMinorityDocsIfMissing(application);

    return res.status(200).json({
      success: true,
      data: application
    });
  } catch (error) {
    console.error('Get application details error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch application details'
    });
  }
};

/* =====================================================
   VERIFY DOCUMENT/CHANNEL AND ALLOCATE POINTS
===================================================== */

exports.verifyAndAllocatePoints = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { verificationType, documentIndex, isVerified } = req.body;
    const validVerificationTypes = [
      'minority-proof',
      'tax-doc',
      'business-license',
      'website',
      'facebook',
      'instagram',
      'linkedin',
      'tiktok',
      'business-profile-image',
      'business-bio',
      'refund-policy-document',
      'terms-document',
      'google-review-link',
      'community-service-link'
    ];

    if (!validVerificationTypes.includes(verificationType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verificationType'
      });
    }

    const application = await VendorOnboarding.findOne({ applicationId });
    
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    const hasMinorityProofDocuments = Array.isArray(application.minorityProofDocuments)
      && application.minorityProofDocuments.length > 0;

    if (verificationType === 'minority-proof' && !hasMinorityProofDocuments) {
      const autoAddedPoints = await autoVerifyMinorityDocsIfMissing(application);

      return res.status(200).json({
        success: true,
        message: 'Minority proof not uploaded. Auto-verified with 10 points.',
        data: {
          totalPoints: application.totalVerificationPoints,
          pointsAdded: autoAddedPoints,
          verificationChecklist: application.verificationChecklist
        }
      });
    }

    let pointsToAdd = 0;
    let alreadyVerified = false;
    let missingField = null;

    // ✅ Use existing verificationChecklist
    if (verificationType === 'minority-proof' && isVerified) {
      if (application.verificationChecklist.minorityDocs) {
        alreadyVerified = true;
      } else {
        if (documentIndex !== undefined && application.minorityProofDocuments[documentIndex]) {
          application.minorityProofDocuments[documentIndex].verified = true;
        }
        application.verificationChecklist.minorityDocs = true;
        pointsToAdd = 10;
      }
    } else if (verificationType === 'tax-doc' && isVerified) {
      if (application.verificationChecklist.taxDocs) {
        alreadyVerified = true;
      } else {
        if (documentIndex !== undefined && application.taxDocuments[documentIndex]) {
          application.taxDocuments[documentIndex].verified = true;
        }
        application.verificationChecklist.taxDocs = true;
        pointsToAdd = 10;
      }
    } else if (verificationType === 'business-license' && isVerified) {
      if (application.verificationChecklist.businessLicense) {
        alreadyVerified = true;
      } else {
        if (documentIndex !== undefined && application.businessLicenseDocuments[documentIndex]) {
          application.businessLicenseDocuments[documentIndex].verified = true;
        }
        application.verificationChecklist.businessLicense = true;
        pointsToAdd = 10;
      }
    } else if (verificationType === 'website' && isVerified) {
      if (application.verificationChecklist.website) {
        alreadyVerified = true;
      } else {
        application.verificationChecklist.website = true;
        pointsToAdd = 5;
      }
    } else if (verificationType === 'facebook' && isVerified) {
      if (application.verificationChecklist.facebook) {
        alreadyVerified = true;
      } else {
        application.verificationChecklist.facebook = true;
        pointsToAdd = 5;
      }
    } else if (verificationType === 'instagram' && isVerified) {
      if (application.verificationChecklist.instagram) {
        alreadyVerified = true;
      } else {
        application.verificationChecklist.instagram = true;
        pointsToAdd = 5;
      }
    } else if (verificationType === 'linkedin' && isVerified) {
      if (application.verificationChecklist.linkedin) {
        alreadyVerified = true;
      } else {
        application.verificationChecklist.linkedin = true;
        pointsToAdd = 5;
      }
    } else if (verificationType === 'tiktok' && isVerified) {
      if (application.verificationChecklist.tiktok) {
        alreadyVerified = true;
      } else {
        application.verificationChecklist.tiktok = true;
        pointsToAdd = 5;
      }
    } else if (verificationType === 'business-profile-image' && isVerified) {
      if (!application.businessProfileImage?.url) {
        missingField = 'businessProfileImage';
      } else if (application.verificationChecklist.businessProfileImage) {
        alreadyVerified = true;
      } else {
        application.businessProfileImage.verified = true;
        application.verificationChecklist.businessProfileImage = true;
        pointsToAdd = 5;
      }
    } else if (verificationType === 'business-bio' && isVerified) {
      if (!application.businessBio) {
        missingField = 'businessBio';
      } else if (application.verificationChecklist.businessBio) {
        alreadyVerified = true;
      } else {
        application.verificationChecklist.businessBio = true;
        pointsToAdd = 5;
      }
    } else if (verificationType === 'refund-policy-document' && isVerified) {
      if (!application.refundPolicyDocument?.url) {
        missingField = 'refundPolicyDocument';
      } else if (application.verificationChecklist.refundPolicyDocument) {
        alreadyVerified = true;
      } else {
        application.refundPolicyDocument.verified = true;
        application.verificationChecklist.refundPolicyDocument = true;
        pointsToAdd = 5;
      }
    } else if (verificationType === 'terms-document' && isVerified) {
      if (!application.termsDocument?.url) {
        missingField = 'termsDocument';
      } else if (application.verificationChecklist.termsDocument) {
        alreadyVerified = true;
      } else {
        application.termsDocument.verified = true;
        application.verificationChecklist.termsDocument = true;
        pointsToAdd = 5;
      }
    } else if (verificationType === 'google-review-link' && isVerified) {
      if (!application.googleReviewLink) {
        missingField = 'googleReviewLink';
      } else if (application.verificationChecklist.googleReviewLink) {
        alreadyVerified = true;
      } else {
        application.verificationChecklist.googleReviewLink = true;
        pointsToAdd = 5;
      }
    } else if (verificationType === 'community-service-link' && isVerified) {
      if (!application.communityServiceLink) {
        missingField = 'communityServiceLink';
      } else if (application.verificationChecklist.communityServiceLink) {
        alreadyVerified = true;
      } else {
        application.verificationChecklist.communityServiceLink = true;
        pointsToAdd = 5;
      }
    }

    if (missingField) {
      return res.status(400).json({
        success: false,
        message: `${missingField} is missing and cannot be verified`
      });
    }

    // Handle unverification (isVerified = false)
    if (!isVerified) {
      if (verificationType === 'minority-proof') {
        application.verificationChecklist.minorityDocs = false;
        if (documentIndex !== undefined && application.minorityProofDocuments[documentIndex]) {
          application.minorityProofDocuments[documentIndex].verified = false;
        }
        pointsToAdd = -10;
      } else if (verificationType === 'tax-doc') {
        application.verificationChecklist.taxDocs = false;
        if (documentIndex !== undefined && application.taxDocuments[documentIndex]) {
          application.taxDocuments[documentIndex].verified = false;
        }
        pointsToAdd = -10;
      } else if (verificationType === 'business-license') {
        application.verificationChecklist.businessLicense = false;
        if (documentIndex !== undefined && application.businessLicenseDocuments[documentIndex]) {
          application.businessLicenseDocuments[documentIndex].verified = false;
        }
        pointsToAdd = -10;
      } else if (['website', 'facebook', 'instagram', 'linkedin', 'tiktok'].includes(verificationType)) {
        application.verificationChecklist[verificationType] = false;
        pointsToAdd = -5;
      } else if (verificationType === 'business-profile-image') {
        application.verificationChecklist.businessProfileImage = false;
        if (application.businessProfileImage) {
          application.businessProfileImage.verified = false;
        }
        pointsToAdd = -5;
      } else if (verificationType === 'business-bio') {
        application.verificationChecklist.businessBio = false;
        pointsToAdd = -5;
      } else if (verificationType === 'refund-policy-document') {
        application.verificationChecklist.refundPolicyDocument = false;
        if (application.refundPolicyDocument) {
          application.refundPolicyDocument.verified = false;
        }
        pointsToAdd = -5;
      } else if (verificationType === 'terms-document') {
        application.verificationChecklist.termsDocument = false;
        if (application.termsDocument) {
          application.termsDocument.verified = false;
        }
        pointsToAdd = -5;
      } else if (verificationType === 'google-review-link') {
        application.verificationChecklist.googleReviewLink = false;
        pointsToAdd = -5;
      } else if (verificationType === 'community-service-link') {
        application.verificationChecklist.communityServiceLink = false;
        pointsToAdd = -5;
      }
    }

    // Return error if already verified
    if (alreadyVerified) {
      return res.status(400).json({
        success: false,
        message: `${verificationType} is already verified`,
        data: {
          totalPoints: application.totalVerificationPoints,
          pointsAdded: 0,
          verificationChecklist: application.verificationChecklist
        }
      });
    }

    // Update points
    application.totalVerificationPoints += pointsToAdd;

    await application.save();

    // Keep Business points in sync with stage-1 onboarding points
    await syncBusinessPoints(application);

    return res.status(200).json({
      success: true,
      message: `Verification updated. Points: ${application.totalVerificationPoints}`,
      data: {
        totalPoints: application.totalVerificationPoints,
        pointsAdded: pointsToAdd,
        verificationChecklist: application.verificationChecklist
      }
    });

  } catch (error) {
    console.error('Verify and allocate points error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update verification'
    });
  }
};


/* =====================================================
   FINALIZE VERIFICATION (APPROVE/REJECT)
===================================================== */
// only checks for required documents and approves/rejects based on that. Points are not a factor in approval decision, but badge is still assigned based on points.  
exports.finalizeVerification = async (req, res) => {
  try {
    const { applicationId } = req.params;

    const application = await VendorOnboarding.findOne({ applicationId })
      .populate('userId', 'name email');

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    await autoVerifyMinorityDocsIfMissing(application);

    // ✅ Required docs check
    const hasTaxDocs = Boolean(application.verificationChecklist?.taxDocs);
    const hasBusinessLicense = Boolean(application.verificationChecklist?.businessLicense);

    const hasMinorityDocs = application.isMinorityOwned
      ? Boolean(application.verificationChecklist?.minorityDocs)
      : true;

    const hasRequiredDocsVerified =
      hasTaxDocs && hasBusinessLicense && hasMinorityDocs;

    // ❌ Missing docs
    const missingRequiredDocuments = [];

    if (!hasTaxDocs) {
      missingRequiredDocuments.push('EIN document');
    }

    if (!hasBusinessLicense) {
      missingRequiredDocuments.push('business license document');
    }

    if (application.isMinorityOwned && !hasMinorityDocs) {
      missingRequiredDocuments.push('minority proof document');
    }

    const rejectionReason = ` ${missingRequiredDocuments.join(', ')}.`;

    // ✅ Badge logic (kept as-is)
    const totalPoints = application.totalVerificationPoints;
    let badge = null;

    if (totalPoints >= 80) badge = 'Diamond';
    else if (totalPoints >= 50) badge = 'Platinum';
    else if (totalPoints >= 40) badge = 'Gold';
    else if (totalPoints >= 30) badge = 'Silver';

    // ✅ FINAL DECISION
    if (hasRequiredDocsVerified) {
      application.status = 'verified';
      application.badge = badge;
    } else {
      application.status = 'rejected';
      application.badge = badge;
    }

    await application.save();

    // ✅ Sync business
    await syncBusinessPoints(application, badge);

    let emailSent = false;

    // ✅ APPROVED
    if (application.status === 'verified') {
      await sendVendorApprovedEmail({
        to: application.userId.email,
        vendorName: application.userId.name,
        applicationId: application.applicationId
      });

      emailSent = true;

      // Optional badge email
      if (badge) {
        await sendVendorTrustBadgeAssignedEmail({
          to: application.userId.email,
          vendorName: application.userId.name,
          badgeName: badge
        });
        emailSent = true;
      }

      return res.status(200).json({
        success: true,
        message: 'Application approved successfully',
        data: {
          status: 'approved',
          badge,
          emailSent
        }
      });
    }

    // ❌ REJECTED
    if (application.status === 'rejected') {
      await sendVendorRejectionEmail({
        to: application.userId.email,
        vendorName: application.userId.name,
        applicationId: application.applicationId,
        rejectionReason
      });

      emailSent = true;

      return res.status(200).json({
        success: true,
        message: 'Application rejected due to missing required documents',
        data: {
          status: 'rejected',
          badge,
          emailSent,
          missingRequiredDocuments,
          rejectionReason
        }
      });
    }

  } catch (error) {
    console.error('Finalize verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to finalize verification'
    });
  }
};

// exports.finalizeVerification = async (req, res) => {
//   try {
//     const { applicationId } = req.params;

//     const application = await VendorOnboarding.findOne({ applicationId })
//       .populate('userId', 'name email');

//     if (!application) {
//       return res.status(404).json({
//         success: false,
//         message: 'Application not found'
//       });
//     }

//     await autoVerifyMinorityDocsIfMissing(application);

//     const totalPoints = application.totalVerificationPoints;
//     const previousStatus = application.status;
//     const previousBadge = application.badge;
//     const hasRequiredDocsVerified = Boolean(
//       application.verificationChecklist?.minorityDocs
//       && application.verificationChecklist?.taxDocs
//       && application.verificationChecklist?.businessLicense
//     );
//     const missingRequiredDocuments = [];

//     if (!application.verificationChecklist?.taxDocs) {
//       missingRequiredDocuments.push('EIN document');
//     }

//     if (!application.verificationChecklist?.businessLicense) {
//       missingRequiredDocuments.push('business license document');
//     }

//     const rejectionReason = totalPoints < 30
//       ? 'Your application was rejected because it has fewer than 30 verification points.'
//       : `Your application was rejected because the following required document(s) are not verified: ${missingRequiredDocuments.join(', ')}.`;

//     // Determine badge based on points
//     let badge = null;
//     if (totalPoints >= 80) badge = 'Diamond';
//     else if (totalPoints >= 50) badge = 'Platinum';
//     else if (totalPoints >= 40) badge = 'Gold';
//     else if (totalPoints >= 30) badge = 'Silver';

//     // Update status and badge
//     if (totalPoints >= 30 && hasRequiredDocsVerified) {
//       application.status = 'verified';
//       application.badge = badge;
//     } else {
//       application.status = 'rejected';
//       application.badge = badge; // could be null
//     }

//     await application.save();

//     // Keep Business record in sync
//     await syncBusinessPoints(application, badge);

//     let emailSent = false;

//     // SCENARIO: Vendor approved or status changed to verified
//     if (application.status === 'verified') {
//       // Send approval email if status changed
//       if (previousStatus !== 'verified') {
//         await sendVendorApprovedEmail({
//           to: application.userId.email,
//           vendorName: application.userId.name,
//           applicationId: application.applicationId
//         });
//         emailSent = true;
//       }

//       // Send Trust Badge email if badge changed or first-time assigned
//       if (badge && badge !== previousBadge) {
//         await sendVendorTrustBadgeAssignedEmail({
//           to: application.userId.email,
//           vendorName: application.userId.name,
//           badgeName: badge
//         });
//         emailSent = true;
//       }

//       return res.status(200).json({
//         success: true,
//         message: 'Application approved successfully',
//         data: { status: 'approved', points: totalPoints, badge, emailSent }
//       });
//     }

//     // SCENARIO: Vendor rejected (<30 points)
//     if (application.status === 'rejected') {
//       if (previousStatus !== 'rejected') {
//         await sendVendorRejectionEmail({
//           to: application.userId.email,
//           vendorName: application.userId.name,
//           applicationId: application.applicationId,
//           points: totalPoints,
//           rejectionReason
//         });
//         emailSent = true;
//       }

//       return res.status(200).json({
//         success: true,
//         message: totalPoints < 30
//           ? 'Application rejected due to insufficient points'
//           : 'Application rejected because the required documents are not fully verified',
//         data: {
//           status: 'rejected',
//           points: totalPoints,
//           badge,
//           emailSent,
//           requiredDocsVerified: hasRequiredDocsVerified,
//           missingRequiredDocuments,
//           rejectionReason
//         }
//       });
//     }

//   } catch (error) {
//     console.error('Finalize verification error:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to finalize verification'
//     });
//   }
// };








// exports.finalizeVerification = async (req, res) => {
//   try {
//     const { applicationId } = req.params;
    
//     // ✅ FIX: Search by applicationId field instead of _id
//     const application = await VendorOnboarding.findOne({ applicationId })
//       .populate('userId', 'name email');

//     if (!application) {
//       return res.status(404).json({
//         success: false,
//         message: 'Application not found'
//       });
//     }

//     const totalPoints = application.totalVerificationPoints;
//     const previousStatus = application.status;
//     let badge = null;

//     if (totalPoints >= 80) badge = 'Diamond';
//     else if (totalPoints >= 50) badge = 'Platinum';
//     else if (totalPoints >= 40) badge = 'Gold';
//     else if (totalPoints >= 30) badge = 'Silver';
    
//     if (totalPoints >= 30) {
//       // SCENARIO 1: Approved (30+ points)
//       application.status = 'verified';
//       application.badge = badge;
//       application.totalVerificationPoints = totalPoints;
//       await application.save();

//       // Keep Business points/badge in sync on finalize
//       await Business.findOneAndUpdate(
//         { owner: application.userId._id },
//         { $set: { points: totalPoints, badge } }
//       );
      
//       // Send approval email only on status transition
//       let emailSent = false;
// if (previousStatus !== 'verified') {

//   // Approval email
//   await sendVendorApprovedEmail({
//     to: application.userId.email,
//     vendorName: application.userId.name,
//     applicationId: application.applicationId
//   });

//   // Trust badge email
//   await sendVendorTrustBadgeAssignedEmail({
//     to: application.userId.email,
//     vendorName: application.userId.name,
//     badgeName: badge
//   });

//   emailSent = true;
// }
      
//       return res.status(200).json({
//         success: true,
//         message: 'Application approved successfully',
//         data: { status: 'approved', points: totalPoints, badge, emailSent }
//       });
      
//     } else {
//       // SCENARIO 2: Rejected (<30 points)
//       application.status = 'rejected';
//       application.badge = badge;
//       application.totalVerificationPoints = totalPoints;
//       await application.save();

//       // Keep Business points/badge in sync on finalize
//       await Business.findOneAndUpdate(
//         { owner: application.userId._id },
//         { $set: { points: totalPoints, badge } }
//       );
      
//       // Send rejection email only on status transition
//       let emailSent = false;
//       if (previousStatus !== 'rejected') {
//         await sendVendorRejectionEmail({
//           to: application.userId.email,
//           vendorName: application.userId.name,
//           applicationId: application.applicationId,
//           points: totalPoints
//         });
//         emailSent = true;
//       }
      
//       return res.status(200).json({
//         success: true,
//         message: 'Application rejected due to insufficient points',
//         data: { status: 'rejected', points: totalPoints, badge, emailSent }
//       });
//     }

//   } catch (error) {
//     console.error('Finalize verification error:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to finalize verification'
//     });
//   }
// };
