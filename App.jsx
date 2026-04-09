import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ============================================================
// Utility helpers
// ============================================================
const DAYS_JP = ["日", "月", "火", "水", "木", "金", "土"];
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const dayOfWeek = (s) => parseDate(s).getDay();
const timeToMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

// Japanese holidays 2025-2027
const HOLIDAYS_FIXED = [
  { name: "元日", month: 1, day: 1 }, { name: "建国記念の日", month: 2, day: 11 },
  { name: "天皇誕生日", month: 2, day: 23 }, { name: "昭和の日", month: 4, day: 29 },
  { name: "憲法記念日", month: 5, day: 3 }, { name: "みどりの日", month: 5, day: 4 },
  { name: "こどもの日", month: 5, day: 5 }, { name: "山の日", month: 8, day: 11 },
  { name: "文化の日", month: 11, day: 3 }, { name: "勤労感謝の日", month: 11, day: 23 },
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
  list.push({ name: "成人の日", date: `${year}-01-${pad(getHappyMonday(year, 1, 2))}` });
  list.push({ name: "海の日", date: `${year}-07-${pad(getHappyMonday(year, 7, 3))}` });
  list.push({ name: "スポーツの日", date: `${year}-10-${pad(getHappyMonday(year, 10, 2))}` });
  list.push({ name: "敬老の日", date: `${year}-09-${pad(getHappyMonday(year, 9, 3))}` });
  list.push({ name: "春分の日", date: `${year}-03-20` });
  list.push({ name: "秋分の日", date: `${year}-09-23` });
  list.forEach((h) => {
    if (parseDate(h.date).getDay() === 0) {
      const sub = new Date(parseDate(h.date));
      sub.setDate(sub.getDate() + 1);
      const subKey = fmtDate(sub);
      if (!list.find((x) => x.date === subKey)) list.push({ name: "振替休日", date: subKey });
    }
  });
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

// ============================================================
// Storage
// ============================================================
const LS = {
  get(k, def) { try { const v = localStorage.getItem("clinic_" + k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { localStorage.setItem("clinic_" + k, JSON.stringify(v)); },
};

// ============================================================
// Defaults
// ============================================================
const DEFAULT_SETTINGS = {
  clinicName: "診療予約管理",
  amStart: "09:00",
  amEnd: "11:30",
  pmStart: "14:00",
  pmEnd: "19:00",
  closedDays: [0],
  closedDates: [],
  pin: "1234",
  staff: ["井波", "奥村", "中野", "落合", "岸"],
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

// Build columns: staff names (通常) + 楽トレ①②
function buildCols(staff) {
  const staffCols = (staff || []).map((name) => ({ id: `staff_${name}`, label: name, type: "通常" }));
  const rakuCols = [
    { id: "raku_1", label: "楽トレ①", type: "楽トレ" },
    { id: "raku_2", label: "楽トレ②", type: "楽トレ" },
  ];
  return [...staffCols, ...rakuCols];
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

  useEffect(() => { LS.set("settings", settings); }, [settings]);
  useEffect(() => { LS.set("bookings", bookings); }, [bookings]);
  useEffect(() => { LS.set("dayOff", dayOff); }, [dayOff]);
  useEffect(() => { LS.set("shifts", shifts); }, [shifts]);

  const holidays = useMemo(() => {
    const h = {};
    [2025, 2026, 2027].forEach((y) => getJPHolidays(y).forEach((hol) => { h[hol.date] = hol.name; }));
    return h;
  }, []);

  const cols = useMemo(() => buildCols(settings.staff), [settings.staff]);

  if (!loggedIn) return <LoginScreen settings={settings} onLogin={() => setLoggedIn(true)} />;

  const commonProps = { settings, holidays, bookings, setBookings, dayOff, setDayOff, shifts, setShifts, cols };

  return (
    <div style={S.appContainer}>
      {screen === "calendar" && (
        <CalendarScreen {...commonProps}
          calMonth={calMonth} setCalMonth={setCalMonth}
          onSelectDate={(d) => { setSelectedDate(d); setScreen("day"); }}
          onSettings={() => setScreen("settings")}
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
  const handleLogin = () => {
    if (pin === settings.pin) { onLogin(); }
    else { setError(true); setShake(true); setTimeout(() => setShake(false), 500); setTimeout(() => setError(false), 2000); }
  };
  return (
    <div style={S.loginBg}>
      <div style={S.loginCenter}>
        <div style={{ fontSize: 48, marginBottom: 4 }}>🏥</div>
        <h1 style={S.loginTitle}>{settings.clinicName}</h1>
        <div style={{ ...S.loginCard, animation: shake ? "shake 0.4s ease" : "none" }}>
          <div style={S.loginLabel}>スタッフログイン</div>
          <div style={S.loginDivider} />
          <input type="password" maxLength={8} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="PINを入力" style={S.pinInput} autoFocus />
          {error && <div style={S.errorText}>PINが正しくありません</div>}
          <button onClick={handleLogin} style={S.loginBtn}>ログイン</button>
          <div style={S.pinHint}>初期PIN: 1234</div>
        </div>
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}`}</style>
    </div>
  );
}

// ============================================================
// Calendar
// ============================================================
function CalendarScreen({ calMonth, setCalMonth, settings, holidays, bookings, dayOff, onSelectDate, onSettings }) {
  const { year, month } = calMonth;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = fmtDate(new Date());
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const prevMonth = () => setCalMonth((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 });
  const nextMonth = () => setCalMonth((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 });
  const getDateKey = (d) => `${year}-${pad(month + 1)}-${pad(d)}`;
  const hasBookings = (d) => { const b = bookings[getDateKey(d)]; return b && Object.keys(b).length > 0; };
  const isHoliday = (d) => holidays[getDateKey(d)];
  const isClosed = (d) => {
    const key = getDateKey(d); const dow = parseDate(key).getDay();
    return settings.closedDays.includes(dow) || (settings.closedDates || []).includes(key);
  };
  const isOff = (d) => { const off = dayOff[getDateKey(d)]; return off && off.fullDay; };

  return (
    <div style={S.screenBg}>
      <div style={S.header}>
        <div style={{ width: 50 }} />
        <h1 style={S.headerTitle}>{settings.clinicName}</h1>
        <button onClick={onSettings} style={S.settingsBtn}>設定</button>
      </div>
      <div style={S.monthNav}>
        <button onClick={prevMonth} style={S.navArrow}>‹</button>
        <span style={S.monthLabel}>{year}年{month + 1}月</span>
        <button onClick={nextMonth} style={S.navArrow}>›</button>
      </div>
      <div style={S.legend}>
        <span style={S.legendItem}><span style={{ ...S.legendDot, background: "#3b82f6" }} /> 通常治療</span>
        <span style={S.legendItem}><span style={{ ...S.legendDot, background: "#22c55e" }} /> 楽トレ</span>
        <span style={S.legendItem}><span style={{ background: "#ef4444", width: 10, height: 10, borderRadius: 2, display: "inline-block" }} /> 祝日</span>
        <span style={S.legendItem}><span style={{ color: "#9ca3af", fontWeight: 500 }}>—</span> 休診</span>
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
            <div key={d} onClick={() => onSelectDate(key)}
              style={{ ...S.calCell, cursor: "pointer", background: closed || off ? "#f3f4f6" : hol ? "#fef2f2" : "white", opacity: closed && !hol ? 0.5 : 1 }}>
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
  const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日（${DAYS_JP[d.getDay()]}）`;
  const fullLabel = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${DAYS_JP[d.getDay()]}）`;
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

  const prevDay = () => { const p = new Date(d); p.setDate(p.getDate() - 1); setDate(fmtDate(p)); };
  const nextDay = () => { const n = new Date(d); n.setDate(n.getDate() + 1); setDate(fmtDate(n)); };
  const goToday = () => setDate(fmtDate(new Date()));

  const toggleDayOff = () => setDayOff((prev) => ({ ...prev, [date]: { ...dayData, fullDay: !fullDayOff } }));
  const toggleAmOff = () => setDayOff((prev) => ({ ...prev, [date]: { ...dayData, amOff: !amOff } }));
  const togglePmOff = () => setDayOff((prev) => ({ ...prev, [date]: { ...dayData, pmOff: !pmOff } }));

  const toggleStaffShift = (staffName) => {
    setShifts((prev) => {
      const ds = prev[date] || {};
      return { ...prev, [date]: { ...ds, [staffName]: !ds[staffName] } };
    });
  };

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

  const addBooking = (booking) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setBookings((prev) => ({ ...prev, [date]: { ...(prev[date] || {}), [id]: booking } }));
    setShowAddModal(null);
  };
  const updateBooking = (id, booking) => {
    setBookings((prev) => ({ ...prev, [date]: { ...(prev[date] || {}), [id]: booking } }));
    setShowEditModal(null);
  };
  const deleteBooking = (id) => {
    setBookings((prev) => { const day = { ...(prev[date] || {}) }; delete day[id]; return { ...prev, [date]: day }; });
    setShowEditModal(null);
  };
  const addBlock = (block) => {
    setDayOff((prev) => ({ ...prev, [date]: { ...dayData, blocks: [...blocks, block] } }));
    setShowBlockModal(false);
  };

  const colCount = cols.length;
  const gridCols = `44px repeat(${colCount}, 1fr)`;

  const renderSlot = (time, col, isAmSection) => {
    const colStaffName = col.type === "通常" ? col.label : null;
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
        const isRaku = col.type === "楽トレ";
        return (
          <div key={`${time}-${col.id}`}
            onClick={() => setShowEditModal({ id: occupied.id, ...occupied })}
            style={{
              ...S.slot, height: 40 * slotsSpan - 1,
              background: isRaku ? "#dcfce7" : "#dbeafe",
              borderLeft: `3px solid ${isRaku ? "#22c55e" : "#3b82f6"}`,
              cursor: "pointer", overflow: "hidden", padding: "2px 4px",
              display: "flex", flexDirection: "column", justifyContent: "center",
            }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#1f2937", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {occupied.isNew && <span style={{ fontSize: 8, background: "#fbbf24", color: "#78350f", borderRadius: 3, padding: "1px 3px", marginRight: 2, fontWeight: 700 }}>新規</span>}
              {occupied.patient}
            </div>
            <div style={{ fontSize: 9, color: "#6b7280" }}>
              {occupied.duration}分{occupied.staff ? ` / ${occupied.staff}` : ""}
            </div>
          </div>
        );
      }
      return null;
    }

    return (
      <div key={`${time}-${col.id}`} onClick={() => setShowAddModal({ time, col })} style={{ ...S.slot, cursor: "pointer" }}>
        <span style={{ color: "#d1d5db", fontSize: 14 }}>+</span>
      </div>
    );
  };

  return (
    <div style={S.screenBg}>
      <div style={S.header}>
        <button onClick={onBack} style={S.backBtn}>← カレンダー</button>
        <span style={S.headerTitle2}>{dateLabel}</span>
        <button onClick={goToday} style={S.todayBtn}>今日</button>
      </div>

      <div style={S.dayNav}>
        <button onClick={prevDay} style={S.dayNavBtn}>‹ 前日</button>
        <span style={S.dayNavLabel}>{fullLabel}</span>
        <button onClick={nextDay} style={S.dayNavBtn}>翌日 ›</button>
      </div>

      <div style={S.dayStatus}>
        {hol ? <span style={{ color: "#ef4444", fontWeight: 600 }}>🎌 {hol}</span>
          : fullDayOff || isClosed ? <span style={{ color: "#9ca3af", fontWeight: 600 }}>休診日</span>
          : <span style={{ color: "#22c55e", fontWeight: 600 }}>✅ 診療日</span>}
        {!isClosed && (
          <button onClick={toggleDayOff} style={fullDayOff ? S.dayBtnActive : S.dayBtn}>
            {fullDayOff ? "診療日にする" : "この日を休診にする"}
          </button>
        )}
      </div>

      {/* Staff shift toggles */}
      {settings.staff && settings.staff.length > 0 && (
        <div style={S.shiftSection}>
          <div style={S.shiftLabel}>スタッフ出勤状況（タップで切替）</div>
          <div style={S.shiftRow}>
            {settings.staff.map((name) => {
              const off = isStaffOff(name);
              return (
                <button key={name} onClick={() => toggleStaffShift(name)}
                  style={off ? S.shiftBtnOff : S.shiftBtnOn}>
                  <span style={{ fontSize: 14 }}>{off ? "🚫" : "✅"}</span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{name}</span>
                  <span style={{ fontSize: 10, color: off ? "#ef4444" : "#059669" }}>{off ? "休み" : "出勤"}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ padding: "4px 8px" }}>
        <button onClick={() => setShowBlockModal(true)} style={S.actionBtn}>
          🕐 時間をブロック
        </button>
      </div>

      {/* Time grid */}
      <div style={S.gridContainer}>
        <div style={{ ...S.gridHeader, gridTemplateColumns: gridCols }}>
          <div style={S.timeCol}>時刻</div>
          {cols.map((c) => {
            const staffIsOff = c.type === "通常" && isStaffOff(c.label);
            return (
              <div key={c.id} style={{
                ...S.colHeader,
                fontSize: colCount > 5 ? 10 : 11,
                color: staffIsOff ? "#ef4444" : c.type === "楽トレ" ? "#059669" : "#1f2937",
                background: c.type === "楽トレ" ? "#f0fdf4" : "#f1f5f9",
                opacity: staffIsOff ? 0.6 : 1,
              }}>
                {c.label}
                {staffIsOff && <div style={{ fontSize: 8, color: "#ef4444" }}>休</div>}
              </div>
            );
          })}
        </div>

        <div style={S.sectionHeader}>
          <span>🌅 午前 〜{settings.amEnd}</span>
          <button onClick={toggleAmOff} style={amOff ? S.sectionBtnActive : S.sectionBtn}>
            {amOff ? "午前再開" : "午前休み"}
          </button>
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
          <span>🌙 午後</span>
          <button onClick={togglePmOff} style={pmOff ? S.sectionBtnActive : S.sectionBtn}>
            {pmOff ? "午後再開" : "午後休み"}
          </button>
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
  const dateLabel = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${DAYS_JP[d.getDay()]}）${time}`;
  const [selectedCol, setSelectedCol] = useState(col.id);
  const [duration, setDuration] = useState(30);
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [patient, setPatient] = useState("");
  const [memo, setMemo] = useState("");
  const [staff, setStaff] = useState(col.type === "通常" ? col.label : "");

  const handleSave = () => {
    if (!patient.trim()) return;
    const sc = cols.find((c) => c.id === selectedCol) || col;
    onSave({ time, colId: selectedCol, colLabel: sc.label, colType: sc.type, duration, patient: patient.trim(), memo, staff, isNew: isNewPatient });
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div style={S.modal}>
        <div style={S.modalHandle} />
        <h2 style={S.modalTitle}>予約を追加</h2>
        <div style={S.modalField}>
          <label style={S.modalLabel}>日時</label>
          <div style={{ color: "#3b82f6", fontWeight: 600 }}>{dateLabel}</div>
        </div>
        <div style={S.modalField}>
          <label style={S.modalLabel}>列</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {cols.map((c) => (
              <button key={c.id} onClick={() => { setSelectedCol(c.id); if (c.type === "通常") setStaff(c.label); }}
                style={{ ...(selectedCol === c.id ? S.chipActive : S.chip), background: selectedCol === c.id ? (c.type === "楽トレ" ? "#dcfce7" : "#dbeafe") : "white", borderColor: selectedCol === c.id ? (c.type === "楽トレ" ? "#22c55e" : "#3b82f6") : "#e5e7eb", color: selectedCol === c.id ? (c.type === "楽トレ" ? "#059669" : "#2563eb") : "#374151" }}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div style={S.modalField}>
          <label style={S.modalLabel}>時間</label>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>通常</div>
          <div style={S.btnGroup}>
            {[15, 30, 45, 60].map((m) => (
              <button key={m} onClick={() => { setDuration(m); setIsNewPatient(false); }}
                style={duration === m && !isNewPatient ? S.btnGroupActive : S.btnGroupItem}>{m}分</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, marginTop: 10 }}>新規</div>
          <div style={S.btnGroup}>
            <button onClick={() => { setDuration(60); setIsNewPatient(true); }}
              style={isNewPatient ? S.btnGroupActive : S.btnGroupItem}>
              60分<div style={{ fontSize: 10, color: isNewPatient ? "#3b82f6" : "#6b7280" }}>新規</div>
            </button>
          </div>
        </div>
        <div style={S.modalField}>
          <label style={S.modalLabel}>患者名</label>
          <input value={patient} onChange={(e) => setPatient(e.target.value)} placeholder="例：田中 太郎" style={S.textInput} autoFocus />
        </div>
        {settings.staff && settings.staff.length > 0 && (
          <div style={S.modalField}>
            <label style={S.modalLabel}>担当スタッフ（任意）</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => setStaff("")} style={staff === "" ? S.chipActive : S.chip}>指定なし</button>
              {settings.staff.map((s) => (
                <button key={s} onClick={() => setStaff(s)} style={staff === s ? S.chipActive : S.chip}>{s}</button>
              ))}
            </div>
          </div>
        )}
        <div style={S.modalField}>
          <label style={S.modalLabel}>メモ（任意）</label>
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="備考など" style={S.textArea} rows={2} />
        </div>
        <button onClick={handleSave} style={S.saveBtn}>✅ 予約を保存</button>
        <button onClick={onClose} style={S.cancelBtn}>キャンセル</button>
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

  return (
    <ModalOverlay onClose={onClose}>
      <div style={S.modal}>
        <div style={S.modalHandle} />
        <h2 style={S.modalTitle}>予約を編集</h2>
        <div style={S.modalField}>
          <label style={S.modalLabel}>列</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {cols.map((c) => (
              <button key={c.id} onClick={() => setSelectedCol(c.id)}
                style={{ ...(selectedCol === c.id ? S.chipActive : S.chip), background: selectedCol === c.id ? (c.type === "楽トレ" ? "#dcfce7" : "#dbeafe") : "white", borderColor: selectedCol === c.id ? (c.type === "楽トレ" ? "#22c55e" : "#3b82f6") : "#e5e7eb", color: selectedCol === c.id ? (c.type === "楽トレ" ? "#059669" : "#2563eb") : "#374151" }}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div style={S.modalField}>
          <label style={S.modalLabel}>時間</label>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>通常</div>
          <div style={S.btnGroup}>
            {[15, 30, 45, 60].map((m) => (
              <button key={m} onClick={() => { setDuration(m); setIsNewPatient(false); }} style={duration === m && !isNewPatient ? S.btnGroupActive : S.btnGroupItem}>{m}分</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, marginTop: 10 }}>新規</div>
          <div style={S.btnGroup}>
            <button onClick={() => { setDuration(60); setIsNewPatient(true); }} style={isNewPatient ? S.btnGroupActive : S.btnGroupItem}>
              60分<div style={{ fontSize: 10, color: isNewPatient ? "#3b82f6" : "#6b7280" }}>新規</div>
            </button>
          </div>
        </div>
        <div style={S.modalField}>
          <label style={S.modalLabel}>患者名</label>
          <input value={patient} onChange={(e) => setPatient(e.target.value)} style={S.textInput} />
        </div>
        {settings.staff && settings.staff.length > 0 && (
          <div style={S.modalField}>
            <label style={S.modalLabel}>担当スタッフ</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => setStaff("")} style={staff === "" ? S.chipActive : S.chip}>指定なし</button>
              {settings.staff.map((s) => (
                <button key={s} onClick={() => setStaff(s)} style={staff === s ? S.chipActive : S.chip}>{s}</button>
              ))}
            </div>
          </div>
        )}
        <div style={S.modalField}>
          <label style={S.modalLabel}>メモ</label>
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} style={S.textArea} rows={2} />
        </div>
        <button onClick={() => { const sc = cols.find((c) => c.id === selectedCol); onSave({ ...booking, colId: selectedCol, colLabel: sc?.label, colType: sc?.type, patient, duration, memo, staff, isNew: isNewPatient }); }} style={S.saveBtn}>✅ 更新</button>
        <button onClick={onDelete} style={S.deleteBtn}>🗑️ 削除</button>
        <button onClick={onClose} style={S.cancelBtn}>キャンセル</button>
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
        <h2 style={S.modalTitle}>時間帯をブロック</h2>
        <div style={S.modalField}>
          <label style={S.modalLabel}>開始時間</label>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={S.textInput} />
        </div>
        <div style={S.modalField}>
          <label style={S.modalLabel}>終了時間</label>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={S.textInput} />
        </div>
        <div style={S.modalField}>
          <label style={S.modalLabel}>対象列</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {cols.map((c) => (
              <button key={c.id} onClick={() => toggleCol(c.id)} style={selCols.includes(c.id) ? S.chipActive : S.chip}>{c.label}</button>
            ))}
          </div>
        </div>
        <button onClick={() => onSave({ start, end, colIds: selCols })} style={S.saveBtn}>ブロック設定</button>
        <button onClick={onClose} style={S.cancelBtn}>キャンセル</button>
      </div>
    </ModalOverlay>
  );
}

function ModalOverlay({ children, onClose }) {
  return (
    <div style={S.overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

// ============================================================
// Settings Screen
// ============================================================
function SettingsScreen({ settings, setSettings, holidays, bookings, setBookings, shifts, setShifts, onBack, onLogout }) {
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

  const showSaved = (key) => { setSaved((p) => ({ ...p, [key]: true })); setTimeout(() => setSaved((p) => ({ ...p, [key]: false })), 1500); };
  const saveClinicName = () => { setSettings((s) => ({ ...s, clinicName: tempClinicName })); showSaved("name"); };
  const saveHours = () => { setSettings((s) => ({ ...s, amStart: tempAmStart, amEnd: tempAmEnd, pmStart: tempPmStart, pmEnd: tempPmEnd })); showSaved("hours"); };
  const saveClosedDays = () => { setSettings((s) => ({ ...s, closedDays })); showSaved("closed"); };
  const toggleClosedDay = (d) => setClosedDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  const addClosedDate = () => { if (!closedDates.includes(newClosedDate)) { const u = [...closedDates, newClosedDate].sort(); setClosedDates(u); setSettings((s) => ({ ...s, closedDates: u })); } };
  const removeClosedDate = (d) => { const u = closedDates.filter((x) => x !== d); setClosedDates(u); setSettings((s) => ({ ...s, closedDates: u })); };
  const changePin = () => {
    if (currentPin !== settings.pin) { setPinMsg("現在のPINが正しくありません"); return; }
    if (newPin.length < 4 || newPin.length > 8) { setPinMsg("PINは4〜8桁で入力してください"); return; }
    setSettings((s) => ({ ...s, pin: newPin })); setPinMsg("PINを変更しました！"); setCurrentPin(""); setNewPin("");
  };
  const addStaff = () => { const name = newStaffName.trim(); if (!name || staffList.includes(name)) return; const u = [...staffList, name]; setStaffList(u); setSettings((s) => ({ ...s, staff: u })); setNewStaffName(""); };
  const removeStaff = (name) => { const u = staffList.filter((s) => s !== name); setStaffList(u); setSettings((s) => ({ ...s, staff: u })); };
  const moveStaff = (index, dir) => { const u = [...staffList]; const ni = index + dir; if (ni < 0 || ni >= u.length) return; [u[index], u[ni]] = [u[ni], u[index]]; setStaffList(u); setSettings((s) => ({ ...s, staff: u })); };

  const handleBackup = () => {
    const data = { settings, bookings, shifts, version: "4.0" };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `clinic-backup-${fmtDate(new Date())}.json`; a.click();
  };
  const handleRestore = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { try { const data = JSON.parse(ev.target.result); if (data.settings) setSettings(data.settings); if (data.bookings) setBookings(data.bookings); if (data.shifts) setShifts(data.shifts); alert("復元しました！"); } catch { alert("ファイルが正しくありません"); } };
    reader.readAsText(file);
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

  return (
    <div style={S.screenBg}>
      <div style={S.header}>
        <button onClick={onBack} style={S.backBtn}>← 戻る</button>
        <span style={S.headerTitle2}>設定 <span style={{ fontSize: 12, color: "#93c5fd" }}>v4.0</span></span>
        <div style={{ width: 60 }} />
      </div>
      <div style={S.settingsBody}>
        {/* Clinic name */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>クリニック名</h3>
          <input value={tempClinicName} onChange={(e) => setTempClinicName(e.target.value)} style={S.textInput} />
          <button onClick={saveClinicName} style={S.smallSaveBtn}>{saved.name ? "✅ 保存しました" : "保存"}</button>
        </div>

        {/* Hours */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>診療時間</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }}>🌅</span><span style={{ fontWeight: 600 }}>午前</span>
          </div>
          <div style={S.timeRow}>
            <span>開始</span><input type="time" value={tempAmStart} onChange={(e) => setTempAmStart(e.target.value)} style={S.timeInput} />
            <span>〜 終了</span><input type="time" value={tempAmEnd} onChange={(e) => setTempAmEnd(e.target.value)} style={S.timeInput} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 8px" }}>
            <span style={{ fontSize: 20 }}>🌙</span><span style={{ fontWeight: 600 }}>午後</span>
          </div>
          <div style={S.timeRow}>
            <span>開始</span><input type="time" value={tempPmStart} onChange={(e) => setTempPmStart(e.target.value)} style={S.timeInput} />
            <span>〜 終了</span><input type="time" value={tempPmEnd} onChange={(e) => setTempPmEnd(e.target.value)} style={S.timeInput} />
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>※ 終了は最後の枠の開始時刻（15分単位）</div>
          <button onClick={saveHours} style={S.smallSaveBtn}>{saved.hours ? "✅ 保存しました" : "保存"}</button>
        </div>

        {/* Staff management */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>👤 スタッフ管理</h3>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>登録したスタッフ名が予約表の通常治療列になります。</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input value={newStaffName} onChange={(e) => setNewStaffName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStaff()} placeholder="スタッフ名を入力" style={{ ...S.textInput, flex: 1 }} />
            <button onClick={addStaff} style={S.addBtn}>追加</button>
          </div>
          {staffList.length === 0 ? <div style={{ color: "#9ca3af", textAlign: "center", padding: 8 }}>スタッフ未登録</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {staffList.map((name, idx) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#eff6ff", color: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{idx + 1}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#1f2937" }}>{name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button onClick={() => moveStaff(idx, -1)} disabled={idx === 0} style={{ border: "none", background: "none", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? "#d1d5db" : "#6b7280", fontSize: 16, padding: "2px 6px" }}>↑</button>
                    <button onClick={() => moveStaff(idx, 1)} disabled={idx === staffList.length - 1} style={{ border: "none", background: "none", cursor: idx === staffList.length - 1 ? "default" : "pointer", color: idx === staffList.length - 1 ? "#d1d5db" : "#6b7280", fontSize: 16, padding: "2px 6px" }}>↓</button>
                    <button onClick={() => removeStaff(name)} style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer", fontSize: 18, padding: "2px 6px" }}>×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ==================== SHIFT CALENDAR ==================== */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>📅 シフト管理</h3>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>スタッフの出勤/休みを月単位で管理。休みにすると予約表の該当列が赤くなります。</p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button onClick={prevShiftMonth} style={S.navArrowSm}>‹</button>
            <span style={{ fontWeight: 700, fontSize: 15, color: "#1f2937" }}>{sy}年{sm + 1}月</span>
            <button onClick={nextShiftMonth} style={S.navArrowSm}>›</button>
          </div>
          {staffList.length === 0 ? <div style={{ color: "#9ca3af", textAlign: "center", padding: 16 }}>スタッフを先に登録してください</div> : (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th style={S.shiftTh}>日付</th>
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
                              <button onClick={() => toggleShift(dateStr, name)}
                                style={{
                                  width: "100%", padding: "4px 0", border: "none", borderRadius: 4, cursor: "pointer",
                                  background: isOff ? "#fee2e2" : "#dcfce7",
                                  color: isOff ? "#ef4444" : "#059669",
                                  fontWeight: 600, fontSize: 11,
                                }}>
                                {isOff ? "休" : "○"}
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
          <h3 style={S.cardTitle}>定休曜日</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {DAYS_JP.map((d, i) => (
              <button key={d} onClick={() => toggleClosedDay(i)} style={{
                width: 44, height: 44, borderRadius: "50%",
                border: closedDays.includes(i) ? "2px solid #ef4444" : "2px solid #e5e7eb",
                background: closedDays.includes(i) ? "#fef2f2" : "white",
                color: closedDays.includes(i) ? "#ef4444" : "#374151",
                fontWeight: 600, cursor: "pointer", fontSize: 14,
              }}>{d}</button>
            ))}
          </div>
          <button onClick={saveClosedDays} style={S.smallSaveBtn}>{saved.closed ? "✅ 保存しました" : "保存"}</button>
        </div>

        {/* Closed dates */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>休診日（特定日）</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input type="date" value={newClosedDate} onChange={(e) => setNewClosedDate(e.target.value)} style={S.timeInput} />
            <button onClick={addClosedDate} style={S.addBtn}>追加</button>
          </div>
          {closedDates.length === 0 ? <div style={{ color: "#9ca3af", textAlign: "center" }}>登録なし</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {closedDates.map((d) => (
                <div key={d} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", background: "#f9fafb", borderRadius: 6 }}>
                  <span style={{ fontSize: 14 }}>{d}（{DAYS_JP[dayOfWeek(d)]}）</span>
                  <button onClick={() => removeClosedDate(d)} style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer", fontSize: 18 }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Holidays */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>祝日一覧（自動設定・変更不可）</h3>
          <div style={{ maxHeight: 200, overflow: "auto" }}>
            {allHolidays.slice(0, 20).map((h) => (
              <div key={h.date + h.name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>
                <span>{h.name}</span>
                <span style={{ color: "#6b7280" }}>{h.date.replace(/-/g, "/")}（{DAYS_JP[dayOfWeek(h.date)]}）</span>
              </div>
            ))}
          </div>
        </div>

        {/* PIN */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>PIN変更</h3>
          <div style={S.modalField}>
            <label style={S.modalLabel}>現在のPIN</label>
            <input type="password" value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))} placeholder="現在のPIN" style={S.textInput} maxLength={8} />
          </div>
          <div style={S.modalField}>
            <label style={S.modalLabel}>新しいPIN（4〜8桁）</label>
            <input type="password" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} placeholder="新しいPIN" style={S.textInput} maxLength={8} />
          </div>
          {pinMsg && <div style={{ color: pinMsg.includes("変更") ? "#22c55e" : "#ef4444", fontSize: 13, marginBottom: 8 }}>{pinMsg}</div>}
          <button onClick={changePin} style={S.outlineBtn}>PINを変更する</button>
        </div>

        {/* Backup */}
        <div style={S.card}>
          <h3 style={S.cardTitle}>バックアップ & 復元</h3>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>データのバックアップと復元ができます。</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleBackup} style={S.backupBtn}>📦 バックアップ</button>
            <label style={S.restoreBtn}>🔄 復元する<input type="file" accept=".json" onChange={handleRestore} style={{ display: "none" }} /></label>
          </div>
        </div>

        <button onClick={onLogout} style={S.logoutBtn}>ログアウト</button>
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
  loginBtn: { width: "100%", padding: 14, background: "#3b82f6", color: "white", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: "pointer", marginBottom: 8 },
  pinHint: { fontSize: 13, color: "#9ca3af" },
  errorText: { color: "#ef4444", fontSize: 13, marginBottom: 8 },
  header: { background: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "white", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 },
  headerTitle: { fontSize: 18, fontWeight: 700, flex: 1, textAlign: "center" },
  headerTitle2: { fontSize: 16, fontWeight: 700 },
  settingsBtn: { background: "rgba(255,255,255,0.2)", border: "none", color: "white", padding: "6px 14px", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13 },
  backBtn: { background: "none", border: "none", color: "white", cursor: "pointer", fontWeight: 600, fontSize: 14, padding: "4px 0" },
  todayBtn: { background: "rgba(255,255,255,0.2)", border: "none", color: "white", padding: "6px 12px", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13 },
  monthNav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px" },
  navArrow: { width: 36, height: 36, borderRadius: "50%", border: "1px solid #e5e7eb", background: "white", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#374151" },
  navArrowSm: { width: 30, height: 30, borderRadius: "50%", border: "1px solid #e5e7eb", background: "white", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#374151" },
  monthLabel: { fontSize: 18, fontWeight: 700, color: "#1f2937" },
  legend: { display: "flex", gap: 12, justifyContent: "center", padding: "4px 16px 8px", fontSize: 12, color: "#6b7280", flexWrap: "wrap" },
  legendItem: { display: "flex", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block" },
  calGrid: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 1, padding: "0 8px", background: "#e5e7eb", borderRadius: 12, margin: "0 12px", overflow: "hidden" },
  calHeader: { textAlign: "center", fontWeight: 700, fontSize: 12, padding: "8px 0", background: "#f9fafb" },
  calCell: { background: "white", minHeight: 56, padding: "4px 2px", display: "flex", flexDirection: "column", alignItems: "center" },
  dayNav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", background: "white", borderBottom: "1px solid #e5e7eb" },
  dayNavBtn: { background: "none", border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 12px", cursor: "pointer", color: "#374151", fontWeight: 500, fontSize: 13 },
  dayNavLabel: { fontWeight: 600, color: "#3b82f6", fontSize: 14 },
  dayStatus: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", background: "white", borderBottom: "1px solid #e5e7eb" },
  dayBtn: { border: "1px solid #e5e7eb", background: "white", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, color: "#374151" },
  dayBtnActive: { border: "1px solid #3b82f6", background: "#eff6ff", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, color: "#3b82f6", fontWeight: 600 },
  shiftSection: { padding: "8px 16px", background: "white", borderBottom: "1px solid #e5e7eb" },
  shiftLabel: { fontSize: 12, color: "#6b7280", fontWeight: 600, marginBottom: 6 },
  shiftRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  shiftBtnOn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 10px", border: "2px solid #a7f3d0", borderRadius: 10, background: "#ecfdf5", cursor: "pointer", minWidth: 52 },
  shiftBtnOff: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 10px", border: "2px solid #fca5a5", borderRadius: 10, background: "#fef2f2", cursor: "pointer", minWidth: 52 },
  actionBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "1px solid #e5e7eb", borderRadius: 20, background: "white", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#374151" },
  gridContainer: { padding: "0 4px 100px" },
  gridHeader: { display: "grid", gap: 1, position: "sticky", top: 48, zIndex: 40, background: "#f1f5f9", borderRadius: "8px 8px 0 0", marginTop: 8 },
  timeCol: { padding: "10px 2px", fontSize: 10, fontWeight: 700, color: "#6b7280", textAlign: "center", background: "#f1f5f9" },
  colHeader: { padding: "8px 1px", fontSize: 11, fontWeight: 700, color: "#1f2937", textAlign: "center", background: "#f1f5f9", lineHeight: 1.2 },
  sectionHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#fffbeb", borderTop: "2px solid #fbbf24", marginTop: 4, fontSize: 13, fontWeight: 600, color: "#92400e" },
  sectionBtn: { border: "1px solid #e5e7eb", background: "white", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#6b7280" },
  sectionBtnActive: { border: "1px solid #fbbf24", background: "#fef3c7", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#92400e", fontWeight: 600 },
  gridBody: { background: "#e5e7eb" },
  gridRow: { display: "grid", gap: 1 },
  timeCell: { background: "#f9fafb", padding: "10px 2px", fontSize: 10, color: "#6b7280", textAlign: "center", fontWeight: 500 },
  slot: { background: "white", height: 39, display: "flex", alignItems: "center", justifyContent: "center", cursor: "default" },
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100 },
  modal: { background: "white", borderRadius: "20px 20px 0 0", padding: "16px 24px 32px", width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto" },
  modalHandle: { width: 40, height: 4, borderRadius: 2, background: "#d1d5db", margin: "0 auto 16px" },
  modalTitle: { fontSize: 20, fontWeight: 700, color: "#1f2937", marginBottom: 16 },
  modalField: { marginBottom: 16 },
  modalLabel: { fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 6, display: "block" },
  btnGroup: { display: "flex", gap: 8 },
  btnGroupItem: { flex: 1, padding: "10px 6px", border: "2px solid #e5e7eb", borderRadius: 10, background: "white", cursor: "pointer", fontSize: 14, fontWeight: 500, color: "#374151", textAlign: "center" },
  btnGroupActive: { flex: 1, padding: "10px 6px", border: "2px solid #3b82f6", borderRadius: 10, background: "#eff6ff", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#3b82f6", textAlign: "center" },
  chip: { padding: "8px 12px", border: "2px solid #e5e7eb", borderRadius: 20, background: "white", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#374151" },
  chipActive: { padding: "8px 12px", border: "2px solid #3b82f6", borderRadius: 20, background: "#eff6ff", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#3b82f6" },
  textInput: { width: "100%", padding: 12, border: "2px solid #e5e7eb", borderRadius: 10, fontSize: 15, outline: "none", boxSizing: "border-box" },
  textArea: { width: "100%", padding: 12, border: "2px solid #e5e7eb", borderRadius: 10, fontSize: 15, outline: "none", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" },
  saveBtn: { width: "100%", padding: 14, background: "#3b82f6", color: "white", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: "pointer", marginBottom: 8 },
  deleteBtn: { width: "100%", padding: 14, background: "#fef2f2", color: "#ef4444", border: "1px solid #fca5a5", borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: "pointer", marginBottom: 8 },
  cancelBtn: { width: "100%", padding: 14, background: "#f3f4f6", color: "#6b7280", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: "pointer" },
  settingsBody: { padding: "12px 12px 40px" },
  card: { background: "white", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" },
  cardTitle: { fontSize: 15, fontWeight: 700, color: "#3b82f6", marginBottom: 12 },
  timeRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#374151", flexWrap: "wrap" },
  timeInput: { padding: "8px 12px", border: "2px solid #e5e7eb", borderRadius: 8, fontSize: 14, outline: "none" },
  smallSaveBtn: { marginTop: 12, padding: "8px 20px", background: "#3b82f6", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  addBtn: { padding: "8px 20px", background: "#ef4444", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  outlineBtn: { padding: "10px 20px", background: "white", color: "#3b82f6", border: "2px solid #3b82f6", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  backupBtn: { padding: "10px 16px", background: "#3b82f6", color: "white", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 },
  restoreBtn: { padding: "10px 16px", background: "#fef2f2", color: "#ef4444", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 },
  logoutBtn: { width: "100%", padding: 14, background: "white", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: "pointer", marginTop: 8 },
  shiftTh: { padding: "6px 4px", borderBottom: "2px solid #e5e7eb", background: "#f9fafb", fontWeight: 700, fontSize: 11, textAlign: "center", position: "sticky", top: 0, zIndex: 1 },
  shiftTd: { padding: "3px 2px", borderBottom: "1px solid #f3f4f6", textAlign: "center", fontSize: 11 },
};
