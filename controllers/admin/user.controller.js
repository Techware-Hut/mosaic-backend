const User = require("../../models/User");
const bcrypt = require("bcryptjs");
const { validationResult } = require("express-validator");
const toAdminUser = require("../../utils/toAdminUser");
const {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} = require("../../utils/audit/actionRegistry");
const {
  recordAdminAuditSuccess,
  recordAdminAuditFailure,
  buildFieldChangeSummary,
} = require("../../services/adminAuditService");

// POST /admin/users/admins
exports.createAdminUser = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, email, password, mobile, gender, minorityType } = req.body;

    const existingUser = await User.findOne({ $or: [{ email }, { mobile }] });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with email or mobile",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      name,
      email,
      passwordHash,
      mobile,
      gender,
      minorityType,
      role: "admin",
      isOtpVerified: true,
    });

    return res.status(201).json({
      success: true,
      message: "Admin user created successfully",
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("createAdminUser error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// GET /admin/users
exports.getAllUsers = async (req, res) => {
  try {
    const [users, totalVendor, totalCustomer, otpVerified, otpUnverified] =
      await Promise.all([
        User.find({ isDeleted: false }),
        User.countDocuments({ isDeleted: false, role: "business_owner" }),
        User.countDocuments({ isDeleted: false, role: "customer" }),
        User.countDocuments({ isDeleted: false, isOtpVerified: true }),
        User.countDocuments({ isDeleted: false, isOtpVerified: false }),
      ]);

    res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: users.map(toAdminUser),
      totalVendor,
      totalCustomer,
      otpVerified,
      otpUnverified,
    });
  } catch (error) {
    console.error("getAllUsers error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// GET /admin/users/:id
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findOne({
      _id: req.params.id,
      isDeleted: false,
    });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      message: "User details fetched",
      data: toAdminUser(user),
    });
  } catch (error) {
    console.error("getUserById error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// PUT /admin/users/:id
exports.updateUserByAdmin = async (req, res) => {
  try {
    const updatedUser = await User.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      req.body,
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res
        .status(404)
        .json({ success: false, message: "User not found or deleted" });
    }

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: toAdminUser(updatedUser),
    });
  } catch (error) {
    console.error("updateUserByAdmin error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// DELETE /admin/users/:id
exports.deleteUserByAdmin = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isDeleted: true },
      { new: true }
    );

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    await recordAdminAuditSuccess(req, {
      actionCode: ADMIN_AUDIT_ACTIONS.USER_SOFT_DELETE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.USER,
      targetId: user._id,
      changeSummary: buildFieldChangeSummary(
        { isDeleted: false },
        { isDeleted: true },
        ["isDeleted"]
      ),
    });

    res.status(200).json({
      success: true,
      message: "User soft deleted successfully",
    });
  } catch (error) {
    console.error("deleteUserByAdmin error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// PUT /admin/users/:id/block
exports.toggleBlockUser = async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id, isDeleted: false });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const wasBlocked = user.isBlocked;
    user.isBlocked = !user.isBlocked;
    await user.save();

    await recordAdminAuditSuccess(req, {
      actionCode: user.isBlocked
        ? ADMIN_AUDIT_ACTIONS.USER_BLOCK
        : ADMIN_AUDIT_ACTIONS.USER_UNBLOCK,
      targetType: ADMIN_AUDIT_TARGET_TYPES.USER,
      targetId: user._id,
      changeSummary: buildFieldChangeSummary(
        { isBlocked: wasBlocked },
        { isBlocked: user.isBlocked },
        ["isBlocked"]
      ),
    });

    res.status(200).json({
      success: true,
      message: `User has been ${user.isBlocked ? "blocked" : "unblocked"}`,
    });
  } catch (error) {
    console.error("toggleBlockUser error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
