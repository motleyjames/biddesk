// Company knowledge the agents consult through tools.
// ILLUSTRATIVE SAMPLE DATA for a Massachusetts electrical contractor (CEC, Hopkinton MA).
// Prices, criteria and history are placeholders to be replaced with the company's real
// price book and rules before any real use. The UI labels them as sample data.

export const COMPANY = {
  name: "Custom Electric & Communications",
  shortName: "CEC",
  homeBase: "Hopkinton, MA",
  laborRatePerHour: 105, // blended burdened labor rate, USD
  overheadPct: 0.12,
  profitPct: 0.1,
};

export type PriceItem = {
  code: string;
  description: string;
  unit: "EA" | "LF" | "MO" | "WK";
  material: number; // USD per unit
  laborHours: number; // per unit
  tags: string[];
};

export const PRICE_BOOK: PriceItem[] = [
  { code: "REC-DUP-20", description: "20A duplex receptacle, spec grade, box + plate", unit: "EA", material: 18, laborHours: 0.45, tags: ["receptacle", "outlet", "duplex", "device", "power"] },
  { code: "REC-GFCI", description: "GFCI receptacle, box + weatherproof/plate", unit: "EA", material: 32, laborHours: 0.55, tags: ["gfci", "receptacle", "outlet", "wet", "device"] },
  { code: "REC-FLOOR", description: "Floor box with duplex + data provision", unit: "EA", material: 210, laborHours: 2.0, tags: ["floor box", "receptacle", "poke-thru"] },
  { code: "SW-SP", description: "Single-pole switch with box + plate", unit: "EA", material: 14, laborHours: 0.4, tags: ["switch", "device", "lighting control"] },
  { code: "SW-OCC", description: "Occupancy/vacancy sensor wall switch", unit: "EA", material: 48, laborHours: 0.5, tags: ["occupancy", "sensor", "switch", "lighting control"] },
  { code: "LT-CTRL-RM", description: "Room lighting control package (dimming, daylight sensor)", unit: "EA", material: 420, laborHours: 3.0, tags: ["lighting control", "dimming", "daylight", "energy code"] },
  { code: "LT-TROF-2x4", description: "LED troffer 2x4, recessed, lay-in", unit: "EA", material: 135, laborHours: 1.0, tags: ["troffer", "2x4", "light", "fixture", "lighting", "led"] },
  { code: "LT-TROF-2x2", description: "LED troffer 2x2, recessed, lay-in", unit: "EA", material: 115, laborHours: 0.9, tags: ["troffer", "2x2", "light", "fixture", "lighting", "led"] },
  { code: "LT-DOWN", description: "LED 6in recessed downlight", unit: "EA", material: 85, laborHours: 0.75, tags: ["downlight", "can", "recessed", "light", "fixture", "lighting"] },
  { code: "LT-LINEAR", description: "LED linear pendant/suspended fixture, per 4ft section", unit: "EA", material: 240, laborHours: 1.4, tags: ["linear", "pendant", "light", "fixture", "lighting"] },
  { code: "LT-HIBAY", description: "LED high bay fixture", unit: "EA", material: 260, laborHours: 1.6, tags: ["high bay", "warehouse", "gym", "light", "fixture", "lighting"] },
  { code: "LT-EXIT", description: "Exit sign / emergency combo unit", unit: "EA", material: 95, laborHours: 0.75, tags: ["exit", "emergency", "egress", "life safety"] },
  { code: "LT-EMERG", description: "Emergency lighting unit (bug-eye)", unit: "EA", material: 70, laborHours: 0.6, tags: ["emergency", "egress", "life safety"] },
  { code: "LT-EXT-WP", description: "Exterior LED wall pack", unit: "EA", material: 210, laborHours: 1.5, tags: ["exterior", "wall pack", "site lighting", "outdoor"] },
  { code: "LT-POLE", description: "Site pole light with concrete base (allowance)", unit: "EA", material: 2400, laborHours: 14, tags: ["pole", "site lighting", "parking lot", "exterior"] },
  { code: "CKT-20A", description: "20A branch circuit home run (avg 75 LF MC + breaker)", unit: "EA", material: 145, laborHours: 2.5, tags: ["circuit", "branch", "home run", "dedicated"] },
  { code: "CND-EMT-34", description: "3/4in EMT conduit with fittings and supports", unit: "LF", material: 2.1, laborHours: 0.06, tags: ["conduit", "emt", "raceway"] },
  { code: "CND-EMT-2", description: "2in EMT conduit with fittings and supports", unit: "LF", material: 6.8, laborHours: 0.12, tags: ["conduit", "emt", "raceway", "feeder"] },
  { code: "CBL-MC-12", description: "12/2 MC cable installed", unit: "LF", material: 1.15, laborHours: 0.025, tags: ["mc cable", "wire", "cable"] },
  { code: "FDR-100A", description: "100A feeder, copper in conduit", unit: "LF", material: 18, laborHours: 0.18, tags: ["feeder", "wire", "service"] },
  { code: "PNL-100", description: "100A 24-circuit panelboard, 208/120V", unit: "EA", material: 1350, laborHours: 8, tags: ["panel", "panelboard", "distribution"] },
  { code: "PNL-225", description: "225A 42-circuit panelboard, 208/120V", unit: "EA", material: 3600, laborHours: 16, tags: ["panel", "panelboard", "distribution"] },
  { code: "SWBD-800", description: "800A switchboard / service entrance", unit: "EA", material: 24000, laborHours: 60, tags: ["switchboard", "service", "service upgrade", "distribution", "switchgear"] },
  { code: "SVC-UPG-400", description: "Service upgrade to 400A (allowance, excl. utility fees)", unit: "EA", material: 9800, laborHours: 48, tags: ["service upgrade", "service", "utility", "meter"] },
  { code: "XFMR-75", description: "75kVA dry-type transformer, set + terminate", unit: "EA", material: 9500, laborHours: 18, tags: ["transformer", "xfmr", "distribution"] },
  { code: "DISC-60", description: "60A fused disconnect", unit: "EA", material: 260, laborHours: 2.5, tags: ["disconnect", "safety switch"] },
  { code: "MECH-CONN", description: "HVAC/mechanical equipment connection (RTU, AHU, condenser)", unit: "EA", material: 220, laborHours: 4, tags: ["hvac", "rtu", "mechanical", "equipment", "connection", "ahu"] },
  { code: "EVSE-L2", description: "Level 2 EV charger install incl. 40A circuit (charger by others)", unit: "EA", material: 1650, laborHours: 10, tags: ["ev", "charger", "evse", "electric vehicle", "level 2"] },
  { code: "EVSE-DCFC", description: "DC fast charger install (allowance, charger by others)", unit: "EA", material: 14000, laborHours: 60, tags: ["ev", "dcfc", "fast charger", "electric vehicle"] },
  { code: "TRENCH", description: "Trenching + backfill for underground conduit", unit: "LF", material: 22, laborHours: 0.35, tags: ["trench", "underground", "site", "excavation"] },
  { code: "ATS-200", description: "200A automatic transfer switch", unit: "EA", material: 6500, laborHours: 16, tags: ["ats", "generator", "transfer switch", "standby"] },
  { code: "DATA-CAT6", description: "Cat6 data drop, terminated and tested", unit: "EA", material: 55, laborHours: 1.2, tags: ["data", "cat6", "network", "low voltage", "drop", "communications"] },
  { code: "DATA-RACK", description: "Data rack with patch panels and cable management", unit: "EA", material: 1400, laborHours: 10, tags: ["data", "rack", "idf", "mdf", "network", "communications"] },
  { code: "WAP-DROP", description: "Wireless access point drop + mount (AP by owner)", unit: "EA", material: 70, laborHours: 1.5, tags: ["wifi", "wireless", "access point", "data", "low voltage"] },
  { code: "FA-DEV", description: "Fire alarm device (detector, horn/strobe, pull station)", unit: "EA", material: 95, laborHours: 1.0, tags: ["fire alarm", "smoke detector", "strobe", "life safety"] },
  { code: "FA-PANEL", description: "Addressable fire alarm control panel (allowance)", unit: "EA", material: 5200, laborHours: 24, tags: ["fire alarm", "facp", "panel", "life safety"] },
  { code: "SEC-DOOR", description: "Access control door rough-in (card reader, contacts, REX)", unit: "EA", material: 180, laborHours: 3, tags: ["access control", "card reader", "security", "door", "low voltage"] },
  { code: "CAM-IP", description: "IP camera drop + mount (camera by others)", unit: "EA", material: 90, laborHours: 2, tags: ["camera", "cctv", "security", "low voltage"] },
  { code: "DEMO-FIX", description: "Demo existing light fixture", unit: "EA", material: 0, laborHours: 0.3, tags: ["demo", "demolition", "remove", "fixture"] },
  { code: "DEMO-DEV", description: "Demo existing device or make-safe", unit: "EA", material: 0, laborHours: 0.15, tags: ["demo", "demolition", "remove", "device"] },
  { code: "TEMP-PWR", description: "Temporary power and lighting (per month)", unit: "MO", material: 900, laborHours: 12, tags: ["temporary", "temp power", "construction power"] },
  { code: "LIFT-WK", description: "Scissor/boom lift rental (per week)", unit: "WK", material: 650, laborHours: 0, tags: ["lift", "rental", "equipment", "high ceiling"] },
  { code: "PERMIT", description: "Permit, inspections and as-builts (allowance per job)", unit: "EA", material: 1500, laborHours: 6, tags: ["permit", "inspection", "closeout"] },
];

export const BID_CRITERIA = [
  { id: "service_area", rule: "Job site within 60 driving miles of Hopkinton, MA. 45 miles or less is preferred.", hard: true },
  { id: "job_size", rule: "Estimated electrical value between $25,000 and $2,500,000. Sweet spot $75,000 to $1,200,000.", hard: true },
  { id: "bonding", rule: "Bonding capacity is $3,000,000 per project. Anything larger is an automatic decline.", hard: true },
  { id: "scope_fit", rule: "Pursue: commercial fit-outs, healthcare/medical office, education, light industrial, EV charging, low-voltage/data/security, service upgrades and building health work. Decline: single-family or multifamily residential, utility/high-voltage over 15kV, utility-scale solar.", hard: true },
  { id: "bid_window", rule: "Need at least 5 business days before the bid due date to produce a real estimate. Fewer than 3 business days is a decline unless the GC is preferred.", hard: false },
  { id: "crew_capacity", rule: "Avoid committing when the start month has under 20% crew capacity open. 20 to 35% open means pursue only if margin and relationship are strong.", hard: false },
  { id: "gc_relationship", rule: "Favor preferred GCs. Flag GCs with slow-pay or dispute history; pursue those only with a payment-terms review.", hard: false },
  { id: "scope_clarity", rule: "If drawings, quantities or key scope (service size, fixture counts) are missing, the right call is usually needs_info with specific questions, not a guess.", hard: false },
];

// Approximate driving miles from Hopkinton, MA.
export const TRAVEL_TABLE: Record<string, number> = {
  "hopkinton,ma": 0, "milford,ma": 7, "westborough,ma": 7, "ashland,ma": 5, "southborough,ma": 6,
  "framingham,ma": 9, "marlborough,ma": 10, "holliston,ma": 6, "natick,ma": 12, "shrewsbury,ma": 15,
  "wellesley,ma": 15, "sudbury,ma": 15, "needham,ma": 18, "worcester,ma": 22, "waltham,ma": 22,
  "newton,ma": 23, "dedham,ma": 24, "norwood,ma": 22, "burlington,ma": 30, "boston,ma": 30,
  "cambridge,ma": 31, "somerville,ma": 32, "woburn,ma": 32, "quincy,ma": 33, "brockton,ma": 35,
  "lowell,ma": 38, "lawrence,ma": 45, "salem,ma": 45, "providence,ri": 48, "nashua,nh": 50,
  "plymouth,ma": 55, "fall river,ma": 60, "manchester,nh": 65, "new bedford,ma": 66,
  "springfield,ma": 70, "hyannis,ma": 85, "hartford,ct": 90, "portland,me": 140, "new haven,ct": 125,
};

// Share of field crew capacity still open by start month (illustrative).
export const CREW_CAPACITY: Record<string, { openPct: number; note: string }> = {
  "2026-11": { openPct: 10, note: "Fully booked through Thanksgiving; two hospital jobs closing out." },
  "2026-12": { openPct: 18, note: "Holiday slowdown; one crew frees up mid-December." },
  "2027-01": { openPct: 35, note: "Two crews free after the Worcester school job wraps." },
  "2027-02": { openPct: 42, note: "Good availability." },
  "2027-03": { openPct: 50, note: "Good availability." },
  "2027-04": { openPct: 30, note: "Spring EV charging program starts; moderate availability." },
  "2027-05": { openPct: 25, note: "Moderate availability." },
  "2027-06": { openPct: 40, note: "Good availability." },
};

// GC relationship history (fictional companies).
export const GC_HISTORY: Record<string, { status: "preferred" | "good" | "caution" | "new"; jobs: number; wins: number; note: string }> = {
  "metrowest builders group": { status: "preferred", jobs: 9, wins: 5, note: "Pays in 30 days, fair change-order process." },
  "harborline builders": { status: "good", jobs: 4, wins: 1, note: "Bids are price-driven; tight margins." },
  "granite state construction": { status: "good", jobs: 3, wins: 2, note: "Mostly NH work." },
  "bayside contracting": { status: "caution", jobs: 2, wins: 1, note: "Paid 95 days late on last job; retainage dispute in 2025." },
  "northfield school building authority": { status: "preferred", jobs: 3, wins: 2, note: "Public owner; prevailing wage; reliable payment." },
};

export const PAST_JOBS = [
  { name: "Framingham urgent care fit-out", type: "healthcare", value: 410000, sqft: 9000, result: "won", margin: 0.14 },
  { name: "Marlborough dental suite", type: "healthcare", value: 165000, sqft: 4200, result: "won", margin: 0.16 },
  { name: "Waltham lab office renovation", type: "commercial_fitout", value: 780000, sqft: 22000, result: "lost", margin: null, note: "Lost on price by 6%" },
  { name: "Natick office fit-out", type: "commercial_fitout", value: 240000, sqft: 11000, result: "won", margin: 0.12 },
  { name: "Worcester elementary school lighting retrofit", type: "education", value: 520000, sqft: 60000, result: "won", margin: 0.11 },
  { name: "Westborough distribution center high bays", type: "light_industrial", value: 330000, sqft: 120000, result: "won", margin: 0.13 },
  { name: "Milford town hall EV chargers (8 L2)", type: "ev_charging", value: 96000, sqft: null, result: "won", margin: 0.18 },
  { name: "Shrewsbury office park EV (12 L2 + service upgrade)", type: "ev_charging", value: 188000, sqft: null, result: "lost", margin: null, note: "Utility make-ready timeline killed it" },
  { name: "Boston condo building (36 units)", type: "residential", value: 900000, sqft: 40000, result: "declined", margin: null, note: "Outside scope fit; residential" },
  { name: "Newton medical imaging suite", type: "healthcare", value: 690000, sqft: 7000, result: "won", margin: 0.15 },
];

export const PROJECT_TYPES = [
  "commercial_fitout", "healthcare", "education", "light_industrial", "ev_charging",
  "low_voltage", "service_upgrade", "residential", "utility_high_voltage", "solar", "other",
] as const;
