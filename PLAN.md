# PLAN — Smart Browser as a Desktop App + Veyon Integration

Yeh file architecture decision aur aage ka plan capture karti hai. Context:
lab mein **Veyon pehle se deployed** hai (screen monitoring ke liye). Humein
apne proctoring flags (face/gaze/object + fairness score) **Veyon Master**
(teacher) tak pahunchane hain, aur student app ko **"bas install karo"** jaisa
simple banana hai.

---

## Faisla — direction SAHI hai

Veyon lab mein already chal raha hai → uska saara heavy setup (Service install,
teacher auth keys, student list) **pehle se ho chuka hai**. Woh bojh nahi,
**advantage** hai. Hum ek proven system mein apni intelligence inject kar rahe
hain — reinvent nahi kar rahe.

Isliye "install karo bas" sirf **do choton** pe aata hai:
1. **Student PCs:** Smart Browser `.exe` install (naya kaam).
2. **Sab PCs:** `proctorfeature.dll` → Veyon ke `plugins/` folder mein copy.

---

## Current reality (code se verified)

| Cheez | Status |
|-------|--------|
| `electron/main.cjs` server ko spawn karta hai? | ❌ Nahi (`spawn/fork/exec` grep se absent) |
| Dev mode mein server kaise chalta hai? | `concurrently` se alag process (`npm run dev:server`) |
| Packaged mode mein server? | ❌ Chalta hi nahi — isliye abhi `.exe` banayein toh test code validate nahi hoga, hub nahi chalega |
| `package.json` mein electron-builder `build` config? | ❌ Nahi (devDependency hai, config nahi) |
| JS proctoring + hub (Step 1) | ✅ Test kiya, 6/6 hub tests pass, build clean |
| Veyon C++ plugin (Step 2) | ⚠️ Scaffold ready, **compile nahi hua** (Veyon+Qt chahiye) |

**Matlab:** abhi "bas install" wala app exist nahi karta. Yahi gap bharna hai.

---

## KAAM 1 — Student app ko "install karo bas" banana

Target: ek Windows installer (`.exe`) jisme sab bundled ho.

```
Student installer (.exe)
┌─────────────────────────────────────────┐
│  Electron app                            │
│   ├─ main.cjs server ko KHUD spawn kare │  ← add karna hai
│   │   (Express + /proctor hub, :3001)   │
│   ├─ dist/ (React build)                │
│   └─ server/ + node_modules bundled     │
└─────────────────────────────────────────┘
```

Teen sub-tasks:
1. **main.cjs mein server embed/spawn** — packaged mode mein `server/index.js`
   ko child process (ya same process) se start kare. Abhi missing.
2. **electron-builder config** — `package.json` mein `build` key: Windows NSIS
   installer, aur `server/` + `node_modules` ko `extraResources`/`asarUnpack`
   mein (SQLite native module unpack karna zaroori).
3. **better-sqlite3 native rebuild** — native binary hai, Electron ke ABI ke
   against rebuild karna padega warna packaged app crash karegi.

> Yeh kaam **self-contained** hai — isi machine pe abhi ban aur test ho sakta hai.

---

## KAAM 2 — Plugin ko real Veyon se compile karna

Scaffold `veyon-plugin/` mein ready hai. Karna:
1. Lab wale **exact Veyon version** ke source ke against build (in-tree,
   `veyon-plugin/README.md` ke steps).
2. **6 TODO(verify)** spots us version ke headers se confirm karke fix.
3. `.dll`/`.so` ko dono tarah ke PC ke `plugins/` folder mein daalna.

### ⚠️ Pehla practical step — Veyon version pata karo
Veyon plugins **version-specific** hote hain. Match na karne pe plugin **load
nahi hoga**. Kisi lab PC pe:
```
veyon-cli about
```
ya Veyon Master → "About" se version note karo. Woh number milते hi README/CMake
usi ke against exact kar denge.

---

## Aage ka order

**KAAM 1 pehle** (abhi testable, is machine pe):
`main.cjs` server-spawn → electron-builder config → sqlite rebuild → installer test.

**Saath-saath:** lab PC se Veyon version pata karo → phir **KAAM 2** pakka karo.

---

## Jo aaj (Veyon ke bina) test ho sakta hai
`howto.md` ke **Part A** se JS side ka 90% verify ho jaata hai:
- `npm run dev`
- fake agent script se violation/score aur lock-command dono dekho

Veyon plugin sirf tab chahiye jab flags **Veyon Master ke andar** dikhane hain.
