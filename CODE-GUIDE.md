# Code ko simple tarike se samjho

Is project mein plain JavaScript use hui hai. Har folder ki ek clear responsibility hai. React screen dikhata hai, Express request handle karta hai, aur MongoDB data save karta hai.

## Ek request ka flow

```text
React page → client/src/api.js → Express route → service/model → MongoDB
```

Example: jab aap project create karte ho, React form name aur origin leta hai. `api.js` JSON request bhejta hai. Server input validate karta hai, current user ko owner banata hai, aur Project model se database mein record save karta hai. Response aane par React list update karta hai.

## Frontend se shuru karo

1. `client/src/main.jsx`: React app ka entry point.
2. `client/src/App.jsx`: login aur dashboard routes. `components/WorkspaceLayout.jsx` mein sidebar aur layout; `pages/AuthPage.jsx` mein login/register form hai.
3. `client/src/context.jsx`: logged-in user, selected project aur analytics loading state.
4. `client/src/pages/`: har screen ka alag component.
5. `client/src/components/`: buttons/dialogs/tables/charts jaisi reusable UI.
6. `client/src/api.js`: fetch, errors aur CSV download ek jagah.

State ke liye React ke `useState`, `useEffect` aur Context use hue hain. Alag state library zaroori nahi thi. Styling regular CSS mein hai, isliye browser mein inspect karke samajh sakte ho.

Original rum-core ka design `client/src/styles.css` mein hai. Upar color variables hain; `.dark` unhi colors ko change karta hai. `client/src/theme.jsx` theme ko browser mein save karta hai aur Ctrl+M shortcut handle karta hai. JetBrains Mono font aur original login/dialog images `client/public/` mein local hain.

`components/WorldMap.jsx` collected country totals ko local SVG map par dikhata hai. Map data aur uske sources `components/map-data/README.md` mein hain. Marker country ka center hai; visitor ka exact location nahi.

## Backend ka flow

- `server/index.js` MongoDB connect karke server start karta hai.
- `server/app.js` middleware aur routes jodta hai.
- `server/routes/` request aur response handle karta hai.
- `server/services/` event validation, ingestion aur analytics calculations karta hai.
- `server/models/index.js` batata hai database mein data kis shape mein save hoga.
- `server/middleware/auth.js` har private request par session check karta hai.

Login ke baad browser ko HttpOnly session cookie milti hai. Password ka readable text save nahi hota; Node.js scrypt se password hash banta hai. Database mein session token ka hash store hota hai. Har project request owner ke user id se match hoti hai.

## Tracker ka flow

```text
Website → tracker → event batch → /api/ingest → MongoDB → dashboard
```

`tracker/src/index.js` browser mein chalta hai. Ye fetch/XHR ka original behavior preserve karke duration/status capture karta hai. `web-vitals` browser measurements deta hai. Repeated page updates same id use karte hain, isliye ek page ko baar-baar count nahi karte.

`tracker/src/helpers.js` mein small pure functions hain, jaise URL sanitize karna aur patterns match karna. In functions ko browser ke bina test kar sakte hain. Bundle automatically `server/public/tracker.js` mein banta hai; changes source files mein karo.

## Naya feature kaise add karein

URL checker alag kaise hai: `server/services/website-check/` mein manual HTTP check aur browser scan ka code hai. HTTP check ek public URL ko request bhejta hai. Browser scan website kholkar us visit ki network requests observe karta hai. `client/src/pages/WebsiteCheck.jsx` input aur results dikhata hai. Is tool ko tracker install karne ki zaroorat nahi; ongoing visitor monitoring ke liye tracker use hota hai.

Pehle required behavior define karo. Agar database data chahiye to model aur server route update karo. Phir `api.js` ke through React page se call karo. Loading, empty aur error state handle karo. Agar change login, permissions, ingestion ya analytics affect karta hai to meaningful test add karo.

Small changes ke liye extra layers aur generic factories mat banao. Clear function names, small files, aur comments jo reason explain karein, code ko readable rakhte hain.
