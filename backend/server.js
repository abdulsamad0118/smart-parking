import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes, createHash } from "node:crypto";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || "local-development-secret-change-this-before-deploying";
const isProduction = process.env.NODE_ENV === "production";
const backendDir = path.dirname(fileURLToPath(import.meta.url));
const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(",").map(x => x.trim()) : [])
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("This website origin is not allowed by the SmartPark API."));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Requested-With"]
}));
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const slotSchema = new mongoose.Schema({
  id: { type: String, required: true },
  status: { type: String, enum: ["available", "occupied", "booked"], default: "available" }
}, { _id: false });
const floorSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  vehicleType: { type: String, default: "Car" },
  slots: [slotSchema]
}, { _id: false });
const locationSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  area: { type: String, required: true },
  type: { type: String, enum: ["Mall", "Hospital"], default: "Mall" },
  active: { type: Boolean, default: true },
  publicInfo: { type: String, default: "" },
  dataNote: { type: String, default: "Availability is calculated from active SmartPark bookings." },
  floors: [floorSchema]
}, { timestamps: true });
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["customer", "admin"], default: "customer" }
}, { timestamps: true });
const bookingSchema = new mongoose.Schema({
  reference: { type: String, unique: true, required: true },
  // Optional so visitors can reserve without creating an account.
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false, index: true },
  guestTokenHash: { type: String, required: false, select: false },
  customerName: { type: String, default: "Guest" },
  locationId: { type: String, required: true },
  locationName: { type: String, required: true },
  floorId: { type: String, required: true },
  floorName: { type: String, required: true },
  slotId: { type: String, required: true },
  estimatedArrival: { type: Date, required: true },
  estimatedDeparture: { type: Date, required: true },
  durationMinutes: { type: Number, default: 60 },
  status: { type: String, enum: ["confirmed", "cancelled", "completed", "expired"], default: "confirmed" }
}, { timestamps: true });
bookingSchema.index({ status: 1, estimatedDeparture: 1 });

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { message: "Too many login attempts. Please try again later." } });
const Location = mongoose.model("Location", locationSchema);
const User = mongoose.model("User", userSchema);
const Booking = mongoose.model("Booking", bookingSchema);

// Demo locations start completely empty. Availability changes only through bookings.
const makeSlots = (prefix, count = 12) => Array.from({ length: count }, (_, i) => ({
  id: `${prefix}${i + 1}`,
  status: "available"
}));
const seedLocations = [
  { id: "gvk-one", name: "GVK One Mall", area: "Banjara Hills, Hyderabad", type: "Mall", active: true,
    publicInfo: "Demo parking layout. Confirm actual bay counts and levels with the property before a live rollout.",
    dataNote: "Demo layout; availability reflects active SmartPark bookings, not sensor detection.",
    floors: [1,2,3,4,5].map(n => ({ id: `B${n}`, name: `Basement ${n}`, vehicleType: "Car", slots: makeSlots(`B${n}-`, 18) })) },
  { id: "sarath-city", name: "Sarath City Capital Mall", area: "Kondapur, Hyderabad", type: "Mall", active: true,
    publicInfo: "Demo parking layout. Confirm actual bay counts and levels with the property before a live rollout.",
    dataNote: "Demo layout; availability reflects active SmartPark bookings, not sensor detection.",
    floors: [1,2,3,4].map(n => ({ id: `P${n}`, name: `Parking Level ${n}`, vehicleType: "Car", slots: makeSlots(`P${n}-`, 24) })) },
  { id: "apollo-jubilee", name: "Apollo Hospitals", area: "Jubilee Hills, Hyderabad", type: "Hospital", active: true,
    publicInfo: "Initial demo branch: Apollo Hospitals, Jubilee Hills. Confirm the actual parking layout with the hospital.",
    dataNote: "Demo layout; availability reflects active SmartPark bookings, not sensor detection.",
    floors: [{ id: "G", name: "Ground Parking", vehicleType: "Car", slots: makeSlots("G-", 12) }, { id: "B1", name: "Basement 1", vehicleType: "Car", slots: makeSlots("HB1-", 12) }] }
];

const hashGuestToken = token => createHash("sha256").update(String(token)).digest("hex");
const safeUser = user => ({ id: user._id.toString(), name: user.name, email: user.email, role: user.role });
function safeBooking(booking, extras = {}) {
  const value = booking.toObject ? booking.toObject() : booking;
  const { guestTokenHash, ...safe } = value;
  return { ...safe, id: String(value._id), ...extras };
}
const safeLocation = location => ({
  id: location.id, name: location.name, area: location.area, type: location.type,
  active: location.active, publicInfo: location.publicInfo, dataNote: location.dataNote,
  floors: location.floors.map(f => ({ id: f.id, name: f.name, vehicleType: f.vehicleType, slots: f.slots.map(s => ({ id: s.id, status: s.status })) }))
});

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, JWT_SECRET, { expiresIn: "7d" });
}
function setAuthCookie(res, user) {
  res.cookie("smartpark_token", signToken(user), {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  });
}
function clearAuthCookie(res) {
  res.clearCookie("smartpark_token", { httpOnly: true, secure: isProduction, sameSite: isProduction ? "none" : "lax", path: "/" });
}
async function attachOptionalAuth(req, res, next) {
  try {
    const token = req.cookies.smartpark_token;
    if (token) {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = await User.findById(payload.sub).select("name email role");
    }
  } catch {
    clearAuthCookie(res);
  }
  next();
}
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies.smartpark_token;
    if (!token) return res.status(401).json({ message: "Please log in to continue." });
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.sub).select("name email role");
    if (!user) return res.status(401).json({ message: "Your session is no longer valid. Please log in again." });
    req.user = user;
    next();
  } catch {
    clearAuthCookie(res);
    return res.status(401).json({ message: "Your session expired. Please log in again." });
  }
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin access is required for this action." });
  next();
}
function requireAjax(req, res, next) {
  if (req.get("X-Requested-With") !== "XMLHttpRequest") return res.status(403).json({ message: "Request verification failed." });
  next();
}
function validDuration(value) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 30 && minutes <= 720 && minutes % 30 === 0 ? minutes : null;
}
async function releaseSlot(booking) {
  await Location.updateOne(
    { id: booking.locationId },
    { $set: { "floors.$[floor].slots.$[slot].status": "available" } },
    { arrayFilters: [{ "floor.id": booking.floorId }, { "slot.id": booking.slotId, "slot.status": "booked" }] }
  );
}
async function expireBookings() {
  const now = new Date();
  const due = await Booking.find({ status: "confirmed", estimatedDeparture: { $lte: now } }).select("locationId floorId slotId estimatedDeparture").lean();
  for (const booking of due) {
    const result = await Booking.updateOne(
      { _id: booking._id, status: "confirmed", estimatedDeparture: { $lte: now } },
      { $set: { status: "expired" } }
    );
    if (result.modifiedCount) await releaseSlot(booking);
  }
}
async function normalizeLegacySlots() {
  // Older demo builds randomly marked some bays as occupied. In this version,
  // a bay is unavailable only while it has a live confirmed booking.
  const activeBookings = await Booking.find({ status: "confirmed", estimatedDeparture: { $gt: new Date() } })
    .select("locationId floorId slotId").lean();
  const activeKeys = new Set(activeBookings.map(b => `${b.locationId}|${b.floorId}|${b.slotId}`));
  const locations = await Location.find();
  for (const location of locations) {
    let changed = false;
    for (const floor of location.floors) {
      for (const slot of floor.slots) {
        const shouldBe = activeKeys.has(`${location.id}|${floor.id}|${slot.id}`) ? "booked" : "available";
        if (slot.status !== shouldBe) { slot.status = shouldBe; changed = true; }
      }
    }
    if (changed) await location.save();
  }
}
async function canManageBooking(req, booking, guestToken) {
  if (req.user?.role === "admin") return true;
  if (req.user && booking.userId && booking.userId.toString() === req.user._id.toString()) return true;
  if (!booking.userId && guestToken && booking.guestTokenHash) {
    return hashGuestToken(guestToken) === booking.guestTokenHash;
  }
  return false;
}

app.get("/api/health", (_req, res) => res.json({ success: true, message: "Smart Parking API is running", database: mongoose.connection.readyState === 1 ? "connected" : "disconnected" }));

app.post("/api/auth/register", authLimiter, requireAjax, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ message: "Name, email and password are required." });
  if (String(password).length < 8) return res.status(400).json({ message: "Password must contain at least 8 characters." });
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return res.status(400).json({ message: "Enter a valid email address." });
  if (await User.exists({ email: normalizedEmail })) return res.status(409).json({ message: "An account with this email already exists." });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name: name.trim(), email: normalizedEmail, passwordHash, role: "customer" });
  setAuthCookie(res, user);
  res.status(201).json({ user: safeUser(user) });
});
app.post("/api/auth/login", authLimiter, requireAjax, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ message: "Email or password is incorrect." });
  setAuthCookie(res, user);
  res.json({ user: safeUser(user) });
});
app.post("/api/auth/logout", requireAjax, (_req, res) => { clearAuthCookie(res); res.json({ success: true }); });
app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: safeUser(req.user) }));

app.get("/api/locations", async (_req, res) => {
  await expireBookings();
  const locations = await Location.find({ active: true }).sort({ name: 1 }).lean();
  res.json(locations.map(safeLocation));
});
app.get("/api/admin/locations", requireAuth, requireAdmin, async (_req, res) => {
  const locations = await Location.find().sort({ name: 1 }).lean();
  res.json(locations.map(safeLocation));
});
app.post("/api/admin/locations", requireAuth, requireAdmin, requireAjax, async (req, res) => {
  const { name, area, type = "Mall", publicInfo = "" } = req.body;
  if (!name?.trim() || !area?.trim()) return res.status(400).json({ message: "Location name and area are required." });
  const id = `loc-${randomUUID().slice(0, 8)}`;
  const location = await Location.create({ id, name: name.trim(), area: area.trim(), type, publicInfo: String(publicInfo).trim(), active: true,
    floors: [{ id: "P1", name: "Parking Level 1", vehicleType: "Car", slots: makeSlots("P1-", 12) }] });
  res.status(201).json(safeLocation(location));
});
app.patch("/api/admin/locations/:id", requireAuth, requireAdmin, requireAjax, async (req, res) => {
  const location = await Location.findOne({ id: req.params.id });
  if (!location) return res.status(404).json({ message: "Location not found." });
  const { name, area, type, publicInfo, active } = req.body;
  if (name !== undefined) location.name = String(name).trim();
  if (area !== undefined) location.area = String(area).trim();
  if (type !== undefined) location.type = type;
  if (publicInfo !== undefined) location.publicInfo = String(publicInfo);
  if (active !== undefined) location.active = Boolean(active);
  await location.save();
  res.json(safeLocation(location));
});
app.post("/api/admin/locations/:id/floors", requireAuth, requireAdmin, requireAjax, async (req, res) => {
  const location = await Location.findOne({ id: req.params.id });
  if (!location) return res.status(404).json({ message: "Location not found." });
  const { name, vehicleType = "Car", slotCount = 12 } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: "Floor name is required." });
  const count = Math.max(1, Math.min(60, Number(slotCount) || 12));
  const id = `F${location.floors.length + 1}`;
  location.floors.push({ id, name: name.trim(), vehicleType, slots: makeSlots(`${id}-`, count) });
  await location.save();
  res.status(201).json(safeLocation(location));
});

app.get("/api/bookings", requireAuth, async (req, res) => {
  await expireBookings();
  const query = req.user.role === "admin" && req.query.all === "true" ? {} : { userId: req.user._id };
  const bookings = await Booking.find(query).sort({ createdAt: -1 }).lean();
  res.json(bookings.map(booking => safeBooking(booking)));
});
app.post("/api/bookings/claim-guest", requireAuth, requireAjax, async (req, res) => {
  const tokens = Array.isArray(req.body.guestTokens) ? req.body.guestTokens.slice(0, 30) : [];
  const hashes = tokens.filter(token => typeof token === "string" && token.length >= 32 && token.length <= 200).map(hashGuestToken);
  if (!hashes.length) return res.json({ claimed: 0 });
  const result = await Booking.updateMany(
    { guestTokenHash: { $in: hashes }, $or: [{ userId: { $exists: false } }, { userId: null }] },
    { $set: { userId: req.user._id, customerName: req.user.name }, $unset: { guestTokenHash: "" } }
  );
  res.json({ claimed: result.modifiedCount || 0 });
});
app.post("/api/bookings", attachOptionalAuth, requireAjax, async (req, res) => {
  await expireBookings();
  const { locationId, floorId, slotId } = req.body;
  const durationMinutes = validDuration(req.body.durationMinutes);
  if (!locationId || !floorId || !slotId || !durationMinutes) {
    return res.status(400).json({ message: "Choose a slot and a duration from 30 minutes to 12 hours (in 30-minute steps)." });
  }
  const arrival = new Date();
  const departure = new Date(arrival.getTime() + durationMinutes * 60000);
  const location = await Location.findOne({ id: locationId, active: true });
  const floor = location?.floors.find(f => f.id === floorId);
  const slot = floor?.slots.find(s => s.id === slotId);
  if (!location || !floor || !slot) return res.status(404).json({ message: "Selected parking space was not found." });
  const update = await Location.updateOne(
    { id: locationId, active: true, floors: { $elemMatch: { id: floorId, slots: { $elemMatch: { id: slotId, status: "available" } } } } },
    { $set: { "floors.$[floor].slots.$[slot].status": "booked" } },
    { arrayFilters: [{ "floor.id": floorId }, { "slot.id": slotId, "slot.status": "available" }] }
  );
  if (!update.modifiedCount) return res.status(409).json({ message: "This slot was just taken. Please choose another available slot." });
  const guestToken = req.user ? null : randomBytes(32).toString("hex");
  try {
    const reference = `SP-${Date.now().toString().slice(-6)}-${randomUUID().slice(0, 3).toUpperCase()}`;
    const booking = await Booking.create({
      reference,
      ...(req.user ? { userId: req.user._id } : { guestTokenHash: hashGuestToken(guestToken) }),
      customerName: req.user?.name || "Guest",
      locationId, locationName: location.name, floorId, floorName: floor.name, slotId,
      estimatedArrival: arrival, estimatedDeparture: departure, durationMinutes, status: "confirmed"
    });
    res.status(201).json(safeBooking(booking, guestToken ? { guestToken } : {}));
  } catch (error) {
    await Location.updateOne({ id: locationId }, { $set: { "floors.$[floor].slots.$[slot].status": "available" } }, { arrayFilters: [{ "floor.id": floorId }, { "slot.id": slotId, "slot.status": "booked" }] });
    throw error;
  }
});
app.post("/api/bookings/:id/extend", attachOptionalAuth, requireAjax, async (req, res) => {
  const extraMinutes = validDuration(req.body.extraMinutes);
  if (!extraMinutes) return res.status(400).json({ message: "Choose an extension from 30 minutes to 12 hours, in 30-minute steps." });
  const booking = await Booking.findById(req.params.id).select("+guestTokenHash");
  if (!booking || !(await canManageBooking(req, booking, req.body.guestToken))) return res.status(404).json({ message: "Booking not found or you do not have access to it." });
  if (booking.status !== "confirmed" || booking.estimatedDeparture <= new Date()) return res.status(409).json({ message: "This booking has ended and can no longer be extended." });
  const newEnd = new Date(booking.estimatedDeparture.getTime() + extraMinutes * 60000);
  booking.estimatedDeparture = newEnd;
  booking.durationMinutes += extraMinutes;
  await booking.save();
  res.json(safeBooking(booking));
});
app.post("/api/bookings/:id/end", attachOptionalAuth, requireAjax, async (req, res) => {
  const booking = await Booking.findById(req.params.id).select("+guestTokenHash");
  if (!booking || !(await canManageBooking(req, booking, req.body.guestToken))) return res.status(404).json({ message: "Booking not found or you do not have access to it." });
  if (booking.status !== "confirmed") return res.json(safeBooking(booking));
  booking.status = "completed";
  booking.estimatedDeparture = new Date();
  await booking.save();
  await releaseSlot(booking);
  res.json(safeBooking(booking));
});
app.patch("/api/bookings/:id/cancel", attachOptionalAuth, requireAjax, async (req, res) => {
  const booking = await Booking.findById(req.params.id).select("+guestTokenHash");
  if (!booking || !(await canManageBooking(req, booking, req.body.guestToken))) return res.status(404).json({ message: "Booking not found or you do not have access to it." });
  if (booking.status !== "confirmed") return res.json(safeBooking(booking));
  booking.status = "cancelled";
  booking.estimatedDeparture = new Date();
  await booking.save();
  await releaseSlot(booking);
  res.json(safeBooking(booking));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err?.code === 11000) return res.status(409).json({ message: "This record already exists." });
  res.status(500).json({ message: "Unexpected server error. Check the backend terminal for details." });
});

async function start() {
  if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
    console.error("Set a strong JWT_SECRET (at least 32 characters) before running in production.");
    process.exit(1);
  }
  if (!MONGODB_URI || /YOUR_CLUSTER|YOUR_DB_USER|YOUR_DB_PASSWORD|<db_password>/i.test(MONGODB_URI)) {
    console.error("MONGODB_URI is missing or still contains placeholders. Add your real MongoDB Atlas connection string to backend/.env.");
    process.exit(1);
  }
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB.");
    if (await Location.countDocuments() === 0) {
      let initialLocations = seedLocations;
      try {
        const legacy = JSON.parse(await fs.readFile(path.join(backendDir, "data", "db.json"), "utf8"));
        if (Array.isArray(legacy.locations) && legacy.locations.length) {
          initialLocations = legacy.locations.map(({ _id, ...item }) => item);
          console.log("Importing existing local JSON location configuration into MongoDB.");
        }
      } catch { /* no legacy local database; use the initial demo locations */ }
      await Location.insertMany(initialLocations);
      console.log("Initial parking locations are ready with all demo slots available.");
    }
    await expireBookings();
    await normalizeLegacySlots();
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
      let existingAdmin = await User.findOne({ email });
      if (!existingAdmin) {
        const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
        existingAdmin = await User.create({ name: process.env.ADMIN_NAME || "SmartPark Admin", email, passwordHash, role: "admin" });
        console.log(`Initial admin account created for ${email}.`);
      } else if (existingAdmin.role !== "admin") {
        existingAdmin.role = "admin";
        await existingAdmin.save();
        console.log(`Granted the configured bootstrap admin role to ${email}.`);
      }
    }
    const expiryTimer = setInterval(() => expireBookings().catch(error => console.error("Booking expiry check failed:", error.message)), 15000);
    expiryTimer.unref?.();
    app.listen(PORT, () => console.log(`Smart Parking API listening on http://localhost:${PORT}`));
  } catch (error) {
    console.error("Could not start SmartPark API:", error.message);
    if (error?.code === "ENOTFOUND" || error?.message?.includes("querySrv")) {
      console.error("MongoDB DNS lookup failed. Re-check the Atlas cluster hostname in MONGODB_URI, your internet/DNS connection, and the Atlas network access list.");
    }
    process.exit(1);
  }
}
start();
