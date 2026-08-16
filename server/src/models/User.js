import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import config from '../config/env.js';
import { ROLES, ASSIGNABLE_MODULES } from '../config/permissions.js';

const ROLE_VALUES = Object.values(ROLES);

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address.'],
    },

    /** Reference, not an embedded copy — see Organization. */
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },

    /** Exactly the three levels the District asked for. */
    role: { type: String, enum: ROLE_VALUES, required: true, default: config.auth.defaultRole, index: true },

    /**
     * Which areas a Module Editor may edit. Ignored for Read Only (edits nothing)
     * and Administrator (edits everything).
     */
    modules: {
      type: [{ type: String, enum: ASSIGNABLE_MODULES }],
      default: [],
    },

    /** Never selected by default — ask for it explicitly with .select('+passwordHash'). */
    passwordHash: { type: String, select: false },

    isActive: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.virtual('fullName').get(function fullName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

userSchema.index({ role: 1, isActive: 1 });

/** Hash on the way in so a plain password never reaches the database. */
userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, config.auth.saltRounds);
};

userSchema.methods.verifyPassword = async function verifyPassword(plain) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plain, this.passwordHash);
};

/** A Module Editor with no assigned modules can edit nothing — that is intentional. */
userSchema.methods.editableModules = function editableModules() {
  if (this.role === ROLES.ADMIN) return [...ASSIGNABLE_MODULES];
  if (this.role === ROLES.MODULE_EDITOR) return [...(this.modules ?? [])];
  return [];
};

export default mongoose.model('User', userSchema);
