import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Html5Qrcode } from "html5-qrcode";
import {
  ArrowRight, CarFront, CheckCircle2, Clock3, MapPin, ParkingCircle, Plus,
  ShieldCheck, Ticket, X, LayoutDashboard, History, Building2, Power,
  QrCode, Camera, Download, ScanLine, LogIn, LogOut, UserRound, RefreshCw
} from "lucide-react";

const API = (import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:5000/api`).replace(/\/$/, "");
const GUEST_BOOKINGS_KEY = "smartpark_guest_bookings_v1";

function readGuestBookings() {
  try {
    const value = JSON.parse(window.localStorage.getItem(GUEST_BOOKINGS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function writeGuestBookings(bookings) {
  try { window.localStorage.setItem(GUEST_BOOKINGS_KEY, JSON.stringify(bookings)); } catch { /* storage may be disabled */ }
}
function formatRemaining(endTime, now) {
  const totalSeconds = Math.max(0, Math.floor((new Date(endTime).getTime() - now) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map(value => String(value).padStart(2, "0")).join(":");
}
function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function App() {
  const [locations, setLocations] = useState([]);
  const [allLocations, setAllLocations] = useState([]);
  const [locationId, setLocationId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [selected, setSelected] = useState("");
  const [bookings, setBookings] = useState([]);
  const [guestBookings, setGuestBookings] = useState(readGuestBookings);
  const [tab, setTab] = useState("customer");
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [form, setForm] = useState({ name: "", area: "", type: "Mall", publicInfo: "" });
  const [floorForm, setFloorForm] = useState({ name: "", vehicleType: "Car", slotCount: 12 });
  const [scannerOpen, setScannerOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authBusy, setAuthBusy] = useState(false);
  const [durationChoice, setDurationChoice] = useState("60");
  const [customDuration, setCustomDuration] = useState("90");
  const deepLinkHandled = useRef(false);

  async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest", ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Request failed");
    return data;
  }

  async function refresh({ quiet = false } = {}) {
    if (quiet) setRefreshing(true);
    try {
      const active = await request("/locations");
      setLocations(active);
      const auth = await request("/auth/me").catch(() => null);
      const currentUser = auth?.user || null;
      setUser(currentUser);
      if (currentUser) {
        const savedGuestBookings = readGuestBookings();
        const guestTokens = savedGuestBookings.map(item => item.guestToken).filter(Boolean);
        if (guestTokens.length) {
          try {
            await request("/bookings/claim-guest", { method: "POST", body: JSON.stringify({ guestTokens }) });
            writeGuestBookings([]);
            setGuestBookings([]);
          } catch { /* keep guest records locally if claiming fails */ }
        }
        const history = await request("/bookings");
        setBookings(history);
      } else {
        setBookings([]);
      }
      if (currentUser?.role === "admin") {
        const adminLocations = await request("/admin/locations");
        setAllLocations(adminLocations);
      } else {
        setAllLocations([]);
      }
      setLocationId(current => active.some(location => location.id === current) ? current : (active[0]?.id || ""));
      setLastUpdated(new Date());
    } catch (error) {
      if (!quiet) setNotice(`Could not connect to the backend: ${error.message}. Check the backend terminal and MongoDB connection.`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => refresh({ quiet: true }), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (deepLinkHandled.current || !locations.length) return;
    const requestedId = new URLSearchParams(window.location.search).get("location");
    if (!requestedId) { deepLinkHandled.current = true; return; }
    const match = locations.find(location => location.id === requestedId);
    if (match) {
      setLocationId(match.id);
      setTab("customer");
      setNotice(`QR link opened: ${match.name}. Check availability and book without signing in.`);
      window.setTimeout(() => document.getElementById("parking-selection")?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
    } else {
      setNotice("This QR code does not match an active parking location.");
    }
    deepLinkHandled.current = true;
  }, [locations]);

  const location = locations.find(item => item.id === locationId);
  const floor = location?.floors.find(item => item.id === floorId) || location?.floors[0];
  useEffect(() => {
    if (location?.floors?.length) setFloorId(location.floors[0].id);
    setSelected("");
  }, [locationId]);

  const locationStats = useMemo(() => {
    const slots = location?.floors?.flatMap(item => item.slots) || [];
    const available = slots.filter(slot => slot.status === "available").length;
    return { total: slots.length, available, occupied: slots.length - available };
  }, [location]);
  const floorStats = useMemo(() => {
    const slots = floor?.slots || [];
    const available = slots.filter(slot => slot.status === "available").length;
    return { total: slots.length, available, occupied: slots.length - available };
  }, [floor]);
  const available = floorStats.available;
  const selectedDuration = durationChoice === "custom" ? Number(customDuration) : Number(durationChoice);
  const durationValid = Number.isInteger(selectedDuration) && selectedDuration >= 30 && selectedDuration <= 720 && selectedDuration % 30 === 0;

  async function book() {
    if (!selected || !location || !floor || !durationValid) return;
    try {
      const booking = await request("/bookings", {
        method: "POST",
        body: JSON.stringify({ locationId: location.id, floorId: floor.id, slotId: selected, durationMinutes: selectedDuration })
      });
      if (booking.guestToken) {
        const nextGuestBookings = [booking, ...readGuestBookings().filter(item => item.id !== booking.id)];
        writeGuestBookings(nextGuestBookings);
        setGuestBookings(nextGuestBookings);
      }
      setNotice(`Booking confirmed! Your reference is ${booking.reference}. Your ${selectedDuration}-minute parking timer has started.`);
      setSelected("");
      await refresh({ quiet: true });
    } catch (error) {
      setNotice(error.message);
      await refresh({ quiet: true });
    }
  }

  async function extendBooking(booking, extraMinutes) {
    try {
      const updated = await request(`/bookings/${booking.id}/extend`, {
        method: "POST",
        body: JSON.stringify({ extraMinutes, ...(booking.guestToken ? { guestToken: booking.guestToken } : {}) })
      });
      if (booking.guestToken) {
        const next = readGuestBookings().map(item => item.id === booking.id ? { ...updated, guestToken: booking.guestToken } : item);
        writeGuestBookings(next);
        setGuestBookings(next);
      } else {
        await refresh({ quiet: true });
      }
      setNotice(`Parking extended by ${extraMinutes} minutes. New end time: ${formatDate(updated.estimatedDeparture)}.`);
    } catch (error) {
      setNotice(error.message);
      await refresh({ quiet: true });
    }
  }

  async function endBooking(booking) {
    try {
      await request(`/bookings/${booking.id}/end`, {
        method: "POST",
        body: JSON.stringify(booking.guestToken ? { guestToken: booking.guestToken } : {})
      });
      if (booking.guestToken) {
        const next = readGuestBookings().map(item => item.id === booking.id ? { ...item, status: "completed", estimatedDeparture: new Date().toISOString() } : item);
        writeGuestBookings(next);
        setGuestBookings(next);
      } else {
        await refresh({ quiet: true });
      }
      setNotice("Parking ended. The slot is now available for the next customer.");
      await refresh({ quiet: true });
    } catch (error) {
      setNotice(error.message);
      await refresh({ quiet: true });
    }
  }

  async function cancelBooking(booking) {
    try {
      await request(`/bookings/${booking.id}/cancel`, {
        method: "PATCH",
        body: JSON.stringify(booking.guestToken ? { guestToken: booking.guestToken } : {})
      });
      if (booking.guestToken) {
        const next = readGuestBookings().map(item => item.id === booking.id ? { ...item, status: "cancelled" } : item);
        writeGuestBookings(next);
        setGuestBookings(next);
      }
      setNotice("Booking cancelled and the slot is available again.");
      await refresh({ quiet: true });
    } catch (error) { setNotice(error.message); }
  }

  function handleQrScan(decodedText) {
    let scannedId = decodedText.trim();
    try {
      const scannedUrl = new URL(decodedText, window.location.origin);
      scannedId = scannedUrl.searchParams.get("location") || scannedId;
    } catch { /* the QR may contain the raw location ID */ }
    const match = locations.find(item => item.id === scannedId);
    setScannerOpen(false);
    if (!match) { setNotice("This QR code is not recognized or the property is inactive."); return; }
    setLocationId(match.id);
    setTab("customer");
    setSelected("");
    setNotice(`QR scanned successfully. Welcome to ${match.name}. Check live availability and book as a guest.`);
    window.history.replaceState({}, "", `/?location=${encodeURIComponent(match.id)}`);
    window.setTimeout(() => document.getElementById("parking-selection")?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
  }

  async function submitAuth(event) {
    event.preventDefault();
    setAuthBusy(true);
    try {
      const endpoint = authMode === "register" ? "/auth/register" : "/auth/login";
      const payload = authMode === "register" ? authForm : { email: authForm.email, password: authForm.password };
      const result = await request(endpoint, { method: "POST", body: JSON.stringify(payload) });
      setUser(result.user);
      setAuthForm({ name: "", email: "", password: "" });
      setNotice(`Welcome${result.user.name ? `, ${result.user.name}` : ""}! You are signed in.`);
      if (result.user.role === "admin") setTab("admin");
      else setTab("history");
      await refresh({ quiet: true });
    } catch (error) { setNotice(error.message); }
    finally { setAuthBusy(false); }
  }

  async function logout() {
    try { await request("/auth/logout", { method: "POST" }); } catch { /* clear local view even if session expired */ }
    setUser(null);
    setBookings([]);
    setAllLocations([]);
    setTab("customer");
    setNotice("You have been logged out.");
  }

  async function addLocation(event) {
    event.preventDefault();
    try {
      await request("/admin/locations", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", area: "", type: "Mall", publicInfo: "" });
      setNotice("Location added.");
      await refresh({ quiet: true });
    } catch (error) { setNotice(error.message); }
  }

  async function toggleLocation(item) {
    try {
      await request(`/admin/locations/${item.id}`, { method: "PATCH", body: JSON.stringify({ active: !item.active }) });
      setNotice(`${item.name} ${item.active ? "deactivated" : "activated"}.`);
      await refresh({ quiet: true });
    } catch (error) { setNotice(error.message); }
  }

  async function addFloor(event) {
    event.preventDefault();
    try {
      await request(`/admin/locations/${locationId}/floors`, { method: "POST", body: JSON.stringify(floorForm) });
      setFloorForm({ name: "", vehicleType: "Car", slotCount: 12 });
      setNotice("Parking level added.");
      await refresh({ quiet: true });
    } catch (error) { setNotice(error.message); }
  }

  function chooseLocation(id) {
    setLocationId(id);
    setSelected("");
    setTab("customer");
    window.setTimeout(() => document.getElementById("parking-selection")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }

  const visibleGuestBookings = guestBookings.filter(item => item.status === "confirmed");
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#top"><span className="brand-mark"><ParkingCircle size={23} /></span><span>smart<span className="brand-light">park</span></span></a>
      <nav>
        <button className={tab === "customer" ? "nav-active" : ""} onClick={() => setTab("customer")}>Find parking</button>
        <button className={tab === "history" ? "nav-active" : ""} onClick={() => user ? setTab("history") : (setTab("login"), setAuthMode("login"))}>My bookings</button>
        {user?.role === "admin" && <button className={tab === "admin" ? "nav-active" : ""} onClick={() => setTab("admin")}>Admin</button>}
      </nav>
      <div className="account-area">
        {user ? <><span className="guest-pill"><UserRound size={13} /> {user.name} · {user.role}</span><button className="account-button" onClick={logout}><LogOut size={15} /> Logout</button></> : <button className="account-button" onClick={() => { setTab("login"); setAuthMode("login"); }}><LogIn size={15} /> Login</button>}
      </div>
    </header>
    <main id="top">
      <section className="hero">
        <div><div className="eyebrow"><ShieldCheck size={14} /> SMART PARKING · HYDERABAD</div><h1>Arrive with a<br /><span>space waiting.</span></h1><p>Scan a property QR code, check live booking availability and reserve a parking space for the time you need. No account required to book.</p><div className="hero-points"><span><CheckCircle2 size={16} /> QR-based availability</span><span><CheckCircle2 size={16} /> Book as a guest</span></div></div>
        <div className="hero-card"><div className="hero-card-top"><span>YOUR PARKING, SIMPLIFIED</span><ParkingCircle size={22} /></div><div className="hero-parking"><div className="hero-p">P</div><CarFront size={86} /></div><div className="hero-card-bottom"><span className="live-dot" /> Live slot refresh · every 5 seconds</div></div>
      </section>
      {notice && <div className={`notice ${notice.startsWith("Booking confirmed!") ? "notice-success" : ""}`}><span>{notice.startsWith("Booking confirmed!") ? <><strong>Booking confirmed!</strong><span className="notice-reference-label">Your booking reference</span><span className="notice-reference">{notice.match(/SP-[A-Z0-9-]+/)?.[0] || "Confirmed"}</span><span className="notice-hint">Keep this number safe. Your parking timer has started.</span></> : notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={16} /></button></div>}
      {loading ? <div className="loading">Loading SmartPark…</div> : tab === "login" ? <section className="content-section auth-section" id="account-access">
        <div className="section-heading"><div><div className="eyebrow">YOUR SMARTPARK ACCOUNT</div><h2>{authMode === "login" ? "Welcome back" : "Create your account"}</h2><p>Sign in or register to view your booking history. You can reserve parking without an account.</p></div><ShieldCheck size={28} /></div>
        <form className="auth-card" onSubmit={submitAuth}>
          <div className="auth-switch"><button type="button" className={authMode === "login" ? "selected" : ""} onClick={() => setAuthMode("login")}>Login</button><button type="button" className={authMode === "register" ? "selected" : ""} onClick={() => setAuthMode("register")}>Create account</button></div>
          {authMode === "register" && <label>Full name<input required maxLength="80" value={authForm.name} onChange={event => setAuthForm({ ...authForm, name: event.target.value })} placeholder="Your name" /></label>}
          <label>Email address<input type="email" required autoComplete="email" value={authForm.email} onChange={event => setAuthForm({ ...authForm, email: event.target.value })} placeholder="you@example.com" /></label>
          <label>Password<input type="password" required minLength="8" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={authForm.password} onChange={event => setAuthForm({ ...authForm, password: event.target.value })} placeholder="At least 8 characters" /></label>
          <button className="primary-button auth-submit" disabled={authBusy}>{authBusy ? "Please wait…" : authMode === "login" ? "Login" : "Create account"} <ArrowRight size={16} /></button>
          <p className="auth-note">Guest bookings made in this browser will be linked to your account after you sign in or register.</p>
        </form>
      </section> : tab === "customer" ? <section className="content-section">
        <div className="section-heading"><div><div className="eyebrow">FIND YOUR SPACE</div><h2>Choose a location</h2><p>Select a property or scan its entrance QR code to view parking availability.</p></div><div className="customer-tools"><button className="secondary-button" onClick={() => setScannerOpen(true)}><Camera size={16} /> Scan entrance QR</button><div className="count-chip">{locations.length} active locations</div></div></div>
        <div className="location-grid">{locations.map((item, index) => {
          const slots = item.floors.flatMap(itemFloor => itemFloor.slots);
          const free = slots.filter(slot => slot.status === "available").length;
          return <button key={item.id} onClick={() => chooseLocation(item.id)} className={`location-card ${locationId === item.id ? "chosen" : ""}`}><div className={`location-art art-${index % 3}`}><span>{item.type}</span><Building2 size={44} /></div><div className="location-card-body"><h3>{item.name}</h3><p><MapPin size={14} />{item.area}</p><div className="location-meta"><span>{item.floors.length} parking levels</span><span>{free} / {slots.length} free</span></div></div></button>;
        })}
          {!locations.length && <p>No active parking locations yet. Ask an administrator to activate a location.</p>}</div>
        {location && <div className="parking-panel" id="parking-selection">
          <div className="panel-head"><div><div className="eyebrow">LIVE PARKING AVAILABILITY</div><h2>{location.name}</h2><p><MapPin size={14} />{location.area}</p></div><label className="floor-picker">Parking level<select value={floor?.id || ""} onChange={event => { setFloorId(event.target.value); setSelected(""); }}>{location.floors.map(itemFloor => <option key={itemFloor.id} value={itemFloor.id}>{itemFloor.name}</option>)}</select></label></div>
          <div className="data-note"><strong>Facility information:</strong> {location.publicInfo || "No public facility details added."} <span>{location.dataNote}</span></div>
          <div className="live-status"><span><i className="live-dot" /> Live availability</span><small>{lastUpdated ? `Last checked ${lastUpdated.toLocaleTimeString()}` : "Checking…"} · auto refresh 5 sec <button onClick={() => refresh({ quiet: true })} aria-label="Refresh availability" disabled={refreshing}><RefreshCw size={13} className={refreshing ? "spin" : ""} /></button></small></div>
          <div className="availability-cards">
            <article className="availability-card"><span>Total spaces</span><strong>{locationStats.total}</strong><small>Across all levels</small></article>
            <article className="availability-card available-card"><span>Available</span><strong>{locationStats.available}</strong><small>Ready to reserve</small></article>
            <article className="availability-card occupied-card"><span>Booked / occupied</span><strong>{locationStats.occupied}</strong><small>Currently reserved</small></article>
          </div>
          <div className="floor-availability"><strong>{floor?.name || "Selected level"}</strong><span>{floorStats.available} available of {floorStats.total} spaces</span></div>
          <div className="slot-summary"><span><i className="dot available" /> Available</span><span><i className="dot booked" /> Booked</span><span><i className="dot selected-dot" /> Selected</span><b>{available} spaces available on this level</b></div>
          <div className="slot-grid">{floor?.slots.map(slot => <button key={slot.id} disabled={slot.status !== "available"} onClick={() => setSelected(slot.id === selected ? "" : slot.id)} className={`slot ${slot.status !== "available" ? "unavailable" : ""} ${selected === slot.id ? "selected" : ""}`}><CarFront size={20} /><span>{slot.id}</span><small>{slot.status === "available" ? "Available" : "Booked"}</small></button>)}</div>
          <div className="duration-picker"><div><strong>How long do you need this space?</strong><small>Your parking timer starts as soon as the booking is confirmed.</small></div><div className="duration-options"><button type="button" className={durationChoice === "30" ? "selected-duration" : ""} onClick={() => setDurationChoice("30")}>30 min</button><button type="button" className={durationChoice === "60" ? "selected-duration" : ""} onClick={() => setDurationChoice("60")}>1 hour</button><button type="button" className={durationChoice === "120" ? "selected-duration" : ""} onClick={() => setDurationChoice("120")}>2 hours</button><button type="button" className={durationChoice === "180" ? "selected-duration" : ""} onClick={() => setDurationChoice("180")}>3 hours</button><button type="button" className={durationChoice === "custom" ? "selected-duration" : ""} onClick={() => setDurationChoice("custom")}>Custom</button></div>{durationChoice === "custom" && <label className="custom-duration">Custom duration (minutes)<input type="number" min="30" max="720" step="30" value={customDuration} onChange={event => setCustomDuration(event.target.value)} /></label>}</div>
          <div className="booking-action"><div><Ticket size={20} /><span><strong>{selected ? `Slot ${selected} selected` : "Select an available slot"}</strong><small>{selected ? `${location.name} · ${floor?.name}` : "Choose a green slot to continue"}</small></span></div><button className="primary-button" disabled={!selected || !durationValid} onClick={book}>Book for {durationValid ? (selectedDuration >= 60 ? `${selectedDuration / 60} hr${selectedDuration >= 120 ? "s" : ""}` : `${selectedDuration} min`) : "selected duration"} <ArrowRight size={16} /></button></div>
          <p className="booking-login-note">No login required. You can extend your booking later or end parking early.</p>
        </div>}
        {visibleGuestBookings.length > 0 && <section className="guest-bookings-section"><div className="section-heading"><div><div className="eyebrow">GUEST RESERVATIONS</div><h2>Your active parking</h2><p>These bookings are saved in this browser. Sign in later to add them to your account history.</p></div><Ticket size={26} /></div><div className="history-list">{visibleGuestBookings.map(booking => <BookingCard key={booking.id} booking={booking} now={now} onExtend={extendBooking} onEnd={endBooking} onCancel={cancelBooking} />)}</div></section>}
      </section> : tab === "history" ? <section className="content-section"><div className="section-heading"><div><div className="eyebrow">YOUR ACTIVITY</div><h2>My bookings</h2><p>Your guest bookings from this browser are linked to your account.</p></div><History size={28} /></div><div className="history-list">{bookings.length ? bookings.map(booking => <BookingCard key={booking.id} booking={booking} now={now} onExtend={extendBooking} onEnd={endBooking} onCancel={cancelBooking} />) : <div className="empty-state"><Ticket size={32} /><h3>No bookings yet</h3><p>Your confirmed reservations will appear here after you book a space.</p><button className="primary-button" onClick={() => setTab("customer")}>Find parking</button></div>}</div></section> : <section className="content-section">
        <div className="section-heading"><div><div className="eyebrow">PROPERTY CONTROL</div><h2>Admin dashboard</h2><p>Manage participating properties and parking levels. Admin access is role-protected.</p></div><LayoutDashboard size={28} /></div>
        {user?.role === "admin" ? <><div className="admin-layout"><div className="admin-card"><h3><Plus size={18} /> Add a location</h3><form onSubmit={addLocation} className="admin-form"><label>Property name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="e.g. City Centre Mall" /></label><label>Area / address<input required value={form.area} onChange={event => setForm({ ...form, area: event.target.value })} placeholder="e.g. Gachibowli, Hyderabad" /></label><label>Property type<select value={form.type} onChange={event => setForm({ ...form, type: event.target.value })}><option>Mall</option><option>Hospital</option></select></label><label>Public facility information<textarea value={form.publicInfo} onChange={event => setForm({ ...form, publicInfo: event.target.value })} placeholder="Add verified parking details, if available." /></label><button className="primary-button">Add location <Plus size={16} /></button></form></div>
          <div className="admin-card"><h3><Building2 size={18} /> Existing locations</h3><div className="admin-location-list">{allLocations.map(item => <div className="admin-location" key={item.id}><div><strong>{item.name}</strong><small>{item.area} · {item.floors.length} levels</small></div><button className={`toggle-button ${item.active ? "on" : ""}`} onClick={() => toggleLocation(item)}><Power size={15} />{item.active ? "Active" : "Inactive"}</button></div>)}</div>
            <h3 className="subheading"><QrCode size={17} /> Entrance QR codes</h3><p className="qr-intro">Download and display each QR code at its property's entrance. Scanning opens that property's live availability dashboard. Set VITE_PUBLIC_APP_URL before generating QR codes for a deployed site.</p><div className="qr-card-grid">{allLocations.map(item => <LocationQrCard key={item.id} location={item} />)}</div>
            <h3 className="subheading">Add a parking level</h3><form className="admin-form compact" onSubmit={addFloor}><label>Location<select value={locationId} onChange={event => setLocationId(event.target.value)}>{allLocations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Level name<input required value={floorForm.name} onChange={event => setFloorForm({ ...floorForm, name: event.target.value })} placeholder="e.g. Basement 2" /></label><div className="form-row"><label>Vehicle<select value={floorForm.vehicleType} onChange={event => setFloorForm({ ...floorForm, vehicleType: event.target.value })}><option>Car</option><option>Bike</option></select></label><label>Slots<input type="number" min="1" max="60" value={floorForm.slotCount} onChange={event => setFloorForm({ ...floorForm, slotCount: event.target.value })} /></label></div><button className="primary-button" disabled={!locationId}>Add parking level <Plus size={16} /></button></form></div></div><p className="admin-warning">Admin actions require a verified admin account. Never share your admin password or publish it in frontend code.</p></> : <div className="empty-state"><ShieldCheck size={32} /><h3>Admin sign-in required</h3><p>This area is available only to accounts with the admin role.</p><button className="primary-button" onClick={() => { setTab("login"); setAuthMode("login"); }}>Login as admin</button></div>}
      </section>}
    </main>
    {scannerOpen && <QrScanner onScan={handleQrScan} onClose={() => setScannerOpen(false)} />}
    <footer className="footer"><span className="brand"><ParkingCircle size={20} /> smart<span className="brand-light">park</span></span><span>Smart parking demo · Hyderabad</span><span>Availability is based on active bookings</span></footer>
  </div>;
}

function BookingCard({ booking, now, onExtend, onEnd, onCancel }) {
  const active = booking.status === "confirmed" && new Date(booking.estimatedDeparture).getTime() > now;
  const statusLabel = active ? "Active" : booking.status === "confirmed" ? "Expired" : booking.status;
  return <article className="history-card booking-history-card">
    <div className="history-icon"><Ticket /></div>
    <div className="history-info"><h3>{booking.locationName}</h3><p>{booking.floorName} · Slot {booking.slotId} · {formatDate(booking.createdAt)}</p><small>Reference: <strong>{booking.reference}</strong></small><small>Started: {formatDate(booking.estimatedArrival)} · Ends: {formatDate(booking.estimatedDeparture)}</small>{active && <div className="booking-countdown"><Clock3 size={15} /><span>Time remaining</span><strong>{formatRemaining(booking.estimatedDeparture, now)}</strong></div>}</div>
    <div className="history-status"><span className={active ? "status-confirmed" : booking.status === "cancelled" ? "status-cancelled" : "status-finished"}>{statusLabel}</span>{active && <div className="booking-controls"><button className="text-button" onClick={() => onExtend(booking, 30)}>+30 min</button><button className="text-button" onClick={() => onExtend(booking, 60)}>+1 hour</button><button className="text-button" onClick={() => onExtend(booking, 120)}>+2 hours</button><button className="end-parking-button" onClick={() => onEnd(booking)}>End parking</button><button className="text-button cancel-booking-button" onClick={() => onCancel(booking)}>Cancel booking</button></div>}</div>
  </article>;
}

function LocationQrCard({ location }) {
  const [qrData, setQrData] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const publicBase = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, "");
    const target = `${publicBase}/?location=${encodeURIComponent(location.id)}`;
    QRCode.toDataURL(target, { width: 240, margin: 2, errorCorrectionLevel: "H", color: { dark: "#173b63", light: "#ffffff" } })
      .then(data => { if (active) { setQrData(data); setError(""); } })
      .catch(() => { if (active) setError("Could not generate QR code."); });
    return () => { active = false; };
  }, [location.id]);
  const fileName = `${location.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-parking-qr.png`;
  return <article className="qr-card"><div className="qr-card-image">{qrData ? <img src={qrData} alt={`Parking entrance QR code for ${location.name}`} /> : <span>{error || "Generating QR…"}</span>}</div><div className="qr-card-details"><strong>{location.name}</strong><small>{location.active ? "Active property" : "Inactive property"}</small>{qrData ? <a className="qr-download" href={qrData} download={fileName}><Download size={14} /> Download QR</a> : null}</div></article>;
}

function QrScanner({ onScan, onClose }) {
  const [cameraError, setCameraError] = useState("");
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  useEffect(() => {
    const scanner = new Html5Qrcode("smartpark-qr-reader");
    let active = true;
    let started = false;
    let scanHandled = false;
    scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 230, height: 230 }, aspectRatio: 1.0 }, decodedText => {
      if (active && !scanHandled) { scanHandled = true; onScanRef.current(decodedText); }
    }, () => {}).then(() => {
      started = true;
      if (!active) scanner.stop().then(() => scanner.clear()).catch(() => {});
    }).catch(() => {
      if (active) setCameraError("Camera could not start. Allow camera access, use HTTPS or localhost, and try again.");
    });
    return () => { active = false; if (started) scanner.stop().then(() => scanner.clear()).catch(() => {}); };
  }, []);
  return <div className="scanner-backdrop" role="presentation" onClick={onClose}><section className="scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title" onClick={event => event.stopPropagation()}><div className="scanner-heading"><div><span className="eyebrow"><ScanLine size={14} /> SMARTPARK SCANNER</span><h2 id="scanner-title">Scan entrance QR</h2><p>Point your camera at a SmartPark property QR code.</p></div><button className="scanner-close" onClick={onClose} aria-label="Close scanner"><X size={19} /></button></div><div id="smartpark-qr-reader" className="qr-reader" />{cameraError && <p className="scanner-error">{cameraError}</p>}<p className="scanner-help">Scanning opens the selected property's live availability. You can book a slot without signing in.</p></section></div>;
}
