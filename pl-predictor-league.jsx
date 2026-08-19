import React, { useState, useEffect, useRef, useCallback } from "react";
import { Trophy, Plus, X, Zap, Star, ChevronLeft, ChevronRight, Loader2, Users, ListChecks, Award, Check } from "lucide-react";

const COLORS = {
  purple: "#38003C",
  purpleMid: "#5A1E64",
  pink: "#E90052",
  cyan: "#04F5FF",
  green: "#00FF85",
  chalk: "#F7F5FA",
  ink: "#1A1420",
  red: "#C0392B",
};

const STORAGE_KEY = "league-data-v1";
const EDITOR_KEY = "league-editor-unlock-v1";
const EDITOR_PIN = "6288";
const TOTAL_GAMEWEEKS = 38;

const DEFAULT_MEMBER_NAMES = Array.from({ length: 20 }, () => "");

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultData() {
  return {
    members: DEFAULT_MEMBER_NAMES.map((name) => ({ id: makeId("m"), name })),
    gameweeks: {},
  };
}

function emptyGW() {
  return { fixtures: [], predictions: {}, chips: {} };
}

function getGW(data, n) {
  return data.gameweeks[n] || emptyGW();
}

function resultSign(h, a) {
  if (h > a) return 1;
  if (h < a) return -1;
  return 0;
}

function fixturePoints(pred, actual) {
  if (!pred || pred.home === "" || pred.away === "" || pred.home == null || pred.away == null) return null;
  if (!actual || actual.home === "" || actual.away === "" || actual.home == null || actual.away == null) return null;
  const ph = Number(pred.home), pa = Number(pred.away);
  const ah = Number(actual.home), aa = Number(actual.away);
  if (ph === ah && pa === aa) return 3;
  if (resultSign(ph, pa) === resultSign(ah, aa)) return 1;
  return 0;
}

function gwMemberPoints(gw, memberId) {
  const fixtures = gw.fixtures || [];
  const memberPreds = (gw.predictions && gw.predictions[memberId]) || {};
  const chip = (gw.chips && gw.chips[memberId]) || { double: false, tripleFixtureId: null };
  let total = 0;
  let anyScored = false;
  let exactCount = 0;
  const perFixture = {};
  fixtures.forEach((fx) => {
    const pts = fixturePoints(memberPreds[fx.id], { home: fx.actualHome, away: fx.actualAway });
    perFixture[fx.id] = pts;
    if (pts !== null) {
      anyScored = true;
      if (pts === 3) exactCount += 1;
      let p = pts;
      if (chip.tripleFixtureId === fx.id) p = p * 3;
      total += p;
    }
  });
  if (chip.double) total = total * 2;
  return { total, anyScored, exactCount, perFixture };
}

const ENTRY_FEE_PER_SEASON = 76;

function calcPrizePot(memberCount) {
  const total = memberCount * ENTRY_FEE_PER_SEASON;
  // 1st place is fixed at £1,000, 3rd place is fixed at £160, and 2nd
  // place takes whatever remains of the pot.
  const first = 1000;
  const third = 160;
  const second = total - first - third;
  const leftover = total - (first + second + third);
  return { total, first, second, third, leftover };
}

function seasonHalf(gw) {
  return gw <= 18 ? "H1" : "H2";
}

function chipUsageSummary(data, memberId) {
  const usage = { H1: { double: 0, triple: 0 }, H2: { double: 0, triple: 0 } };
  Object.entries(data.gameweeks).forEach(([gwStr, gw]) => {
    const n = Number(gwStr);
    const half = seasonHalf(n);
    const chip = (gw.chips && gw.chips[memberId]) || {};
    if (chip.double) usage[half].double += 1;
    if (chip.tripleFixtureId) usage[half].triple += 1;
  });
  return usage;
}

// Counts double/triple uses in the given half, excluding whatever is set on
// excludeGwNum itself — used to work out whether turning a chip ON in the
// gameweek currently being edited would push the player over their 2-per-half
// allowance.
function chipUsageExcluding(data, memberId, half, excludeGwNum) {
  let double = 0;
  let triple = 0;
  Object.entries(data.gameweeks).forEach(([gwStr, gw]) => {
    const n = Number(gwStr);
    if (n === excludeGwNum) return;
    if (seasonHalf(n) !== half) return;
    const chip = (gw.chips && gw.chips[memberId]) || {};
    if (chip.double) double += 1;
    if (chip.tripleFixtureId) triple += 1;
  });
  return { double, triple };
}

function useDebouncedSave(data, ready, lastLocalEditRef) {
  const timer = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  useEffect(() => {
    if (!ready) return;
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await window.storage.set(STORAGE_KEY, JSON.stringify(data), true);
        if (lastLocalEditRef) lastLocalEditRef.current = Date.now();
        setStatus(res ? "saved" : "error");
      } catch (e) {
        setStatus("error");
      }
    }, 500);
    return () => clearTimeout(timer.current);
  }, [data, ready]);
  return status;
}

// Polls shared storage periodically so viewers see updates as soon as the
// admin saves them, without clobbering the admin's own in-progress edits.
function useLiveRefresh(ready, setData, lastLocalEditRef) {
  useEffect(() => {
    if (!ready) return;
    const interval = setInterval(async () => {
      const sinceEdit = Date.now() - (lastLocalEditRef.current || 0);
      if (sinceEdit < 4000) return;
      try {
        const res = await window.storage.get(STORAGE_KEY, true);
        if (res && res.value) {
          setData(JSON.parse(res.value));
        }
      } catch (e) {
        // ignore transient poll failures
      }
    }, 6000);
    return () => clearInterval(interval);
  }, [ready]);
}

export default function App() {
  const [data, setData] = useState(null);
  const [ready, setReady] = useState(false);
  const [isEditor, setIsEditor] = useState(false);
  const [tab, setTab] = useState("standings");
  const [gwNum, setGwNum] = useState(1);
  const [newFixture, setNewFixture] = useState({ home: "", away: "" });
  const [newMemberName, setNewMemberName] = useState("");
  const lastLocalEditRef = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const [leagueRes, editorRes] = await Promise.all([
          window.storage.get(STORAGE_KEY, true).catch(() => null),
          window.storage.get(EDITOR_KEY, false).catch(() => null),
        ]);
        if (leagueRes && leagueRes.value) {
          setData(JSON.parse(leagueRes.value));
        } else {
          setData(defaultData());
        }
        if (editorRes && editorRes.value === "true") {
          setIsEditor(true);
        }
      } catch (e) {
        setData(defaultData());
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const saveStatus = useDebouncedSave(data, ready && data !== null && isEditor, lastLocalEditRef);
  useLiveRefresh(ready && data !== null, setData, lastLocalEditRef);

  const unlockEditing = async () => {
    const entered = window.prompt("Enter the PIN to enable editing:");
    if (entered === null) return;
    if (entered.trim() === EDITOR_PIN) {
      setIsEditor(true);
      try {
        await window.storage.set(EDITOR_KEY, "true", false);
      } catch (e) {
        // still unlocked for this session even if remembering it fails
      }
    } else {
      window.alert("Incorrect PIN.");
    }
  };

  const lockEditing = async () => {
    setIsEditor(false);
    try {
      await window.storage.set(EDITOR_KEY, "false", false);
    } catch (e) {
      // ignore
    }
  };

  const updateGW = useCallback((n, updater) => {
    lastLocalEditRef.current = Date.now();
    setData((prev) => {
      const current = getGW(prev, n);
      const next = updater(current);
      return { ...prev, gameweeks: { ...prev.gameweeks, [n]: next } };
    });
  }, []);

  if (!ready || !data) {
    return (
      <div style={{ background: COLORS.purple }} className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-white">
          <Loader2 className="animate-spin" size={22} />
          <span style={{ fontFamily: "Oswald, sans-serif" }} className="text-lg tracking-wide">
            Loading the league table…
          </span>
        </div>
      </div>
    );
  }

  const gw = getGW(data, gwNum);
  const half = seasonHalf(gwNum);

  const addFixture = () => {
    if (!isEditor) return;
    if (!newFixture.home.trim() || !newFixture.away.trim()) return;
    updateGW(gwNum, (g) => ({
      ...g,
      fixtures: [...g.fixtures, { id: makeId("fx"), home: newFixture.home.trim(), away: newFixture.away.trim(), actualHome: "", actualAway: "" }],
    }));
    setNewFixture({ home: "", away: "" });
  };

  const removeFixture = (fxId) => {
    if (!isEditor) return;
    updateGW(gwNum, (g) => ({
      ...g,
      fixtures: g.fixtures.filter((f) => f.id !== fxId),
      predictions: Object.fromEntries(
        Object.entries(g.predictions).map(([mid, preds]) => {
          const { [fxId]: _, ...rest } = preds;
          return [mid, rest];
        })
      ),
      chips: Object.fromEntries(
        Object.entries(g.chips).map(([mid, c]) => [mid, c.tripleFixtureId === fxId ? { ...c, tripleFixtureId: null } : c])
      ),
    }));
  };

  const setActual = (fxId, field, value) => {
    if (!isEditor) return;
    updateGW(gwNum, (g) => ({
      ...g,
      fixtures: g.fixtures.map((f) => (f.id === fxId ? { ...f, [field]: value } : f)),
    }));
  };

  const setPrediction = (memberId, fxId, field, value) => {
    if (!isEditor) return;
    updateGW(gwNum, (g) => ({
      ...g,
      predictions: {
        ...g.predictions,
        [memberId]: {
          ...(g.predictions[memberId] || {}),
          [fxId]: { ...((g.predictions[memberId] || {})[fxId] || { home: "", away: "" }), [field]: value },
        },
      },
    }));
  };

  const toggleDouble = (memberId) => {
    if (!isEditor) return;
    const current = gw.chips[memberId] || { double: false, tripleFixtureId: null };
    if (!current.double) {
      const usage = chipUsageExcluding(data, memberId, half, gwNum);
      if (usage.double >= 2) {
        const memberName = data.members.find((m) => m.id === memberId)?.name || "This player";
        window.alert(`${memberName} has already used Double Gameweek twice in ${half === "H1" ? "Gameweeks 1–18" : "Gameweeks 19–38"}. It can't be used again until the next half of the season.`);
        return;
      }
    }
    updateGW(gwNum, (g) => {
      const c = g.chips[memberId] || { double: false, tripleFixtureId: null };
      return { ...g, chips: { ...g.chips, [memberId]: { ...c, double: !c.double } } };
    });
  };

  const setTripleFixture = (memberId, fxId) => {
    if (!isEditor) return;
    const current = gw.chips[memberId] || { double: false, tripleFixtureId: null };
    const turningOn = !current.tripleFixtureId && fxId;
    if (turningOn) {
      const usage = chipUsageExcluding(data, memberId, half, gwNum);
      if (usage.triple >= 2) {
        const memberName = data.members.find((m) => m.id === memberId)?.name || "This player";
        window.alert(`${memberName} has already used Triple Fixture twice in ${half === "H1" ? "Gameweeks 1–18" : "Gameweeks 19–38"}. It can't be used again until the next half of the season.`);
        return;
      }
    }
    updateGW(gwNum, (g) => {
      const c = g.chips[memberId] || { double: false, tripleFixtureId: null };
      return { ...g, chips: { ...g.chips, [memberId]: { ...c, tripleFixtureId: fxId || null } } };
    });
  };

  const addMember = () => {
    if (!isEditor) return;
    if (!newMemberName.trim()) return;
    setData((prev) => ({ ...prev, members: [...prev.members, { id: makeId("m"), name: newMemberName.trim() }] }));
    setNewMemberName("");
  };

  const renameMember = (id, name) => {
    if (!isEditor) return;
    setData((prev) => ({ ...prev, members: prev.members.map((m) => (m.id === id ? { ...m, name } : m)) }));
  };

  const removeMember = (id) => {
    if (!isEditor) return;
    setData((prev) => ({ ...prev, members: prev.members.filter((m) => m.id !== id) }));
  };

  const standings = data.members
    .map((m) => {
      let total = 0;
      let gwsPlayed = 0;
      let exactScores = 0;
      Object.entries(data.gameweeks).forEach(([, g]) => {
        const { total: t, anyScored, exactCount } = gwMemberPoints(g, m.id);
        if (anyScored) {
          total += t;
          gwsPlayed += 1;
          exactScores += exactCount;
        }
      });
      return { ...m, total, gwsPlayed, exactScores };
    })
    .sort((a, b) => b.total - a.total || b.exactScores - a.exactScores);

  return (
    <div style={{ background: COLORS.chalk, fontFamily: "Inter, sans-serif", color: COLORS.ink }} className="min-h-screen">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .scorebox { width: 2.1rem; text-align: center; border-radius: 6px; border: 1.5px solid #D3C4DA; padding: 3px 0; font-family: 'Oswald', sans-serif; font-weight: 600; }
        .scorebox:focus { outline: none; border-color: ${COLORS.purpleMid}; }
        table.pred-table th, table.pred-table td { border-bottom: 1px solid #E4DCE8; }
      `}</style>

      {/* Header */}
      <div style={{ background: COLORS.purple }} className="text-white">
        <div className="max-w-6xl mx-auto px-4 pt-6 pb-4">
          <div className="flex items-center gap-2">
            <Trophy size={22} style={{ color: COLORS.pink }} />
            <span style={{ fontFamily: "Oswald, sans-serif" }} className="uppercase tracking-widest text-xs" >
              Office Predictions League
            </span>
          </div>
          <h1 style={{ fontFamily: "Oswald, sans-serif" }} className="text-3xl sm:text-4xl font-semibold mt-1">
            Premier League Predictor
          </h1>
          <p className="text-sm mt-1" style={{ color: "#D9B8DE" }}>
            £2 / week · £76 season · 3pts exact score · 1pt correct result
          </p>
          <div className="mt-2">
            {isEditor ? (
              <button
                onClick={lockEditing}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ background: COLORS.green, color: COLORS.purple }}
              >
                <Check size={12} /> Editing enabled · tap to lock
              </button>
            ) : (
              <button
                onClick={unlockEditing}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ background: "rgba(255,255,255,0.12)", color: "#D9B8DE", border: "1px solid rgba(255,255,255,0.25)" }}
              >
                View only · tap to unlock editing
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {[
            { id: "standings", label: "Standings", icon: Award },
            { id: "gameweek", label: "Gameweek", icon: ListChecks },
            ...(isEditor ? [{ id: "members", label: "Members", icon: Users }] : []),
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  fontFamily: "Oswald, sans-serif",
                  background: active ? COLORS.chalk : "transparent",
                  color: active ? COLORS.purple : "#D9B8DE",
                  borderBottom: active ? `3px solid ${COLORS.pink}` : "3px solid transparent",
                }}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold uppercase tracking-wide rounded-t-lg whitespace-nowrap"
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
          <div className="ml-auto flex items-center pr-2 text-xs" style={{ color: "#C79ECC" }}>
            {saveStatus === "saving" && "Saving…"}
            {saveStatus === "saved" && "Saved"}
            {saveStatus === "error" && "Save failed"}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {tab === "standings" && <Standings standings={standings} data={data} />}
        {tab === "gameweek" && (
          <GameweekTab
            data={data}
            gw={gw}
            gwNum={gwNum}
            half={half}
            isEditor={isEditor}
            setGwNum={setGwNum}
            newFixture={newFixture}
            setNewFixture={setNewFixture}
            addFixture={addFixture}
            removeFixture={removeFixture}
            setActual={setActual}
            setPrediction={setPrediction}
            toggleDouble={toggleDouble}
            setTripleFixture={setTripleFixture}
          />
        )}
        {tab === "members" && isEditor && (
          <MembersTab
            members={data.members}
            newMemberName={newMemberName}
            setNewMemberName={setNewMemberName}
            addMember={addMember}
            renameMember={renameMember}
            removeMember={removeMember}
          />
        )}
      </div>
    </div>
  );
}

function Standings({ standings, data }) {
  const gwCount = Object.keys(data.gameweeks).length;
  const pot = calcPrizePot(data.members.length);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 style={{ fontFamily: "Oswald, sans-serif" }} className="text-xl font-semibold">
          League Table
        </h2>
        <span className="text-xs text-gray-500">{gwCount} gameweek{gwCount === 1 ? "" : "s"} recorded</span>
      </div>

      <div className="mb-4 rounded-xl overflow-hidden border" style={{ borderColor: "#E4DCE8" }}>
        <div style={{ background: COLORS.purple }} className="px-4 py-2.5 text-white flex items-center justify-between">
          <span style={{ fontFamily: "Oswald, sans-serif" }} className="text-sm font-semibold uppercase tracking-wide">
            Prize Pot
          </span>
          <span className="text-xs" style={{ color: "#D9B8DE" }}>
            {data.members.length} players · £{ENTRY_FEE_PER_SEASON} each
          </span>
        </div>
        <div className="grid grid-cols-3 divide-x bg-white" style={{ borderColor: "#E4DCE8" }}>
          {[
            { place: "1st", amount: pot.first, color: COLORS.pink },
            { place: "2nd", amount: pot.second, color: COLORS.purpleMid },
            { place: "3rd", amount: pot.third, color: COLORS.cyan },
          ].map((row) => (
            <div key={row.place} className="text-center py-3">
              <div className="text-xs uppercase text-gray-500 mb-0.5">{row.place}</div>
              <div style={{ fontFamily: "Oswald, sans-serif", color: row.color }} className="text-lg font-semibold">
                £{row.amount}
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 text-xs text-gray-500 border-t" style={{ borderColor: "#E4DCE8" }}>
          Total pot: <span className="font-semibold">£{pot.total}</span> — 1st place is fixed at £{pot.first}, 3rd place is fixed at £{pot.third}, and 2nd place takes whatever remains
          {pot.leftover > 0 && <> — £{pot.leftover} left over</>}
        </div>
      </div>

      <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: "#FCE0EC", color: "#7A0030" }}>
        <strong>Tiebreaker:</strong> if two or more players finish the season level on points, the title goes to whoever has the most correct exact scores across the season.
      </p>
      {standings.length === 0 ? (
        <EmptyState text="No members yet — add players in the Members tab." />
      ) : (
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: "#E4DCE8" }}>
          <table className="w-full text-sm">
            <thead style={{ background: COLORS.purpleMid }} className="text-white">
              <tr style={{ fontFamily: "Oswald, sans-serif" }}>
                <th className="text-left py-2.5 px-3 font-medium w-12">#</th>
                <th className="text-left py-2.5 px-3 font-medium">Player</th>
                <th className="text-right py-2.5 px-3 font-medium">GWs</th>
                <th className="text-right py-2.5 px-3 font-medium">Exact</th>
                <th className="text-right py-2.5 px-4 font-medium">Points</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((m, i) => (
                <tr key={m.id} style={{ background: i % 2 === 0 ? "#fff" : "#F7F1F9" }}>
                  <td className="py-2.5 px-3">
                    {i === 0 ? (
                      <span style={{ color: COLORS.pink }} className="font-semibold">1</span>
                    ) : (
                      <span className="text-gray-500">{i + 1}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-medium">{m.name}</td>
                  <td className="py-2.5 px-3 text-right text-gray-500">{m.gwsPlayed}</td>
                  <td className="py-2.5 px-3 text-right text-gray-500">{m.exactScores}</td>
                  <td className="py-2.5 px-4 text-right font-semibold" style={{ fontFamily: "Oswald, sans-serif" }}>
                    {m.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GameweekTab({ data, gw, gwNum, half, isEditor, setGwNum, newFixture, setNewFixture, addFixture, removeFixture, setActual, setPrediction, toggleDouble, setTripleFixture }) {
  return (
    <div>
      {/* GW selector */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setGwNum((n) => Math.max(1, n - 1))}
            className="p-2 rounded-full border hover:bg-gray-100"
            style={{ borderColor: "#D3C4DA" }}
          >
            <ChevronLeft size={16} />
          </button>
          <div className="text-center">
            <div style={{ fontFamily: "Oswald, sans-serif", color: COLORS.purple }} className="text-2xl font-semibold leading-none">
              Gameweek {gwNum}
            </div>
            <div className="text-xs text-gray-500 mt-1">Chip half: {half === "H1" ? "1–18" : "19–38"}</div>
          </div>
          <button
            onClick={() => setGwNum((n) => Math.min(TOTAL_GAMEWEEKS, n + 1))}
            className="p-2 rounded-full border hover:bg-gray-100"
            style={{ borderColor: "#D3C4DA" }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <select
          value={gwNum}
          onChange={(e) => setGwNum(Number(e.target.value))}
          className="border rounded-lg px-2 py-1.5 text-sm"
          style={{ borderColor: "#D3C4DA" }}
        >
          {Array.from({ length: TOTAL_GAMEWEEKS }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              GW {n}
            </option>
          ))}
        </select>
      </div>

      {/* Fixtures */}
      <div className="mb-6">
        <h3 style={{ fontFamily: "Oswald, sans-serif" }} className="text-sm font-semibold uppercase tracking-wide mb-2 text-gray-600">
          Fixtures &amp; actual scores
        </h3>
        <div className="space-y-2 mb-3">
          {gw.fixtures.length === 0 && <EmptyState text="No fixtures added for this gameweek yet." />}
          {gw.fixtures.map((fx) => (
            <div key={fx.id} className="flex items-center gap-2 bg-white border rounded-lg px-3 py-2" style={{ borderColor: "#E4DCE8" }}>
              <div className="flex-1 text-sm font-medium truncate">
                {fx.home} <span className="text-gray-400 font-normal">v</span> {fx.away}
              </div>
              <input
                type="number"
                min="0"
                className="scorebox"
                value={fx.actualHome}
                onChange={(e) => setActual(fx.id, "actualHome", e.target.value)}
                placeholder="-"
                readOnly={!isEditor}
              />
              <span className="text-gray-400">–</span>
              <input
                type="number"
                min="0"
                className="scorebox"
                value={fx.actualAway}
                onChange={(e) => setActual(fx.id, "actualAway", e.target.value)}
                placeholder="-"
                readOnly={!isEditor}
              />
              {isEditor && (
                <button onClick={() => removeFixture(fx.id)} className="p-1.5 text-gray-400 hover:text-red-600">
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
        {isEditor && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Home team"
            value={newFixture.home}
            onChange={(e) => setNewFixture((f) => ({ ...f, home: e.target.value }))}
            className="border rounded-lg px-2.5 py-1.5 text-sm flex-1 min-w-[9rem]"
            style={{ borderColor: "#D3C4DA" }}
          />
          <span className="text-gray-400 text-sm">v</span>
          <input
            type="text"
            placeholder="Away team"
            value={newFixture.away}
            onChange={(e) => setNewFixture((f) => ({ ...f, away: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && addFixture()}
            className="border rounded-lg px-2.5 py-1.5 text-sm flex-1 min-w-[9rem]"
            style={{ borderColor: "#D3C4DA" }}
          />
          <button
            onClick={addFixture}
            style={{ background: COLORS.purpleMid }}
            className="text-white rounded-lg px-3 py-1.5 text-sm font-medium flex items-center gap-1"
          >
            <Plus size={14} /> Add
          </button>
        </div>
        )}
      </div>

      {/* Predictions — fixtures down the left, players across the top, scroll sideways */}
      {gw.fixtures.length > 0 && data.members.length > 0 && (
        <div className="mb-6">
          <h3 style={{ fontFamily: "Oswald, sans-serif" }} className="text-sm font-semibold uppercase tracking-wide mb-1 text-gray-600">
            Predictions
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            {isEditor
              ? "Scroll sideways for each player. The ⚡ under a player's name sets Double Gameweek for their whole week; the ★ in a cell sets Triple Fixture for that match."
              : "View only — scroll sideways to see everyone's predictions, chips and live points."}
          </p>
          <div className="overflow-x-auto border rounded-xl" style={{ borderColor: "#E4DCE8" }}>
            <table className="pred-table text-sm" style={{ borderCollapse: "collapse", minWidth: "100%" }}>
              <thead>
                <tr style={{ background: COLORS.purpleMid }} className="text-white">
                  <th className="text-left py-2 px-3 sticky left-0 z-10" style={{ background: COLORS.purpleMid, fontFamily: "Oswald, sans-serif", minWidth: "10rem" }}>
                    Fixture
                  </th>
                  {data.members.map((m) => {
                    const chip = gw.chips[m.id] || { double: false, tripleFixtureId: null };
                    const usage = chipUsageExcluding(data, m.id, half, gwNum);
                    const doubleBlocked = !chip.double && usage.double >= 2;
                    return (
                      <th key={m.id} className="text-center py-2 px-2 font-medium" style={{ fontFamily: "Oswald, sans-serif", minWidth: "6.5rem" }}>
                        <div className="text-[11px] leading-tight whitespace-nowrap mb-1">{m.name}</div>
                        <button
                          onClick={() => toggleDouble(m.id)}
                          disabled={doubleBlocked || !isEditor}
                          title={!isEditor ? "View only" : doubleBlocked ? "Double Gameweek already used twice this half" : "Toggle Double Gameweek for this player's whole gameweek"}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                          style={{
                            background: chip.double ? COLORS.cyan : "transparent",
                            border: `1px solid ${chip.double ? COLORS.cyan : "rgba(255,255,255,0.4)"}`,
                            color: chip.double ? COLORS.purple : doubleBlocked ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.8)",
                            opacity: doubleBlocked ? 0.5 : 1,
                            cursor: doubleBlocked || !isEditor ? "not-allowed" : "pointer",
                          }}
                        >
                          <Zap size={10} />
                          {chip.double ? "2x" : "—"}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {gw.fixtures.map((fx, fi) => (
                  <tr key={fx.id} style={{ background: fi % 2 === 0 ? "#fff" : "#F7F1F9" }}>
                    <td className="py-1.5 px-3 sticky left-0" style={{ background: fi % 2 === 0 ? "#fff" : "#F7F1F9" }}>
                      <div className="text-xs font-medium whitespace-nowrap">
                        {fx.home} <span className="text-gray-400 font-normal">v</span> {fx.away}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[9px] uppercase text-gray-400">Actual</span>
                        <input
                          type="number"
                          min="0"
                          className="scorebox"
                          style={{ width: "1.7rem", padding: "2px 0" }}
                          value={fx.actualHome}
                          onChange={(e) => setActual(fx.id, "actualHome", e.target.value)}
                          placeholder="-"
                          readOnly={!isEditor}
                        />
                        <span className="text-gray-400 text-xs">-</span>
                        <input
                          type="number"
                          min="0"
                          className="scorebox"
                          style={{ width: "1.7rem", padding: "2px 0" }}
                          value={fx.actualAway}
                          onChange={(e) => setActual(fx.id, "actualAway", e.target.value)}
                          placeholder="-"
                          readOnly={!isEditor}
                        />
                      </div>
                    </td>
                    {data.members.map((m) => {
                      const chip = gw.chips[m.id] || { double: false, tripleFixtureId: null };
                      const pred = (gw.predictions[m.id] || {})[fx.id] || { home: "", away: "" };
                      const pts = fixturePoints(pred, { home: fx.actualHome, away: fx.actualAway });
                      const tripled = chip.tripleFixtureId === fx.id;
                      const usage = chipUsageExcluding(data, m.id, half, gwNum);
                      const tripleBlocked = !chip.tripleFixtureId && usage.triple >= 2;
                      let cellBg = "transparent";
                      if (pts === 3) cellBg = "#D9FFEF";
                      else if (pts === 1) cellBg = "#DFF9FF";
                      return (
                        <td key={m.id} className="py-1.5 px-2" style={{ background: cellBg }}>
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              min="0"
                              className="scorebox"
                              style={{ width: "1.7rem", padding: "2px 0" }}
                              value={pred.home}
                              onChange={(e) => setPrediction(m.id, fx.id, "home", e.target.value)}
                              readOnly={!isEditor}
                            />
                            <span className="text-gray-400 text-xs">-</span>
                            <input
                              type="number"
                              min="0"
                              className="scorebox"
                              style={{ width: "1.7rem", padding: "2px 0" }}
                              value={pred.away}
                              onChange={(e) => setPrediction(m.id, fx.id, "away", e.target.value)}
                              readOnly={!isEditor}
                            />
                            <button
                              onClick={() => setTripleFixture(m.id, tripled ? "" : fx.id)}
                              disabled={(!tripled && tripleBlocked) || !isEditor}
                              title={!isEditor ? "View only" : tripleBlocked && !tripled ? "Triple Fixture already used twice this half" : "Toggle Triple Fixture chip on this match"}
                              className="p-0.5 rounded"
                              style={{ opacity: !tripled && tripleBlocked ? 0.4 : 1, cursor: (!tripled && tripleBlocked) || !isEditor ? "not-allowed" : "pointer" }}
                            >
                              <Star size={13} style={{ color: tripled ? COLORS.pink : "#c9c4b4" }} fill={tripled ? COLORS.pink : "none"} />
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Gameweek totals summary */}
      {gw.fixtures.length > 0 && data.members.length > 0 && (
        <div className="mb-6">
          <h3 style={{ fontFamily: "Oswald, sans-serif" }} className="text-sm font-semibold uppercase tracking-wide mb-2 text-gray-600">
            Gameweek {gwNum} totals
          </h3>
          <div className="space-y-1.5">
            {data.members.map((m) => {
              const { total } = gwMemberPoints(gw, m.id);
              return (
                <div key={m.id} className="flex items-center justify-between bg-white border rounded-lg px-3 py-2" style={{ borderColor: "#E4DCE8" }}>
                  <span className="text-sm font-medium">{m.name}</span>
                  <span className="text-sm font-semibold" style={{ fontFamily: "Oswald, sans-serif" }}>
                    {total}
                  </span>
                </div>
              );
            })}
          </div>
          <ChipUsagePanel data={data} half={half} />
        </div>
      )}
    </div>
  );
}

function ChipUsagePanel({ data, half }) {
  return (
    <div className="mt-4">
      <h3 style={{ fontFamily: "Oswald, sans-serif" }} className="text-sm font-semibold uppercase tracking-wide mb-2 text-gray-600">
        Chip usage — {half === "H1" ? "Gameweeks 1–18" : "Gameweeks 19–38"}
      </h3>
      <div className="flex flex-wrap gap-2">
        {data.members.map((m) => {
          const usage = chipUsageSummary(data, m.id)[half];
          const doubleOk = usage.double <= 2;
          const tripleOk = usage.triple <= 2;
          return (
            <div
              key={m.id}
              className="text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-2"
              style={{ borderColor: "#E4DCE8", background: "#fff" }}
            >
              <span className="font-medium">{m.name}</span>
              <span style={{ color: doubleOk ? "#557" : COLORS.red }} className="flex items-center gap-0.5">
                <Zap size={11} /> {usage.double}/2
              </span>
              <span style={{ color: tripleOk ? "#557" : COLORS.red }} className="flex items-center gap-0.5">
                <Star size={11} /> {usage.triple}/2
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MembersTab({ members, newMemberName, setNewMemberName, addMember, renameMember, removeMember }) {
  return (
    <div>
      <h2 style={{ fontFamily: "Oswald, sans-serif" }} className="text-xl font-semibold mb-3">
        Members
      </h2>
      <div className="space-y-2 mb-4">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-2 bg-white border rounded-lg px-3 py-2" style={{ borderColor: "#E4DCE8" }}>
            <input
              value={m.name}
              onChange={(e) => renameMember(m.id, e.target.value)}
              className="flex-1 text-sm outline-none"
            />
            <button onClick={() => removeMember(m.id)} className="p-1.5 text-gray-400 hover:text-red-600">
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Add a player…"
          value={newMemberName}
          onChange={(e) => setNewMemberName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addMember()}
          className="border rounded-lg px-2.5 py-1.5 text-sm flex-1"
          style={{ borderColor: "#D3C4DA" }}
        />
        <button
          onClick={addMember}
          style={{ background: COLORS.purpleMid }}
          className="text-white rounded-lg px-3 py-1.5 text-sm font-medium flex items-center gap-1"
        >
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="text-sm text-gray-500 border border-dashed rounded-lg px-4 py-6 text-center" style={{ borderColor: "#D3C4DA" }}>
      {text}
    </div>
  );
}
