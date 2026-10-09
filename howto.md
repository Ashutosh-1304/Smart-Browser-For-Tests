# HOW-TO — Smart Browser + Veyon Proctoring Integration

Yeh guide batati hai ki pura system **test** aur **use** kaise karna hai.

Har kaam ke aage tag hai:
- **[DEV — ek baar]** → ye setup/development ka hissa hai, ek baar karna hai. Dobara nahi.
- **[USER — har baar]** → exam ke din, jab actually use karna ho, tab karna hai.

Teen cheezein hain system mein:
1. **App** — Electron proctoring browser (student ke saamne).
2. **Server + Hub** — Express server + WebSocket hub (`port 3001`, path `/proctor`). App ke saath hi chalta hai.
3. **Veyon Plugin** — C++ plugin jo flags Veyon Master (teacher) tak le jaata hai.

---

## PHASE 0 — Dependencies install (sirf development machine pe)

**[DEV — ek baar]**

```sh
# project folder mein
npm install
```
Isse `ws` samet saari JS dependencies aa jaati hain.

> Note: Veyon plugin JS toolchain ka hissa nahi hai — woh alag se banta hai (Phase 3).

---

## PART A — Sirf App + Hub test karna (bina Veyon ke)

Yeh sabse pehle karo. Isse confirm hota hai ki proctoring, score, aur WebSocket
hub sahi chal rahe hain — Veyon ki zaroorat nahi.

### A1. App chalu karo
**[USER — har baar]** (aur dev ke time bhi)
```sh
npm run dev
```
Yeh ek saath teen cheezein start karta hai:
- `dev:server` → Express + hub (`http://localhost:3001`, ws `/proctor`)
- `dev:vite`   → React frontend
- `dev:electron` → Electron window

### A2. Exam shuru karo
**[USER — har baar]**
1. App khulegi → **Name / Roll No.** daalo (ye `studentId` banta hai — Veyon
   mein isi se student pehchana jaata hai).
2. **Test code** daalo → **Start Test**. (Ya "Skip — enter URL manually".)
3. Topbar pe status pill dekho:
   - `○ Offline` → hub se connect nahi (server band hai).
   - `● Hub` → hub se juda, par koi Veyon agent nahi.
   - `● Monitored` → Veyon plugin bhi juda hai.

Abhi (bina Veyon ke) `● Hub` dikhega — yahi sahi hai.

### A3. Verify karo ki violations ja rahe hain
**[DEV — jab test kar rahe ho]**

Hub se messages dekhne ke liye ek chhota agent simulate kar sakte ho. Node se:
```sh
node -e "const W=require('ws');const s=new W('ws://localhost:3001/proctor');s.on('open',()=>s.send(JSON.stringify({type:'hello',role:'agent',name:'test'})));s.on('message',m=>console.log(m.toString()))"
```
Ab app mein violation trigger karo (camera se face hatao, phone dikhao, tab
switch karo). Terminal mein `violation` aur `score` messages aane chahiye.
Yeh prove karta hai App → Hub → agent chain kaam kar rahi hai.

### A4. Command wapas bhej ke dekho (agent → app)
**[DEV — jab test kar rahe ho]**

Upar wale script mein `s` socket pe:
```js
s.send(JSON.stringify({type:'command',action:'lock',message:'Test lock'}))
```
App pe **lock overlay** aana chahiye. `action:'unlock'` se hat jaayega.
Isse Veyon → App wala rasta verify hota hai, bina Veyon ke.

> Agar yahan tak sab chal gaya, toh JS side poora ready hai.

---

## PART B — Veyon Plugin banana (C++)

Yeh tabhi karo jab Part A chal gaya ho. Isme Veyon aur Qt chahiye.

### B1. Zaroori cheezein install karo
**[DEV — ek baar]**
- Us **exact Veyon version** ka source jo deploy karoge (ABI match zaroori).
- Qt (Veyon 4.8+ = Qt6), **WebSockets module** samet (`qt6-websockets`).
- CMake ≥ 3.16, C++17 compiler (Windows pe MSVC).

Poore steps `veyon-plugin/README.md` mein hain.

### B2. Plugin build karo (in-tree — recommended)
**[DEV — ek baar]**
```sh
git clone --branch v4.8.3 https://github.com/veyon/veyon.git
cp -r veyon-plugin veyon/plugins/proctorfeature
# veyon/plugins/CMakeLists.txt mein add karo:  add_subdirectory(proctorfeature)
cd veyon
cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```
Output: `proctorfeature.dll` (Windows) / `.so` (Linux).

### B3. ⚠️ TODO(verify) spots theek karo
**[DEV — ek baar]**

Code mein 6 jagah `TODO(verify)` mark hain — ye Veyon version pe depend karti
hain aur **compile se pehle apne Veyon headers se confirm karni hain**. List
`veyon-plugin/README.md` ke "TODO(verify)" section mein hai. Sabse important:
`FeatureMessage` ka argument API, aur Service→Master message bhejne wala call.

### B4. Plugin install karo — DONO tarah ke PC pe
**[DEV — ek baar, har PC pe setup ke waqt]**
- **Windows:** `C:\Program Files\Veyon\plugins\`
- **Linux:** `/usr/lib/veyon/`

Student PCs aur teacher PC — sab pe wahi `.dll`/`.so` daalna hai.

---

## PART C — Lab setup (ek baar, deployment ke waqt)

**[DEV — ek baar, har machine pe]**

Tumhara setup: ek lab, saare students + teacher ek hi **LAN** pe, teacher ek hi
machine pe baithta hai (supervisor). Toh VPN/tunnel ki zaroorat **nahi**.

### Student PCs (har ek pe):
1. Smart Browser app install.
2. Veyon **Service** install (background mein SYSTEM ke saath chalta hai).
3. `proctorfeature` plugin `plugins/` folder mein.

### Teacher PC:
1. Veyon **Master** install.
2. Wahi `proctorfeature` plugin `plugins/` folder mein.
3. Veyon mein saare student PCs ki list/room configure karo (Veyon ka apna
   setup — authentication keys exchange etc., Veyon docs ke hisaab se).

### Veyon authentication:
**[DEV — ek baar]** Veyon key-file (ya LDAP/logon) auth use karta hai. Teacher
ki public key student PCs pe install karni hoti hai. Ye Veyon ka standard
setup hai — plugin se alag.

---

## PART D — Exam ke din (har baar jo karna hai)

**[USER — har baar]**

### Student (har PC pe):
1. PC on karo — Veyon Service apne aap background mein chalu (kuch nahi karna).
2. Smart Browser app + server chalu karo:
   - Dev mode: `npm run dev`
   - Ya packaged app ka icon.
3. Name/Roll + test code daal ke exam shuru karo.
4. Status pill `● Monitored` dikhe → sab juda hai.

### Teacher (ek machine pe):
1. Veyon Master kholo.
2. Saare students ka grid dikhega. Jaise hi kisi ka violation hoga, uske
   thumbnail pe flag + fairness score dikhega (plugin se).
3. Kisi student pe action lena ho → uske thumbnail pe **Lock Student Exam**
   (ya warn/unlock) → student ki app pe turant asar.

Exam khatam → app score submit karti hai, session `ended` ho jaati hai.

---

## Quick reference — kya ek baar, kya har baar

| Kaam | Tag | Kab |
|------|-----|-----|
| `npm install` | DEV — ek baar | Setup |
| Plugin build + TODO(verify) fix | DEV — ek baar | Setup |
| Plugin dono PC pe install | DEV — ek baar | Har machine setup |
| Veyon Service/Master install + auth keys | DEV — ek baar | Har machine setup |
| Veyon mein student list configure | DEV — ek baar | Setup |
| `npm run dev` / app chalu | USER — har baar | Har exam |
| Name + test code daalna | USER — har baar | Har exam |
| Teacher Veyon Master kholna | USER — har baar | Har exam |
| Lock/warn action lena | USER — har baar | Zaroorat pe |

---

## Abhi (aaj) kya test kar sakte ho

Veyon ke bina bhi **90% verify** ho jaata hai:
1. `npm run dev` chalao.
2. Part A ke A1–A4 steps karo (fake agent script se).
3. Violations, score, aur lock command — teeno dekho.

Yeh poora JS side prove kar deta hai. Veyon plugin (Part B) sirf tab chahiye
jab flags **Veyon Master ke andar** dikhane hain — woh ek alag machine pe
Veyon + Qt ke saath build karna padega.
