import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ============================================================
// Firebase Realtime Database Module (CDN-loaded)
// ============================================================

let firebaseApp = null;
let firebaseDb = null;
let firebaseReady = false;

const FB_SCRIPT_URLS = [
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js",
];

function loadFirebaseScripts() {
  return Promise.all(
    FB_SCRIPT_URLS.map(
      (url) =>
        new Promise((resolve, reject) => {
          if (document.querySelector(`script[src="${url}"]`)) return resolve();
          const s = document.createElement("script");
          s.src = url;
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        })
    )
  );
}

async function initFirebase(config) {
  if (!config || !config.databaseURL) return false;
  try {
    await loadFirebaseScripts();
    const firebase = window.firebase;
    if (!firebase) return false;
    if (firebaseApp) {
      try { firebaseApp.delete(); } catch {}
    }
    firebaseApp = firebase.initializeApp(config, "clinic-booking-" + Date.now());
    firebaseDb = firebase.database(firebaseApp);
    firebaseReady = true;
    return true;
  } catch (e) {
    console.error("Firebase init error:", e);
    firebaseReady = false;
    return false;
  }
}

function fbRef(path) {
  if (!firebaseReady || !firebaseDb) return null;
  return firebaseDb.ref(path);
}

function fbSet(path, data) {
  const ref = fbRef(path);
  if (!ref) return Promise.resolve();
  return ref.set(data);
}

function fbOnValue(path, cb) {
  const ref = fbRef(path);
  if (!ref) return () => {};
  const handler = (snap) => cb(snap.val());
  ref.on("value", handler);
  return () => ref.off("value", handler);
}

// ============================================================
// Utility helpers
// ============================================================
const DAYS_JP = ["æ¥", "æ", "ç«", "æ°´", "æ¨", "é", "å"];
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const dayOfWeek = (s) => parseDate(s).getDay();
const timeToMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

// Japanese holidays 2025-2027
const HOLIDAYS_FIXED = [
  { name: "åæ¥", month: 1, day: 1 }, { name: "å»ºå½è¨å¿µã®æ¥", month: 2, day: 11 },
  { name: "å¤©çèªçæ¥", month: 2, day: 23 }, { name: "æ­åã®æ¥", month: 4, day: 29 },
  { name: "æ²æ³è¨å¿µæ¥", month: 5, day: 3 }, { name: "ã¿ã©ãã®æ¥", month: 5, day: 4 },
  { name: "ãã©ãã®æ¥", month: 5, day: 5 }, { name: "å±±ã®æ¥", month: 8, day: 11 },
  { name: "æåã®æ¥", month: 11, day: 3 }, { name: "å¤å´æè¬ã®æ¥", month: 11, day: 23 },
];

function getHappyMonday(year, month, weekNum) {
  const first = new Date(year, month - 1, 1);
  let day = first.getDay();
  let firstMon = day <= 1 ? 1 + (1 - day) : 1 + (8 - day);
  return firstMon + (weekNum - 1) * 7;
}

function getJPHolidays(year) {
  const list = [];
  HOLIDAYS_FIXED.forEach((h) => list.push({ name: h.name, date: `${year}-${pad(h.month)}-${pad(h.day)}` }));
  list.push({ name: "æäººã®æ¥", date: `${year}-01-${pad(getHappyMonday(year, 1, 2))}` });
  list.push({ name: "æµ·ã®æ¥", date: `${year}-07-${pad(getHappyMonday(year, 7, 3))}` });
  list.push({ name: "ã¹ãã¼ãã®æ¥", date: `${year}-10-${pad(getHappyMonday(year, 10, 2))}` });
  list.push({ name: "æ¬èã®æ¥", date: `${year}-09-${pad(getHappyMonday(year, 9, 3))}` });
  list.push({ name: "æ¥åã®æ¥", date: `${year}-03-20` });
  list.push({ name: "ç§åã®æ¥", date: `${year}-09-23` });
  list.forEach((h) => {
    if (parseDate(h.date).getDay() === 0) {
      const sub = new Date(parseDate(h.date));
      sub.setDate(sub.getDate() + 1);
      const subKey = fmtDate(sub);
      if (!list.find((x) => x.date === subKey)) list.push({ name: "æ¯æ¿ä¼æ¥", date: subKey });
    }
  });
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

// ============================================================
// Storage (localStorage fallback + Firebase sync)
// ============================================================
const LS = {
  get(k, def) { try { const v = localStorage.getItem("clinic_" + k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { localStorage.setItem("clinic_" + k, JSON.stringify(v)); },
};

// ============================================================
// Defaults
// ============================================================
const DEFAULT_SETTINGS = {
  clinicName: "è¨ºçäºç´ç®¡ç",
  amStart: "09:00",
  amEnd: "11:30",
  pmStart: "14:00",
  pmEnd: "19:00",
  closedDays: [0],
  closedDates: [],
  pin: "1234",
  staff: ["äºæ³¢", "å¥¥æ", "ä¸­é", "è½å", "å²¸"],
};

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyC_q-dzMRcBeJTNjB2cX5VghWrNaErftYc",
  authDomain: "clinic-booking-1bde8.firebaseapp.com",
  databaseURL: "https://clinic-booking-1bde8-default-rtdb.firebaseio.com",
  projectId: "clinic-booking-1bde8",
  storageBucket: "clinic-booking-1bde8.firebasestorage.app",
  messagingSenderId: "193521275263",
  appId: "1:193521275263:web:389b55d7ac35337ba5ca4a",
};

function generateSlots(start, end) {
  const slots = [];
  let cur = timeToMin(start);
  const endMin = timeToMin(end);
  while (cur <= endMin) {
    slots.push(`${pad(Math.floor(cur / 60))}:${pad(cur % 60)}`);
    cur += 15;
  }
  return slots;
}

function buildCols(staff) {
  const staffCols = (staff || []).map((name) => ({ id: `staff_${name}`, label: name, type: "éå¸¸" }));
  const rakuCols = [
    { id: "raku_1", label: "æ¥½ãã¬â ", type: "æ¥½ãã¬" },
    { id: "raku_2", label: "æ¥½ãã¬â¡", type: "æ¥½ãã¬" },
  ];
  return [...staffCols, ...rakuCols];
}

// ============================================================
// Custom Hook: useFirebaseSync
// ============================================================
function useFirebaseSync(path, state, setState, isConnected) {
  const isRemoteUpdate = useRef(false);
  const lastSynced = useRef(null);

  // Listen for remote changes
  useEffect(() => {
    if (!isConnected) return;
    const unsub = fbOnValue(path, (val) => {
      if (val !== null && val !== undefined) {
        const json = JSON.stringify(val);
        if (json !== lastSynced.current) {
          isRemoteUpdate.current = true;
          lastSynced.current = json;
          setState(val);
        }
      }
    });
    return unsub;
  }, [path, isConnected, setState]);

  // Push local changes to Firebase
  useEffect(() => {
    if (!isConnected) return;
    if (isRemoteUpdate.current) {
      isRemoteUpdate.current = false;
      return;
    }
    const json = JSON.stringify(state);
    if (json !== lastSynced.current) {
      lastSynced.current = json;
      fbSet(path, state).catch((e) => console.error("Firebase write error:", e));
    }
  }, [state, path, isConnected]);
}

// ============================================================
// Main App
// ============================================================
export default function ClinicBookingApp() {
  const [settings, setSettings] = useState(() => LS.get("settings", DEFAULT_SETTINGS));
  const [bookings, setBookings] = useState(() => LS.get("bookings", {}));
  const [dayOff, setDayOff] = useState(() => LS.get("dayOff", {}));
  const [shifts, setShifts] = useState(() => LS.get("shifts", {}));
  const [loggedIn, setLoggedIn] = useState(false);
  const [screen, setScreen] = useState("calendar");
  const [selectedDate, setSelectedDate] = useState(fmtDate(new Date()));
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [showAddModal, setShowAddModal] = useState(null);
  const [showEditModal, setShowEditModal] = useState(null);
  const [showBlockModal, setShowBlockModal] = useState(false);

  // Firebase state
  const [fbConfig, setFbConfig] = useState(() => LS.get("firebaseConfig", DEFAULT_FIREBASE_CONFIG));
  const [fbConnected, setFbConnected] = useState(false);
  const [fbStatus, setFbStatus] = useState("disconnected"); // disconnected | connecting | connected | error

  // localStorage persistence
  useEffect(() => { LS.set("settings", settings); }, [settings]);
  useEffect(() => { LS.set("bookings", bookings); }, [bookings]);
  useEffect(() => { LS.set("dayOff", dayOff); }, [dayOff]);
  useEffect(() => { LS.set("shifts", shifts); }, [shifts]);
  useEffect(() => { LS.set("firebaseConfig", fbConfig); }, [fbConfig]);

  // Firebase sync hooks
  useFirebaseSync("settings", settings, setSettings, fbConnected);
  useFirebaseSync("bookings", bookings, setBookings, fbConnected);
  useFirebaseSync("dayOff", dayOff, setDayOff, fbConnected);
  useFirebaseSync("shifts", shifts, setShifts, fbConnected);

  // Auto-connect Firebase on mount if config exists
  useEffect(() => {
    if (fbConfig.databaseURL) {
      connectFirebase(fbConfig);
    }
  }, []); // eslint-disable-line

  const connectFirebase = async (config) => {
    setFbStatus("connecting");
    const ok = await initFirebase(config);
    if (ok) {
      setFbConnected(true);
      setFbStatus("connected");
    } else {
      setFbConnected(false);
      setFbStatus("error");
    }
  };

  const disconnectFirebase = () => {
    if (firebaseApp) {
      try { firebaseApp.delete(); } catch {}
    }
    firebaseApp = null;
    firebaseDb = null;
    firebaseReady = false;
    setFbConnected(false);
    setFbStatus("disconnected");
  };

  const holidays = useMemo(() => {
    const h = {};
    [2025, 2026, 2027].forEach((y) => getJPHolidays(y).forEach((hol) => { h[hol.date] = hol.name; }));
    return h;
  }, []);

  const cols = useMemo(() => buildCols(settings.staff), [settings.staff]);

  if (!loggedIn) return <LoginScreen settings={settings} onLogin={() => setLoggedIn(true)} />;

  const commonProps = { settings, setSettings, holidays, bookings, setBookings, dayOff, setDayOff, shifts, setShifts, cols };

  return (
    <div style={S.appContainer}>
      {/* Firebase connection indicator */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 999,
        background: fbStatus === "connected" ? "#22c55e" : fbStatus === "connecting" ? "#fbbf24" : fbStatus === "error" ? "#ef4444" : "#94a3b8",
        transition: "background 0.3s ease",
        maxWidth: 560, margin: "0 auto",
      }} />

      {screen === "calendar" && (
        <CalendarScreen {...commonProps}
          calMonth={calMonth} setCalMonth={setCalMonth}
          onSelectDate={(d) => { setSelectedDate(d); setScreen("day"); }}
          onSettings={() => setScreen("settings")}
          fbStatus={fbStatus}
        />
      )}
      {screen === "day" && (
        <DayScreen {...commonProps}
          date={selectedDate} setDate={setSelectedDate}
          onBack={() => setScreen("calendar")}
          showAddModal={showAddModal} setShowAddModal={setShowAddModal}
          showEditModal={showEditModal} setShowEditModal={setShowEditModal}
          showBlockModal={showBlockModal} setShowBlockModal={setShowBlockModal}
        />
      )}
      {screen === "settings" && (
        <SettingsScreen {...commonProps}
          onBack={() => setScreen("calendar")}
          onLogout={() => { setLoggedIn(false); setScreen("calendar"); }}
          fbConfig={fbConfig} setFbConfig={setFbConfig}
          fbConnected={fbConnected} fbStatus={fbStatus}
          connectFirebase={connectFirebase}
          disconnectFirebase={disconnectFirebase}
        />
      )}
    </div>
  );
}

// ============================================================
// Login
// ============================================================
function LoginScreen({ settings, onLogin }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const handleLogin = useCallback(() => {
    if (pin === settings.pin) { onLogin(); }
    else { setError(true); setShake(true); setTimeout(() => setShake(false), 500); setTimeout(() => setError(false), 2000); }
  }, [pin, settings.pin, onLogin]);

  return (
    <div style={S.loginBg}>
      <div style={S.loginCenter}>
        <div style={{ fontSize: 48, marginBottom: 4 }}>ð¥</div>
        <h1 style={S.loginTitle}>{settings.clinicName}</h1>
        <div style={{ ...S.loginCard, animation: shake ? "shake 0.4s ease" : "none" }}>
          <div style={S.loginLabel}>ã¹ã¿ããã­ã°ã¤ã³</div>
          <div style={S.loginDivider} />
          <input type="password" maxLength={8} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="PINãå¥å" style={S.pinInput} autoFocus />
          {error && <div style={S.errorText}>PINãæ­£ããããã¾ãã</div>}
          <button onClick={handleLogin} onTouchEnd={(e) => { e.preventDefault(); handleLogin(); }} style={S.loginBtn}>ã­ã°ã¤ã³</button>
          <div style={S.pinHint}>åæPIN: 1234</div>
        </div>
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}`}</style>
    </div>
  );
}

// ============================================================
// Calendar
// ============================================================
function CalendarScreen({ calMonth, setCalMonth, settings, holidays, bookings, dayOff, onSelectDate, onSettings, fbStatus }) {
  const { year, month } = calMonth;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = fmtDate(new Date());

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const prevMonth = useCallback(() => setCalMonth((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 }), [setCalMonth]);
  const nextMonth = useCallback(() => setCalMonth((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 }), [setCalMonth]);

  const getDateKey = (d) => `${year}-${pad(month + 1)}-${pad(d)}`;
  const hasBookings = (d) => { const b = bookings[getDateKey(d)]; return b && Object.keys(b).length > 0; };
  const isHoliday = (d) => holidays[getDateKey(d)];
  const isClosed = (d) => {
    const key = getDateKey(d); const dow = parseDate(key).getDay();
    return settings.closedDays.includes(dow) || (settings.closedDates || []).includes(key);
  };
  const isOff = (d) => { const off = dayOff[getDateKey(d)]; return off && off.fullDay; };

  const statusColor = fbStatus === "connected" ? "#22c55e" : fbStatus === "connecting" ? "#fbbf24" : fbStatus === "error" ? "#ef4444" : "#94a3b8";
  const statusLabel = fbStatus === "connected" ? "ð¢ åæä¸­" : fbStatus === "connecting" ? "ð¡ æ¥ç¶ä¸­..." : fbStatus === "error" ? "ð´ æ¥ç¶ã¨ã©ã¼" : "âª ã­ã¼ã«ã«ã®ã¿";

  return (
    <div style={S.screenBg}>
      <div style={S.header}>
        <div style={{ fontSize: 10, color: statusColor, fontWeight: 600, minWidth: 70 }}>{statusLabel}</div>
        <h1 style={S.headerTitle}>{settings.clinicName}</h1>
        <button onClick={onSettings} onTouchEnd={(e) => { e.preventDefault(); onSettings(); }} style={S.settingsBtn}>è¨­å®</button>
      </div>

      <div style={S.monthNav}>
        <button onClick={prevMonth} onTouchEnd={(e) => { e.preventDefault(); prevMonth(); }} style={S.navArrow}>â¹</button>
        <span style={S.monthLabel}>{year}å¹´{month + 1}æ</span>
        <button onClick={nextMonth} onTouchEnd={(e) => { e.preventDefault(); nextMonth(); }} style={S.navArrow}>âº</button>
      </div>

      <div style={S.legend}>
        <span style={S.legendItem}><span style={{ ...S.legendDot, background: "#3b82f6" }} /> éå¸¸æ²»ç</span>
        <span style={S.legendItem}><span style={{ ...S.legendDot, background: "#22c55e" }} /> æ¥½ãã¬</span>
        <span style={S.legendItem}><span style={{ background: "#ef4444", width: 10, height: 10, borderRadius: 2, display: "inline-block" }} /> ç¥æ¥</span>
        <span style={S.legendItem}><span style={{ color: "#9ca3af", fontWeight: 500 }}>â</span> ä¼è¨º</span>
      </div>

      <div style={S.calGrid}>
        {DAYS_JP.map((d, i) => (
          <div key={d} style={{ ...S.calHeader, color: i === 0 ? "#ef4444" : i === 6 ? "#3b82f6" : "#374151" }}>{d}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} style={S.calCell} />;
          const key = getDateKey(d); const isToday = key === today;
          const hol = isHoliday(d); const closed = isClosed(d); const off = isOff(d);
          const dow = parseDate(key).getDay(); const hasBk = hasBookings(d);
          return (
            <div key={d}
              onClick={() => onSelectDate(key)}
              onTouchEnd={(e) => { e.preventDefault(); onSelectDate(key); }}
              style={{ ...S.calCell, cursor: "pointer", WebkitTapHighlightColor: "transparent", background: closed || off ? "#f3f4f6" : hol ? "#fef2f2" : "white", opacity: closed && !hol ? 0.5 : 1 }}>
              <div style={{
                color: isToday ? "white" : hol ? "#ef4444" : dow === 0 ? "#ef4444" : dow === 6 ? "#3b82f6" : "#1f2937",
                background: isToday ? "#3b82f6" : "transparent",
                borderRadius: "50%", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: isToday ? 700 : 600, fontSize: 14,
              }}>{d}</div>
              {hol && <div style={{ fontSize: 9, color: "#ef4444", lineHeight: 1, marginTop: 1 }}>{hol}</div>}
              {hasBk && <div style={{ display: "flex", gap: 3, marginTop: 2, justifyContent: "center" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#3b82f6" }} />
              </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Day Screen
// ============================================================
function DayScreen({ date, setDate, settings, holidays, bookings, setBookings, dayOff, setDayOff, shifts, setShifts, cols, onBack, showAddModal, setShowAddModal, showEditModal, setShowEditModal, showBlockModal, setShowBlockModal }) {
  const d = parseDate(date);
  const dateLabel = `${d.getMonth() + 1}æ${d.getDate()}æ¥ï¼${DAYS_JP[d.getDay()]}ï¼`;
  const fullLabel = `${d.getFullYear()}å¹´${d.getMonth() + 1}æ${d.getDate()}æ¥ï¼${DAYS_JP[d.getDay()]}ï¼`;
  const hol = holidays[date];
  const isClosed = settings.closedDays.includes(d.getDay()) || (settings.closedDates || []).includes(date);

  const dayData = dayOff[date] || {};
  const amOff = dayData.amOff || false;
  const pmOff = dayData.pmOff || false;
  const fullDayOff = dayData.fullDay || false;
  const blocks = dayData.blocks || [];
  const dayShift = shifts[date] || {};
  const isStaffOff = (staffName) => dayShift[staffName] === true;

  const amSlots = generateSlots(settings.amStart, settings.amEnd);
  const pmSlots = generateSlots(settings.pmStart, settings.pmEnd);
  const dayBookings = bookings[date] || {};

  const prevDay = useCallback(() => { const p = new Date(d); p.setDate(p.getDate() - 1); setDate(fmtDate(p)); }, [d, setDate]);
  const nextDay = useCallback(() => { const n = new Date(d); n.setDate(n.getDate() + 1); setDate(fmtDate(n)); }, [d, setDate]);
  const goToday = useCallback(() => setDate(fmtDate(new Date())), [setDate]);

  const toggleDayOff = useCallback(() => setDayOff((prev) => ({ ...prev, [date]: { ...dayData, fullDay: !fullDayOff } })), [date, dayData, fullDayOff, setDayOff]);
  const toggleAmOff = useCallback(() => setDayOff((prev) => ({ ...prev, [date]: { ...dayData, amOff: !amOff } })), [date, dayData, amOff, setDayOff]);
  const togglePmOff = useCallback(() => setDayOff((prev) => ({ ...prev, [date]: { ...dayData, pmOff: !pmOff } })), [date, dayData, pmOff, setDayOff]);

  const toggleStaffShift = useCallback((staffName) => {
    setShifts((prev) => {
      const ds = prev[date] || {};
      return { ...prev, [date]: { ...ds, [staffName]: !ds[staffName] } };
    });
  }, [date, setShifts]);

  const isSlotOccupied = (time, colId) => {
    for (const [id, b] of Object.entries(dayBookings)) {
      if (b.colId !== colId) continue;
      const bStart = timeToMin(b.time);
      const bEnd = bStart + (b.duration || 15);
      const slotMin = timeToMin(time);
      if (slotMin >= bStart && slotMin < bEnd) return { id, ...b };
    }
    return null;
  };

  const isBlocked = (time, colId) => {
    const min = timeToMin(time);
    return blocks.some((bl) => {
      const bStart = timeToMin(bl.start); const bEnd = timeToMin(bl.end);
      return min >= bStart && min < bEnd && (!bl.colIds || bl.colIds.includes(colId));
    });
  };

  const addBooking = useCallback((booking) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setBookings((prev) => ({ ...prev, [date]: { ...(prev[date] || {}), [id]: booking } }));
    setShowAddModal(null);
  }, [date, setBookings, setShowAddModal]);

  const updateBooking = useCallback((id, booking) => {
    setBookings((prev) => ({ ...prev, [date]: { ...(prev[date] || {}), [id]: booking } }));
    setShowEditModal(null);
  }, [date, setBookings, setShowEditModal]);

  const deleteBooking = useCallback((id) => {
    setBookings((prev) => { const day = { ...(prev[date] || {}) }; delete day[id]; return { ...prev, [date]: day }; });
    setShowEditModal(null);
  }, [date, setBookings, setShowEditModal]);

  const addBlock = useCallback((block) => {
    setDayOff((prev) => ({ ...prev, [date]: { ...dayData, blocks: [...blocks, block] } }));
    setShowBlockModal(false);
  }, [date, dayData, blocks, setDayOff, setShowBlockModal]);

  const colCount = cols.length;
  const gridCols = `44px repeat(${colCount}, 1fr)`;

  const renderSlot = (time, col, isAmSection) => {
    const colStaffName = col.type === "éå¸¸" ? col.label : null;
    const staffIsOff = colStaffName && isStaffOff(colStaffName);

    if ((isAmSection && amOff) || (!isAmSection && pmOff) || fullDayOff || isClosed || staffIsOff) {
      return <div key={`${time}-${col.id}`} style={{ ...S.slot, background: staffIsOff && !fullDayOff && !isClosed ? "#fee2e2" : "#f3f4f6" }} />;
    }

    if (isBlocked(time, col.id)) {
      return <div key={`${time}-${col.id}`} style={{ ...S.slot, background: "#fde68a" }} />;
    }

    const occupied = isSlotOccupied(time, col.id);
    if (occupied) {
      if (occupied.time === time) {
        const slotsSpan = (occupied.duration || 15) / 15;
        const isRaku = col.type === "æ¥½ãã¬";
        return (
          <div key={`${time}-${col.id}`}
            onClick={() => setShowEditModal({ id: occupied.id, ...occupied })}
            onTouchEnd={(e) => { e.preventDefault(); setShowEditModal({ id: occupied.id, ...occupied }); }}
            style={{
              ...S.slot, height: 40 * slotsSpan - 1,
              background: isRaku ? "#dcfce7" : "#dbeafe",
              borderLeft: `3px solid ${isRaku ? "#22c55e" : "#3b82f6"}`,
              cursor: "pointer", overflow: "hidden", padding: "2px 4px",
              display: "flex", flexDirection: "column", justifyContent: "center",
              WebkitTapHighlightColor: "transparent",
            }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#1f2937", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {occupied.isNew && <span style={{ fontSize: 8, background: "#fbbf24", color: "#78350f", borderRadius: 3, padding: "1px 3px", marginRight: 2, fontWeight: 700 }}>æ°è¦</span>}
              {occupied.patient}
            </div>
            <div style={{ fontSize: 9, color: "#6b7280" }}>
              {occupied.duration}å{occupied.staff ? ` / ${occupied.staff}` : ""}
            </div>
          </div>
        );
      }
      return null;
    }

    return (
      <div key={`${time}-${col.id}`}
        onClick={() => setShowAddModal({ time, col })}
        onTouchEnd={(e) => { e.preventDefault(); setShowAddModal({ time, col }); }}
        style={{ ...S.slot, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
        <span style={{ color: "#d1d5db", fontSize: 14 }}>+</span>
      </div>
    );
  };

  // Helper for touch-friendly buttons
  const TB = (onClick, style, children, extra = {}) => (
    <button onClick={onClick} onTouchEnd={(e) => { e.preventDefault(); onClick(); }} style={style} {...extra}>{children}</button>
  );

  return (
    <div style={S.screenBg}>
      <div style={S.header}>
        {TB(onBack, S.backBtn, "â ã«ã¬ã³ãã¼")}
        <span style={S.headerTitle2}>{dateLabel}</span>
        {TB(goToday, S.todayBtn, "ä»æ¥")}
      </div>

      <div style={S.dayNav}>
        {TB(prevDay, S.dayNavBtn, "â¹ åæ¥")}
        <span style={S.dayNavLabel}>{fullLabel}</span>
        {TB(nextDay, S.dayNavBtn, "ç¿æ¥ âº")}
      </div>

      <div style={S.dayStatus}>
        {hol ? <span style={{ color: "#ef4444", fontWeight: 600 }}>ð {hol}</span>
          : fullDayOff || isClosed ? <span style={{ color: "#9ca3af", fontWeight: 600 }}>ä¼è¨ºæ¥</span>
          : <span style={{ color: "#22c55e", fontWeight: 600 }}>â è¨ºçæ¥</span>}
        {!isClosed && TB(toggleDayOff, fullDayOff ? S.dayBtnActive : S.dayBtn, fullDayOff ? "è¨ºçæ¥ã«ãã" : "ãã®æ¥ãä¼è¨ºã«ãã")}
      </div>

      {/* Staff shift toggles */}
      {settings.staff && settings.staff.length > 0 && (
        <div style={S.shiftSection}>
          <div style={S.shiftLabel}>ã¹ã¿ããåºå¤ç¶æ³ï¼ã¿ããã§åæ¿ï¼</div>
          <div style={S.shiftRow}>
            {settings.staff.map((name) => {
              const off = isStaffOff(name);
              return (
                <button key={name}
                  onClick={() => toggleStaffShift(name)}
                  onTouchEnd={(e) => { e.preventDefault(); toggleStaffShift(name); }}
                  style={off ? S.shiftBtnOff : S.shiftBtnOn}>
                  <span style={{ fontSize: 14 }}>{off ? "ð«" : "â"}</span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{name}</span>
                  <span style={{ fontSize: 10, color: off ? "#ef4444" : "#059669" }}>{off ? "ä¼ã¿" : "åºå¤"}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ padding: "4px 8px" }}>
        {TB(() => setShowBlockModal(true), S.actionBtn, "ð æéããã­ãã¯")}
      </div>

      {/* Time grid */}
      <div style={S.gridContainer}>
        <div style={{ ...S.gridHeader, gridTemplateColumns: gridCols }}>
          <div style={S.timeCol}>æå»</div>
          {cols.map((c) => {
            const staffIsOff = c.type === "éå¸¸" && isStaffOff(c.label);
            return (
              <div key={c.id} style={{
                ...S.colHeader,
                fontSize: colCount > 5 ? 10 : 11,
                color: staffIsOff ? "#ef4444" : c.type === "æ¥½ãã¬" ? "#059669" : "#1f2937",
                background: c.type === "æ¥½ãã¬" ? "#f0fdf4" : "#f1f5f9",
                opacity: staffIsOff ? 0.6 : 1,
              }}>
                {c.label}
                {staffIsOff && <div style={{ fontSize: 8, color: "#ef4444" }}>ä¼</div>}
              </div>
            );
          })}
        </div>

        <div style={S.sectionHeader}>
          <span>ð åå ã{settings.amEnd}</span>
          {TB(toggleAmOff, amOff ? S.sectionBtnActive : S.sectionBtn, amOff ? "åååé" : "ååä¼ã¿")}
        </div>

        <div style={S.gridBody}>
          {amSlots.map((time) => (
            <div key={time} style={{ ...S.gridRow, gridTemplateColumns: gridCols }}>
              <div style={S.timeCell}>{time}</div>
              {cols.map((col) => renderSlot(time, col, true))}
            </div>
          ))}
        </div>

        <div style={S.sectionHeader}>
          <span>ð åå¾</span>
          {TB(togglePmOff, pmOff ? S.sectionBtnActive : S.sectionBtn, pmOff ? "åå¾åé" : "åå¾ä¼ã¿")}
        </div>

        <div style={S.gridBody}>
          {pmSlots.map((time) => (
            <div key={time} style={{ ...S.gridRow, gridTemplateColumns: gridCols }}>
              <div style={S.timeCell}>{time}</div>
              {cols.map((col) => renderSlot(time, col, false))}
            </div>
          ))}
        </div>
      </div>

      {showAddModal && <AddBookingModal date={date} time={showAddModal.time} col={showAddModal.col} cols={cols} settings={settings} onSave={addBooking} onClose={() => setShowAddModal(null)} />}
      {showEditModal && <EditBookingModal booking={showEditModal} cols={cols} settings={settings} onSave={(b) => updateBooking(showEditModal.id, b)} onDelete={() => deleteBooking(showEditModal.id)} onClose={() => setShowEditModal(null)} />}
      {showBlockModal && <BlockModal cols={cols} onSave={addBlock} onClose={() => setShowBlockModal(false)} settings={settings} />}
    </div>
  );
}

// ============================================================
// Add Booking Modal
// ============================================================
function AddBookingModal({ date, time, col, cols, settings, onSave, onClose }) {
  const d = parseDate(date);
  const dateLabel = `${d.getFullYear()}å¹´${d.getMonth() + 1}æ${d.getDate()}æ¥ï¼${DAYS_JP[d.getDay()]}ï¼${time}`;
  const [selectedCol, setSelectedCol] = useState(col.id);
  const [duration, setDuration] = useState(30);
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [patient, setPatient] = useState("");
  const [memo, setMemo] = useState("");
  const [staff, setStaff] = useState(col.type === "éå¸¸" ? col.label : "");

  const handleSave = useCallback(() => {
    if (!patient.trim()) return;
    const sc = cols.find((c) => c.id === selectedCol) || col;
    onSave({ time, colId: selectedCol, colLabel: sc.label, colType: sc.type, duration, patient: patient.trim(), memo, staff, isNew: isNewPatient });
  }, [patient, cols, selectedCol, col, onSave, time, duration, memo, staff, isNewPatient]);

  return (
    <ModalOverlay onClose={onClose}>
      <div style={S.modal}>
        <div style={S.modalHandle} />
        <h2 style={S.modalTitle}>äºç´ãè¿½å </h2>

        <div style={S.modalField}>
          <label style={S.modalLabel}>æ¥æ</label>
          <div style={{ color: "#3b82f6", fontWeight: 600 }}>{dateLabel}</div>
        </div>

        <div style={S.modalField}>
          <label style={S.modalLabel}>å</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {cols.map((c) => (
              <button key={c.id}
                onClick={() => { setSelectedCol(c.id); if (c.type === "éå¸¸") setStaff(c.label); }}
                onTouchEnd={(e) => { e.preventDefault(); setSelectedCol(c.id); if (c.type === "éå¸¸") setStaff(c.label); }}
                style={{ ...(selectedCol === c.id ? S.chipActive : S.chip), background: selectedCol === c.id ? (c.type === "æ¥½ãã¬" ? "#dcfce7" : "#dbeafe") : "white", borderColor: selectedCol === c.id ? (c.type === "æ¥½ãã¬" ? "#22c55e" : "#3b82f6") : "#e5e7eb", color: selectedCol === c.id ? (c.type === "æ¥½ãã¬" ? "#059669" : "#2563eb") : "#374151" }}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div style={S.modalField}>
          <label style={S.modalLabel}>æé</label>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>éå¸¸</div>
          <div style={S.btnGroup}>
            {[15, 30, 45, 60].map((m) => (
              <button key={m}
                onClick={() => { setDuration(m); setIsNewPatient(false); }}
                onTouchEnd={(e) => { e.preventDefault(); setDuration(m); setIsNewPatient(false); }}
                style={duration === m && !isNewPatient ? S.btnGroupActive : S.btnGroupItem}>{m}å</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, marginTop: 10 }}>æ°è¦</div>
          <div style={S.btnGroup}>
            <button
              onClick={() => { setDuration(60); setIsNewPatient(true); }}
              onTouchEnd={(e) => { e.preventDefault(); setDuration(60); setIsNewPatient(true); }}
              style={isNewPatient ? S.btnGroupActive : S.btnGroupItem}>
              60å<div style={{ fontSize: 10, color: isNewPatient ? "#3b82f6" : "#6b7280" }}>æ°è¦</div>
            </button>
          </div>
        </div>

        <div style={S.modalField}>
          <label style={S.modalLabel}>æ£èå</label>
          <input value={patient} onChange={(e) => setPatient(e.target.value)} placeholder="ä¾ï¼ç°ä¸­ å¤ªé" style={S.textInput} autoFocus />
        </div>

        {settings.staff && settings.staff.length > 0 && (
          <div style={S.modalField}>
            <label style={S.modalLabel}>æå½ã¹ã¿ããï¼ä»»æï¼</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => setStaff("")} onTouchEnd={(e) => { e.preventDefault(); setStaff(""); }} style={staff === "" ? S.chipActive : S.chip}>æå®ãªã</button>
              {settings.staff.map((s) => (
                <button key={s} onClick={() => setStaff(s)} onTouchEnd={(e) => { e.preventDefault(); setStaff(s); }} style={staff === s ? S.chipActive : S.chip}>{s}</button>
              ))}
            </div>
          </div>
        )}

        <div style={S.modalField}>
          <label style={S.modalLabel}>ã¡ã¢ï¼ä»»æï¼</label>
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="åèãªã©" style={S.textArea} rows={2} />
        </div>

        <button onClick={handleSave} onTouchEnd={(e) => { e.preventDefault(); handleSave(); }} style={S.saveBtn}>â äºç´ãä¿å­</button>
        <button onClick={onClose} onTouchEnd={(e) => { e.preventDefault(); onClose(); }} style={S.cancelBtn}>ã­ã£ã³ã»ã«</button>
      </div>
    </ModalOverlay>
  );
}

// ============================================================
// Edit Booking Modal
// ============================================================
function EditBookingModal({ booking, cols, settings, onSave, onDelete, onClose }) {
  const [selectedCol, setSelectedCol] = useState(booking.colId);
  const [patient, setPatient] = useState(booking.patient);
  const [duration, setDuration] = useState(booking.duration || 15);
  const [memo, setMemo] = useState(booking.memo || "");
  const [staff, setStaff] = useState(booking.staff || "");
  const [isNewPatient, setIsNewPatient] = useState(booking.isNew || false);

  const handleSave = useCallback(() => {
    const sc = cols.find((c) => c.id === selectedCol);
    onSave({ ...booking, colId: selectedCol, colLabel: sc?.label, colType: sc?.type, patient, duration, memo, staff, isNew: isNewPatient });
  }, [cols, selectedCol, booking, onSave, patient, duration, memo, staff, isNewPatient]);

  return (
    <ModalOverlay onClose={onClose}>
      <div style={S.modal}>
        <div style={S.modalHandle} />
        <h2 style={S.modalTitle}>äºç´ãç·¨é</h2>

        <div style={S.modalField}>
          <label style={S.modalLabel}>å</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {cols.map((c) => (
              <button key={c.id}
                onClick={() => setSelectedCol(c.id)}
                onTouchEnd={(e) => { e.preventDefault(); setSelectedCol(c.id); }}
                style={{ ...(selectedCol === c.id ? S.chipActive : S.chip), background: selectedCol === c.id ? (c.type === "æ¥½ãã¬" ? "#dcfce7" : "#dbeafe") : "white", borderColor: selectedCol === c.id ? (c.type === "æ¥½ãã¬" ? "#22c55e" : "#3b82f6") : "#e5e7eb", color: selectedCol === c.id ? (c.type === "æ¥½ãã¬" ? "#059669" : "#2563eb") : "#374151" }}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div style={S.modalField}>
          <label style={S.modalLabel}>æé</label>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>éå¸¸</div>
          <div style={S.btnGroup}>
            {[15, 30, 45, 60].map((m) => (
              <button key={m}
                onClick={() => { setDuration(m); setIsNewPatient(false); }}
                onTouchEnd={(e) => { e.preventDefault(); setDuration(m); setIsNewPatient(false); }}
                style={duration === m && !isNewPatient ? S.btnGroupActive : S.btnGroupItem}>{m}å</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, marginTop: 10 }}>æ°è¦</div>
          <div style={S.btnGroup}>
            <button
              onClick={() => { setDuration(60); setIsNewPatient(true); }}
              onTouchEnd={(e) => { e.preventDefault(); setDuration(60); setIsNewPatient(true); }}
              style={isNewPatient ? S.btnGroupActive : S.btnGroupItem}>
              60å<div style={{ fontSize: 10, color: isNewPatient ? "#3b82f6" : "#6b7280" }}>æ°è¦</div>
            </button>
          </div>
        </div>

        <div style={S.modalField}>
          <label style={S.modalLabel}>æ£èå</label>
          <input value={patient} onChange={(e) => setPatient(e.target.value)} style={S.textInput} />
        </div>

        {settings.staff && settings.staff.length > 0 && (
          <div style={S.modalField}>
            <label style={S.modalLabel}>æå½ã¹ã¿ãã</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => setStaff("")} onTouchEnd={(e) => { e.preventDefault(); setStaff(""); }} style={staff === "" ? S.chipActive : S.chip}>æå®ãªã</button>
              {settings.staff.map((s) => (
                <button key={s} onClick={() => setStaff(s)} onTouchEnd={(e) => { e.preventDefault(); setStaff(s); }} style={staff === s ? S.chipActive : S.chip}>{s}</button>
              ))}
            </div>
          </div>
        )}

        <div style={S.modalField}>
          <label style={S.modalLabel}>ã¡ã¢</label>
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} style={S.textArea} rows={2} />
        </div>

        <button onClick={handleSave} onTouchEnd={(e) => { e.preventDefault(); handleSave(); }} style={S.saveBtn}>â æ´æ°</button>
        <button onClick={onDelete} onTouchEnd={(e) => { e.preventDefault(); onDelete(); }} style={S.deleteBtn}>ðï¸ åé¤</button>
        <button onClick={onClose} onTouchEnd={(e) => { e.preventDefault(); onClose(); }} style={S.cancelBtn}>ã­ã£ã³ã»ã«</button>
      </div>
    </ModalOverlay>
  );
}

// ============================================================
// Block Modal
// ============================================================
function BlockModal({ cols, onSave, onClose, settings }) {
  const [start, setStart] = useState(settings.amStart);
  const [end, setEnd] = useState(settings.amEnd);
  const [selCols, setSelCols] = useState(cols.map((c) => c.id));
  const toggleCol = (id) => setSelCols((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  return (
    <ModalOverlay onClose={onClose}>
      <div style={S.modal}>
        <div style={S.modalHandle} />
        <h2 style={S.modalTitle}>æéå¸¯ããã­ãã¯</h2>
        <div style={S.modalField}>
          <label style={S.modalLabel}>éå§æé</label>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={S.textInput} />
        </div>
        <div style={S.modalField}>
          <label style={S.modalLabel}>çµäºæé</label>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={S.textInput} />
        </div>
        <div style={S.modalField}>
          <label style={S.modalLabel}>å¯¾è±¡å</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {cols.map((c) => (
              <button key={c.id}
                onClick={() => toggleCol(c.id)}
                onTouchEnd={(e) => { e.preventDefault(); toggleCol(c.id); }}
                style={selCols.includes(c.id) ? S.chipActive : S.chip}>{c.label}</button>
            ))}
          </div>
        </div>
        <button
          onClick={() => onSave({ start, end, colIds: selCols })}
          onTouchEnd={(e) => { e.preventDefault(); onSave({ start, end, colIds: selCols }); }}
          style={S.saveBtn}>ãã­ãã¯è¨­å®</button>
        <button onClick={onClose} onTouchEnd={(e) => { e.preventDefault(); onClose(); }} style={S.cancelBtn}>ã­ã£ã³ã»ã«</button>
      </div>
    </ModalOverlay>
  );
}

function ModalOverlay({ children, onClose }) {
  return (
    <div style={S.overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

// ============================================================
// Settings Screen (with Firebase config)
// ============================================================
function SettingsScreen({ settings, setSettings, holidays, bookings, setBookings, shifts, setShifts, onBack, onLogout, fbConfig, setFbConfig, fbConnected, fbStatus, connectFirebase, disconnectFirebase }) {
  const [tempClinicName, setTempClinicName] = useState(settings.clinicName);
  const [tempAmStart, setTempAmStart] = useState(settings.amStart);
  const [tempAmEnd, setTempAmEnd] = useState(settings.amEnd);
  const [tempPmStart, setTempPmStart] = useState(settings.pmStart);
  const [tempPmEnd, setTempPmEnd] = useState(settings.pmEnd);
  const [closedDays, setClosedDays] = useState(settings.closedDays);
  const [closedDates, setClosedDates] = useState(settings.closedDates || []);
  const [newClosedDate, setNewClosedDate] = useState(fmtDate(new Date()));
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinMsg, setPinMsg] = useState("");
  const [saved, setSaved] = useState({});
  const [staffList, setStaffList] = useState(settings.staff || []);
  const [newStaffName, setNewStaffName] = useState("");
  const [shiftMonth, setShiftMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });

  // Firebase config editing
  const [tempFbConfig, setTempFbConfig] = useState(fbConfig);
  const [fbSaveMsg, setFbSaveMsg] = useState("");

  const showSaved = (key) => { setSaved((p) => ({ ...p, [key]: true })); setTimeout(() => setSaved((p) => ({ ...p, [key]: false })), 1500); };
  const saveClinicName = () => { setSettings((s) => ({ ...s, clinicName: tempClinicName })); showSaved("name"); };
  const saveHours = () => { setSettings((s) => ({ ...s, amStart: tempAmStart, amEnd: tempAmEnd, pmStart: tempPmStart, pmEnd: tempPmEnd })); showSaved("hours"); };
  const saveClosedDays = () => { setSettings((s) => ({ ...s, closedDays })); showSaved("closed"); };
  const toggleClosedDay = (d) => setClosedDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  const addClosedDate = () => { if (!closedDates.includes(newClosedDate)) { const u = [...closedDates, newClosedDate].sort(); setClosedDates(u); setSettings((s) => ({ ...s, closedDates: u })); } };
  const removeClosedDate = (d) => { const u = closedDates.filter((x) => x !== d); setClosedDates(u); setSettings((s) => ({ ...s, closedDates: u })); };

  const changePin = () => {
    if (currentPin !== settings.pin) { setPinMsg("ç¾å¨ã®PINãæ­£ããããã¾ãã"); return; }
    if (newPin.length < 4 || newPin.length > 8) { setPinMsg("PINã¯4ã8æ¡ã§å¥åãã¦ãã ãã"); return; }
    setSettings((s) => ({ ...s, pin: newPin })); setPinMsg("PINãå¤æ´ãã¾ããï¼"); setCurrentPin(""); setNewPin("");
  };

  const addStaff = () => { const name = newStaffName.trim(); if (!name || staffList.includes(name)) return; const u = [...staffList, name]; setStaffList(u); setSettings((s) => ({ ...s, staff: u })); setNewStaffName(""); };
  const removeStaff = (name) => { const u = staffList.filter((s) => s !== name); setStaffList(u); setSettings((s) => ({ ...s, staff: u })); };
  const moveStaff = (index, dir) => { const u = [...staffList]; const ni = index + dir; if (ni < 0 || ni >= u.length) return; [u[index], u[ni]] = [u[ni], u[index]]; setStaffList(u); setSettings((s) => ({ ...s, staff: u })); };

  const handleBackup = () => {
    const data = { settings, bookings, shifts, version: "5.0-firebase" };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `clinic-backup-${fmtDate(new Date())}.json`; a.click();
  };

  const handleRestore = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { try { const data = JSON.parse(ev.target.result); if (data.settings) setSettings(data.settings); if (data.bookings) setBookings(data.bookings); if (data.shifts) setShifts(data.shifts); alert("å¾©åãã¾ããï¼"); } catch { alert("ãã¡ã¤ã«ãæ­£ããããã¾ãã"); } };
    reader.readAsText(file);
  };

  const handleFirebaseSave = async () => {
    setFbConfig(tempFbConfig);
    if (tempFbConfig.databaseURL) {
      setFbSaveMsg("æ¥ç¶ãã¹ãä¸­...");
      await connectFirebase(tempFbConfig);
      setFbSaveMsg("æ¥ç¶è¨­å®ãä¿å­ãã¾ãã");
    } else {
      disconnectFirebase();
      setFbSaveMsg("Firebaseæ¥ç¶ãè§£é¤ãã¾ãã");
    }
    setTimeout(() => setFbSaveMsg(""), 3000);
  };

  const handleFirebaseDisconnect = () => {
    const empty = { ...DEFAULT_FIREBASE_CONFIG };
    setTempFbConfig(empty);
    setFbConfig(empty);
    disconnectFirebase();
    setFbSaveMsg("Firebaseæ¥ç¶ãè§£é¤ãã¾ãã");
    setTimeout(() => setFbSaveMsg(""), 3000);
  };

  const allHolidays = useMemo(() => [2025, 2026, 2027].flatMap((y) => getJPHolidays(y)), []);

  const { year: sy, month: sm } = shiftMonth;
  const shiftDaysInMonth = new Date(sy, sm + 1, 0).getDate();
  const prevShiftMonth = () => setShiftMonth((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 });
  const nextShiftMonth = () => setShiftMonth((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 });

  const toggleShift = (dateStr, staffName) => {
    setShifts((prev) => {
      const ds = prev[dateStr] || {};
      return { ...prev, [dateStr]: { ...ds, [staffName]: !ds[staffName] } };
    });
  };

  const fbStatusColor = fbStatus === "connected" ? "#22c55e" : fbStatus === "connecting" ? "#fbbf24" : fbStatus === "error" ? "#ef4444" : "#94a3b8";
  const fbStatusText = fbStatus === "connected" ? "ð¢ æ¥ç¶ä¸­ï¼ãªã¢ã«ã¿ã¤ã åææå¹ï¼" : fbStatus === "connecting" ? "ð¡ æ¥ç¶ãã¹ãä¸­..." : fbStatus === "error" ? "ð´ æ¥ç¶ã¨ã©ã¼ï¼è¨­å®ãç¢ºèªãã¦ãã ããï¼" : "âª æªæ¥ç¶ï¼ã­ã¼ã«ã«ä¿å­ã®ã¿ï¼";

  return (
    <div style={S.screenBg}>
      <div style={S.header}>
        <button onClick={onBack} onTouchEnd={(e) => { e.preventDefault(); onBack(); }} style={S.backBtn}>â æ»ã</button>
        <span style={S.headerTitle2}>è¨­å® <span style={{ fontSize: 12, color: "#93c5fd" }}>v5.0</span></span>
        <div style={{ width: 60 }} />
      </div>

      <div style={S.settingsBody}>

        {/* ==================== FIREBASE CONFIG ==================== */}
        <div style={{ ...S.card, border: `2px solid ${fbStatusColor}` }}>
          <h3 style={S.cardTitle}>ð¥ Firebase ãªã¢ã«ã¿ã¤ã åæ</h3>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
            Firebase Realtime Databaseã«æ¥ç¶ããã¨ãå¨ã¹ã¿ããã®ç«¯æ«ã§ãã¼ã¿ããªã¢ã«ã¿ã¤ã ã«å±æããã¾ãã
          </p>

          <div style={{ padding: "8px 12px", borderRadius: 8, background: fbStatus === "connected" ? "#f0fdf4" : fbStatus === "error" ? "#fef2f2" : "#f8fafc", marginBottom: 12, fontSize: 13, fontWeight: 600, color: fbStatusColor }}>
            {fbStatusText}
          </div>

          {[
            { key: "databaseURL", label: "Database URLï¼å¿é ï¼", placeholder: "https://xxxxx.firebaseio.com" },
            { key: "apiKey", label: "API Key", placeholder: "AIzaSy..." },
            { key: "authDomain", label: "Auth Domain", placeholder: "xxxxx.firebaseapp.com" },
            { key: "projectId", label: "Project ID", placeholder: "my-clinic-app" },
          ].map(({ key, label, placeholder }) => (
            <div key={key} style={S.modalField}>
              <label style={S.modalLabel}>{label}</label>
              <input
                value={tempFbConfig[key] || ""}
                onChange={(e) => setTempFbConfig((p) => ({ ...p, [key]: e.target.value }))}
                placeholder={placeholder}
                style={S.textInput}
              />
            </div>
          ))}

          {fbSaveMsg && <div style={{ fontSize: 13, color: fbSaveMsg.includes("ã¨ã©ã¼") ? "#ef4444" : "#22c55e", marginBottom: 8, fontWeight: 600 }}>{fbSaveMsg}</div>}

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleFirebaseSave} onTouchEnd={(e) => { e.preventDefault(); handleFirebaseSave(); }} style={{ ...S.saveBtn, flex: 1 }}>
              {fbConnected ? "ð åæ¥ç¶" : "ð¥ æ¥ç¶ãã¹ã & ä¿å­"}
            </button>
            {fbConnected && (
              <button onClick={handleFirebaseDisconnect} onTouchEnd={(e) => { e.preventDefault(); handleFirebaseDisconnect(); }} style={{ ...S.deleteBtn, flex: 1 }}>
                æ¥ç¶è§£é¤
              </button>
            )}
          </div>

          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 12, color: "#6b7280", cursor: "pointer", fontWeight: 600 }}>ð Firebaseè¨­å®æé </summary>
            <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.8, marginTop: 8, padding: "8px 12px", background: "#f9fafb", borderRadius: 8 }}>
              1. <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6" }}>Firebase Console</a> ã«ã¢ã¯ã»ã¹<br/>
              2.ããã­ã¸ã§ã¯ããä½æãã§ãã­ã¸ã§ã¯ãä½æ<br/>
              3. å·¦ã¡ãã¥ã¼ãæ§ç¯ãâãRealtime Databaseãâããã¼ã¿ãã¼ã¹ãä½æã<br/>
              4. ã«ã¼ã«ãä»¥ä¸ã«å¤æ´ãã¦ãå¬éãï¼<br/>
              <code style={{ display: "block", padding: "6px 8px", background: "#e5e7eb", borderRadius: 4, margin: "4px 0", fontSize: 10, whiteSpace: "pre" }}>
{`{
  "rules": {
    ".read": true,
    ".write": true
  }
}`}
              </code>
              5. æ­¯è»ã¢ã¤ã³ã³âããã­ã¸ã§ã¯ãã®è¨­å®ãâãå¨è¬ãâããã¤ã¢ããªãã§ã¦ã§ãã¢ããªãè¿½å <br/>
              6. è¡¨ç¤ºãããfirebaseConfigã®åå¤ãããã«å¥å<br/>
              7.ãæ¥ç¶ãã¹ã & ä¿å­ããã¿ãã
            </div>
          </details>
        </div>

        {/* Clinic name */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>ã¯ãªããã¯å</h3>
          <input value={tempClinicName} onChange={(e) => setTempClinicName(e.target.value)} style={S.textInput} />
          <button onClick={saveClinicName} onTouchEnd={(e) => { e.preventDefault(); saveClinicName(); }} style={S.smallSaveBtn}>{saved.name ? "â ä¿å­ãã¾ãã" : "ä¿å­"}</button>
        </div>

        {/* Hours */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>è¨ºçæé</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }}>ð</span><span style={{ fontWeight: 600 }}>åå</span>
          </div>
          <div style={S.timeRow}>
            <span>éå§</span><input type="time" value={tempAmStart} onChange={(e) => setTempAmStart(e.target.value)} style={S.timeInput} />
            <span>ã çµäº</span><input type="time" value={tempAmEnd} onChange={(e) => setTempAmEnd(e.target.value)} style={S.timeInput} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 8px" }}>
            <span style={{ fontSize: 20 }}>ð</span><span style={{ fontWeight: 600 }}>åå¾</span>
          </div>
          <div style={S.timeRow}>
            <span>éå§</span><input type="time" value={tempPmStart} onChange={(e) => setTempPmStart(e.target.value)} style={S.timeInput} />
            <span>ã çµäº</span><input type="time" value={tempPmEnd} onChange={(e) => setTempPmEnd(e.target.value)} style={S.timeInput} />
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>â» çµäºã¯æå¾ã®æ ã®éå§æå»ï¼15ååä½ï¼</div>
          <button onClick={saveHours} onTouchEnd={(e) => { e.preventDefault(); saveHours(); }} style={S.smallSaveBtn}>{saved.hours ? "â ä¿å­ãã¾ãã" : "ä¿å­"}</button>
        </div>

        {/* Staff management */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>ð¤ ã¹ã¿ããç®¡ç</h3>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>ç»é²ããã¹ã¿ããåãäºç´è¡¨ã®éå¸¸æ²»çåã«ãªãã¾ãã</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input value={newStaffName} onChange={(e) => setNewStaffName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStaff()} placeholder="ã¹ã¿ããåãå¥å" style={{ ...S.textInput, flex: 1 }} />
            <button onClick={addStaff} onTouchEnd={(e) => { e.preventDefault(); addStaff(); }} style={S.addBtn}>è¿½å </button>
          </div>
          {staffList.length === 0 ? <div style={{ color: "#9ca3af", textAlign: "center", padding: 8 }}>ã¹ã¿ããæªç»é²</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {staffList.map((name, idx) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#eff6ff", color: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{idx + 1}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#1f2937" }}>{name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button onClick={() => moveStaff(idx, -1)} onTouchEnd={(e) => { e.preventDefault(); moveStaff(idx, -1); }} disabled={idx === 0} style={{ border: "none", background: "none", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? "#d1d5db" : "#6b7280", fontSize: 16, padding: "2px 6px" }}>â</button>
                    <button onClick={() => moveStaff(idx, 1)} onTouchEnd={(e) => { e.preventDefault(); moveStaff(idx, 1); }} disabled={idx === staffList.length - 1} style={{ border: "none", background: "none", cursor: idx === staffList.length - 1 ? "default" : "pointer", color: idx === staffList.length - 1 ? "#d1d5db" : "#6b7280", fontSize: 16, padding: "2px 6px" }}>â</button>
                    <button onClick={() => removeStaff(name)} onTouchEnd={(e) => { e.preventDefault(); removeStaff(name); }} style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer", fontSize: 18, padding: "2px 6px" }}>Ã</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Shift Calendar */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>ð ã·ããç®¡ç</h3>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>ã¹ã¿ããã®åºå¤/ä¼ã¿ãæåä½ã§ç®¡çãä¼ã¿ã«ããã¨äºç´è¡¨ã®è©²å½åãèµ¤ããªãã¾ãã</p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button onClick={prevShiftMonth} onTouchEnd={(e) => { e.preventDefault(); prevShiftMonth(); }} style={S.navArrowSm}>â¹</button>
            <span style={{ fontWeight: 700, fontSize: 15, color: "#1f2937" }}>{sy}å¹´{sm + 1}æ</span>
            <button onClick={nextShiftMonth} onTouchEnd={(e) => { e.preventDefault(); nextShiftMonth(); }} style={S.navArrowSm}>âº</button>
          </div>
          {staffList.length === 0 ? <div style={{ color: "#9ca3af", textAlign: "center", padding: 16 }}>ã¹ã¿ãããåã«ç»é²ãã¦ãã ãã</div> : (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th style={S.shiftTh}>æ¥ä»</th>
                    {staffList.map((name) => <th key={name} style={S.shiftTh}>{name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: shiftDaysInMonth }, (_, i) => i + 1).map((day) => {
                    const dateStr = `${sy}-${pad(sm + 1)}-${pad(day)}`;
                    const dow = parseDate(dateStr).getDay();
                    const isSun = dow === 0; const isSat = dow === 6;
                    const isClosedDay = settings.closedDays.includes(dow);
                    const holName = holidays[dateStr];
                    return (
                      <tr key={day} style={{ background: isClosedDay ? "#f9fafb" : holName ? "#fef2f2" : "white" }}>
                        <td style={{ ...S.shiftTd, fontWeight: 600, whiteSpace: "nowrap", color: isSun || holName ? "#ef4444" : isSat ? "#3b82f6" : "#374151", minWidth: 70 }}>
                          {day}({DAYS_JP[dow]}){holName ? <span style={{ fontSize: 9, color: "#ef4444" }}> {holName.slice(0, 3)}</span> : ""}
                        </td>
                        {staffList.map((name) => {
                          const isOff = shifts[dateStr]?.[name] === true;
                          return (
                            <td key={name} style={S.shiftTd}>
                              <button
                                onClick={() => toggleShift(dateStr, name)}
                                onTouchEnd={(e) => { e.preventDefault(); toggleShift(dateStr, name); }}
                                style={{
                                  width: "100%", padding: "4px 0", border: "none", borderRadius: 4, cursor: "pointer",
                                  background: isOff ? "#fee2e2" : "#dcfce7",
                                  color: isOff ? "#ef4444" : "#059669",
                                  fontWeight: 600, fontSize: 11,
                                  WebkitTapHighlightColor: "transparent",
                                }}>
                                {isOff ? "ä¼" : "â"}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Closed days */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>å®ä¼ææ¥</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {DAYS_JP.map((d, i) => (
              <button key={d}
                onClick={() => toggleClosedDay(i)}
                onTouchEnd={(e) => { e.preventDefault(); toggleClosedDay(i); }}
                style={{
                  width: 44, height: 44, borderRadius: "50%",
                  border: closedDays.includes(i) ? "2px solid #ef4444" : "2px solid #e5e7eb",
                  background: closedDays.includes(i) ? "#fef2f2" : "white",
                  color: closedDays.includes(i) ? "#ef4444" : "#374151",
                  fontWeight: 600, cursor: "pointer", fontSize: 14,
                  WebkitTapHighlightColor: "transparent",
                }}>{d}</button>
            ))}
          </div>
          <button onClick={saveClosedDays} onTouchEnd={(e) => { e.preventDefault(); saveClosedDays(); }} style={S.smallSaveBtn}>{saved.closed ? "â ä¿å­ãã¾ãã" : "ä¿å­"}</button>
        </div>

        {/* Closed dates */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>ä¼è¨ºæ¥ï¼ç¹å®æ¥ï¼</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input type="date" value={newClosedDate} onChange={(e) => setNewClosedDate(e.target.value)} style={S.timeInput} />
            <button onClick={addClosedDate} onTouchEnd={(e) => { e.preventDefault(); addClosedDate(); }} style={S.addBtn}>è¿½å </button>
          </div>
          {closedDates.length === 0 ? <div style={{ color: "#9ca3af", textAlign: "center" }}>ç»é²ãªã</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {closedDates.map((d) => (
                <div key={d} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", background: "#f9fafb", borderRadius: 6 }}>
                  <span style={{ fontSize: 14 }}>{d}ï¼{DAYS_JP[dayOfWeek(d)]}ï¼</span>
                  <button onClick={() => removeClosedDate(d)} onTouchEnd={(e) => { e.preventDefault(); removeClosedDate(d); }} style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer", fontSize: 18 }}>Ã</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Holidays */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>ç¥æ¥ä¸è¦§ï¼èªåè¨­å®ã»å¤æ´ä¸å¯ï¼</h3>
          <div style={{ maxHeight: 200, overflow: "auto" }}>
            {allHolidays.slice(0, 20).map((h) => (
              <div key={h.date + h.name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>
                <span>{h.name}</span>
                <span style={{ color: "#6b7280" }}>{h.date.replace(/-/g, "/")}ï¼{DAYS_JP[dayOfWeek(h.date)]}ï¼</span>
              </div>
            ))}
          </div>
        </div>

        {/* PIN */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>PINå¤æ´</h3>
          <div style={S.modalField}>
            <label style={S.modalLabel}>ç¾å¨ã®PIN</label>
            <input type="password" value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))} placeholder="ç¾å¨ã®PIN" style={S.textInput} maxLength={8} />
          </div>
          <div style={S.modalField}>
            <label style={S.modalLabel}>æ°ããPINï¼4ã8æ¡ï¼</label>
            <input type="password" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} placeholder="æ°ããPIN" style={S.textInput} maxLength={8} />
          </div>
          {pinMsg && <div style={{ color: pinMsg.includes("å¤æ´") ? "#22c55e" : "#ef4444", fontSize: 13, marginBottom: 8 }}>{pinMsg}</div>}
          <button onClick={changePin} onTouchEnd={(e) => { e.preventDefault(); changePin(); }} style={S.outlineBtn}>PINãå¤æ´ãã</button>
        </div>

        {/* Backup */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>ããã¯ã¢ãã & å¾©å</h3>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>ãã¼ã¿ã®ããã¯ã¢ããã¨å¾©åãã§ãã¾ãã</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleBackup} onTouchEnd={(e) => { e.preventDefault(); handleBackup(); }} style={S.backupBtn}>ð¦ ããã¯ã¢ãã</button>
            <label style={S.restoreBtn}>ð å¾©åãã<input type="file" accept=".json" onChange={handleRestore} style={{ display: "none" }} /></label>
          </div>
        </div>

        <button onClick={onLogout} onTouchEnd={(e) => { e.preventDefault(); onLogout(); }} style={S.logoutBtn}>ã­ã°ã¢ã¦ã</button>
      </div>
    </div>
  );
}

// ============================================================
// Styles
// ============================================================
const S = {
  appContainer: { maxWidth: 560, margin: "0 auto", minHeight: "100vh", background: "#f8fafc", fontFamily: "'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif", position: "relative", overflow: "hidden" },
  screenBg: { background: "#f8fafc", minHeight: "100vh" },
  loginBg: { minHeight: "100vh", background: "linear-gradient(135deg,#475569 0%,#334155 50%,#1e293b 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  loginCenter: { textAlign: "center", width: "100%", maxWidth: 360 },
  loginTitle: { color: "#93c5fd", fontSize: 20, fontWeight: 700, marginBottom: 24 },
  loginCard: { background: "white", borderRadius: 16, padding: 24, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" },
  loginLabel: { fontWeight: 700, fontSize: 16, color: "#1f2937", textAlign: "left", marginBottom: 4 },
  loginDivider: { height: 2, background: "linear-gradient(90deg,#3b82f6,#93c5fd)", marginBottom: 16, borderRadius: 1 },
  pinInput: { width: "100%", padding: 16, border: "2px solid #e5e7eb", borderRadius: 12, fontSize: 24, textAlign: "center", letterSpacing: 8, outline: "none", boxSizing: "border-box", marginBottom: 12 },
  loginBtn: { width: "100%", padding: 14, background: "#3b82f6", color: "white", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: "pointer", marginBottom: 8, WebkitTapHighlightColor: "transparent" },
  pinHint: { fontSize: 13, color: "#9ca3af" },
  errorText: { color: "#ef4444", fontSize: 13, marginBottom: 8 },

  header: { background: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "white", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 },
  headerTitle: { fontSize: 18, fontWeight: 700, flex: 1, textAlign: "center" },
  headerTitle2: { fontSize: 16, fontWeight: 700 },
  settingsBtn: { background: "rgba(255,255,255,0.2)", border: "none", color: "white", padding: "6px 14px", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13, WebkitTapHighlightColor: "transparent" },
  backBtn: { background: "none", border: "none", color: "white", cursor: "pointer", fontWeight: 600, fontSize: 14, padding: "4px 0", WebkitTapHighlightColor: "transparent" },
  todayBtn: { background: "rgba(255,255,255,0.2)", border: "none", color: "white", padding: "6px 12px", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13, WebkitTapHighlightColor: "transparent" },

  monthNav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px" },
  navArrow: { width: 36, height: 36, borderRadius: "50%", border: "1px solid #e5e7eb", background: "white", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#374151", WebkitTapHighlightColor: "transparent" },
  navArrowSm: { width: 30, height: 30, borderRadius: "50%", border: "1px solid #e5e7eb", background: "white", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#374151", WebkitTapHighlightColor: "transparent" },
  monthLabel: { fontSize: 18, fontWeight: 700, color: "#1f2937" },

  legend: { display: "flex", gap: 12, justifyContent: "center", padding: "4px 16px 8px", fontSize: 12, color: "#6b7280", flexWrap: "wrap" },
  legendItem: { display: "flex", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block" },

  calGrid: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 1, padding: "0 8px", background: "#e5e7eb", borderRadius: 12, margin: "0 12px", overflow: "hidden" },
  calHeader: { textAlign: "center", fontWeight: 700, fontSize: 12, padding: "8px 0", background: "#f9fafb" },
  calCell: { background: "white", minHeight: 56, padding: "4px 2px", display: "flex", flexDirection: "column", alignItems: "center" },

  dayNav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", background: "white", borderBottom: "1px solid #e5e7eb" },
  dayNavBtn: { background: "none", border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 12px", cursor: "pointer", color: "#374151", fontWeight: 500, fontSize: 13, WebkitTapHighlightColor: "transparent" },
  dayNavLabel: { fontWeight: 600, color: "#3b82f6", fontSize: 14 },

  dayStatus: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", background: "white", borderBottom: "1px solid #e5e7eb" },
  dayBtn: { border: "1px solid #e5e7eb", background: "white", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, color: "#374151", WebkitTapHighlightColor: "transparent" },
  dayBtnActive: { border: "1px solid #3b82f6", background: "#eff6ff", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, color: "#3b82f6", fontWeight: 600, WebkitTapHighlightColor: "transparent" },

  shiftSection: { padding: "8px 16px", background: "white", borderBottom: "1px solid #e5e7eb" },
  shiftLabel: { fontSize: 12, color: "#6b7280", fontWeight: 600, marginBottom: 6 },
  shiftRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  shiftBtnOn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 10px", border: "2px solid #a7f3d0", borderRadius: 10, background: "#ecfdf5", cursor: "pointer", minWidth: 52, WebkitTapHighlightColor: "transparent" },
  shiftBtnOff: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 10px", border: "2px solid #fca5a5", borderRadius: 10, background: "#fef2f2", cursor: "pointer", minWidth: 52, WebkitTapHighlightColor: "transparent" },

  actionBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "1px solid #e5e7eb", borderRadius: 20, background: "white", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#374151", WebkitTapHighlightColor: "transparent" },

  gridContainer: { padding: "0 4px 100px" },
  gridHeader: { display: "grid", gap: 1, position: "sticky", top: 48, zIndex: 40, background: "#f1f5f9", borderRadius: "8px 8px 0 0", marginTop: 8 },
  timeCol: { padding: "10px 2px", fontSize: 10, fontWeight: 700, color: "#6b7280", textAlign: "center", background: "#f1f5f9" },
  colHeader: { padding: "8px 1px", fontSize: 11, fontWeight: 700, color: "#1f2937", textAlign: "center", background: "#f1f5f9", lineHeight: 1.2 },

  sectionHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#fffbeb", borderTop: "2px solid #fbbf24", marginTop: 4, fontSize: 13, fontWeight: 600, color: "#92400e" },
  sectionBtn: { border: "1px solid #e5e7eb", background: "white", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#6b7280", WebkitTapHighlightColor: "transparent" },
  sectionBtnActive: { border: "1px solid #fbbf24", background: "#fef3c7", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#92400e", fontWeight: 600, WebkitTapHighlightColor: "transparent" },

  gridBody: { background: "#e5e7eb" },
  gridRow: { display: "grid", gap: 1 },
  timeCell: { background: "#f9fafb", padding: "10px 2px", fontSize: 10, color: "#6b7280", textAlign: "center", fontWeight: 500 },
  slot: { background: "white", minHeight: 39, display: "flex", alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" },

  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100 },
  modal: { background: "white", borderRadius: "20px 20px 0 0", maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto", padding: "12px 20px 32px", WebkitOverflowScrolling: "touch" },
  modalHandle: { width: 40, height: 4, background: "#d1d5db", borderRadius: 2, margin: "0 auto 12px" },
  modalTitle: { fontSize: 18, fontWeight: 700, color: "#1f2937", marginBottom: 16, margin: 0, marginTop: 0 },
  modalField: { marginBottom: 14 },
  modalLabel: { fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6, display: "block" },

  chip: { border: "1px solid #e5e7eb", borderRadius: 20, padding: "6px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", background: "white", color: "#374151", WebkitTapHighlightColor: "transparent" },
  chipActive: { border: "2px solid #3b82f6", borderRadius: 20, padding: "5px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "#dbeafe", color: "#2563eb", WebkitTapHighlightColor: "transparent" },

  btnGroup: { display: "flex", gap: 6, flexWrap: "wrap" },
  btnGroupItem: { flex: 1, padding: "10px 8px", border: "1px solid #e5e7eb", borderRadius: 10, background: "white", fontSize: 14, fontWeight: 600, color: "#374151", cursor: "pointer", textAlign: "center", minWidth: 60, WebkitTapHighlightColor: "transparent" },
  btnGroupActive: { flex: 1, padding: "10px 8px", border: "2px solid #3b82f6", borderRadius: 10, background: "#eff6ff", fontSize: 14, fontWeight: 700, color: "#2563eb", cursor: "pointer", textAlign: "center", minWidth: 60, WebkitTapHighlightColor: "transparent" },

  textInput: { width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 14, outline: "none", boxSizing: "border-box" },
  textArea: { width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 14, outline: "none", boxSizing: "border-box", resize: "vertical" },
  timeInput: { padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, outline: "none" },

  saveBtn: { width: "100%", padding: 14, background: "#3b82f6", color: "white", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 8, WebkitTapHighlightColor: "transparent" },
  cancelBtn: { width: "100%", padding: 12, background: "white", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 12, fontSize: 14, fontWeight: 500, cursor: "pointer", WebkitTapHighlightColor: "transparent" },
  deleteBtn: { width: "100%", padding: 12, background: "#fef2f2", color: "#ef4444", border: "1px solid #fca5a5", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 8, WebkitTapHighlightColor: "transparent" },

  settingsBody: { padding: "12px 16px 40px" },
  card: { background: "white", borderRadius: 14, padding: 16, marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" },
  cardTitle: { fontSize: 15, fontWeight: 700, color: "#1f2937", marginBottom: 12, marginTop: 0 },
  smallSaveBtn: { padding: "8px 16px", background: "#3b82f6", color: "white", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 8, WebkitTapHighlightColor: "transparent" },
  addBtn: { padding: "10px 16px", background: "#3b82f6", color: "white", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" },
  outlineBtn: { width: "100%", padding: 12, background: "white", color: "#3b82f6", border: "2px solid #3b82f6", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" },
  timeRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#374151" },

  backupBtn: { flex: 1, padding: "10px 12px", background: "#f0f9ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "center", WebkitTapHighlightColor: "transparent" },
  restoreBtn: { flex: 1, padding: "10px 12px", background: "#fefce8", color: "#a16207", border: "1px solid #fde68a", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "center", WebkitTapHighlightColor: "transparent" },
  logoutBtn: { width: "100%", padding: 14, background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", marginBottom: 20, WebkitTapHighlightColor: "transparent" },

  shiftTh: { padding: "6px 4px", borderBottom: "2px solid #e5e7eb", fontWeight: 700, textAlign: "center", position: "sticky", top: 0, background: "white", zIndex: 1 },
  shiftTd: { padding: "3px 2px", borderBottom: "1px solid #f3f4f6", textAlign: "center" },
};
