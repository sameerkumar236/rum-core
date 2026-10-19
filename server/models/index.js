import mongoose from 'mongoose';

const { Schema } = mongoose;
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true },
);

const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);

const projectSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    origin: { type: String, required: true },
    key: { type: String, required: true, unique: true },
    collectVitals: { type: Boolean, default: true },
    urlFilterMode: { type: String, enum: ['all', 'include', 'exclude'], default: 'all' },
    urlPatterns: { type: [String], default: [] },
  },
  { timestamps: true },
);

const metric = { type: Number, default: null, min: 0 };
const eventSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    eventId: { type: String, required: true },
    revision: { type: Number, default: 0, min: 0 },
    type: { type: String, enum: ['page', 'request'], required: true },
    sessionId: { type: String, required: true },
    pageUrl: { type: String, required: true },
    url: { type: String, default: '' },
    method: { type: String, default: 'GET' },
    status: { type: Number, default: null },
    duration: metric,
    ttfb: metric,
    dns: metric,
    tcp: metric,
    tls: metric,
    lcp: metric,
    fcp: metric,
    cls: metric,
    inp: metric,
    browser: { type: String, default: 'Unknown' },
    os: { type: String, default: 'Unknown' },
    device: { type: String, default: 'Unknown' },
    connection: { type: String, default: 'Unknown' },
    country: { type: String, default: 'Unknown' },
    region: { type: String, default: 'Unknown' },
    city: { type: String, default: 'Unknown' },
    timestamp: { type: Date, required: true },
    demo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

eventSchema.index({ project: 1, type: 1, eventId: 1 }, { unique: true });
eventSchema.index({ project: 1, timestamp: -1 });
eventSchema.index({ project: 1, type: 1, pageUrl: 1, timestamp: -1 });
eventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
export const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);
export const Event = mongoose.models.Event || mongoose.model('Event', eventSchema);

export function publicUser(user) {
  return { id: String(user._id), name: user.name, email: user.email };
}

export function publicProject(project) {
  return {
    id: String(project._id),
    name: project.name,
    origin: project.origin,
    key: project.key,
    collectVitals: project.collectVitals,
    urlFilterMode: project.urlFilterMode,
    urlPatterns: project.urlPatterns,
    createdAt: project.createdAt,
  };
}
