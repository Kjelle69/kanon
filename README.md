# Kanon v0.3 – Streaminglab + lobby

Kör på pinode2 i `/home/kjelle/servers/kanon`. Den befintliga tjänsten serverar de uppdaterade statiska filerna direkt. **Inga ändringar, omstarter eller reloads av systemtjänster eller Cloudflare Tunnel har utförts för v0.3.** Serverprotokollet och /healthz behåller version 0.2.0; webbappen och npm-paketet är 0.3.0.

## Spela

Öppna https://kanon.mtecproductions.se i två webbläsare. Den första spelaren väljer **Skapa spel** och delar den sexsiffriga koden. Den andra anger koden och väljer **Anslut till spel**. WebRTC, kamera B och styrkanalen startar automatiskt.

- Sikta med WASD/piltangenter; skjut med blanksteg eller knappen Skjut.
- Välj lätt/tung ammunition separat för vardera spelaren. Ursprungliga omladdningstider är 2/6 sekunder.
- Klicka i spelvyn för tangentbordsfokus. Fokusförlust släpper tangenter så att siktet inte fastnar.
- **Lämna spel** avslutar matchen för båda. Samma sidor kan skapa/ansluta igen, även med omvända roller. Ny match återställer världen.
- Lobby, WebRTC, videoström och styrkanal har separata statusfält.

## Arkitektur

`public/game/streaminglab.js` innehåller den befintliga CannonScene-motorn från Streaminglab 0.1 och en adapter. Scen, borgar, två kanoner/kameror, projektiler, destruktion, fragment, ballistik och 640×480-upplösning har behållits. Ändringarna i motorklassen gäller enbart läsning av WebRTC-status och livscykelstädning av animation/GPU-resurser. Ingen ny spelmotor eller synkronisering av fysik har införts.

Endast hosten skapar CannonScene och två WebGL-renderare. Kamera A visas lokalt. Kamera B fångas från previewCanvas med captureStream(30) och läggs som videospår på **lobbyns enda RTCPeerConnection** innan offer skapas. Gästen skapar ingen spelvärld eller WebGL-renderare; den visar videon och skickar styrkommandon på samma anslutnings DataChannel.

Styrkanalen är tillförlitlig och ordnad, så att keyup och ammunition inte tappas. Hosten accepterar endast tillåtna siktknappar, boolean för nedtryckt/släppt, light/heavy och fire, med en gräns på 120 kommandon/sekund. Gäster kan inte utlösa diagnostikens stressfunktion. Hosten använder spelmotorns ursprungliga omladdningsgräns.

Servern hanterar fortfarande bara statiska filer, lobby och SDP/ICE-signaling. Varken video, styrkommandon, fragment eller fysik går genom Pi-serverns API. Three.js 0.180.0 serveras lokalt från public/vendor med licens; ingen extern CDN eller ändrad CSP behövs.

Vid matchslut stoppas animationsloopen och captureStream-spåren, renderer/scenresurser frigörs och PeerConnection/DataChannel stängs. Referenser, input och videoelement töms. Sena callbacks från gamla anslutningar ignoreras. Knappen för ny match aktiveras efter serverns bekräftelse av avslutat rum. En tillfällig WebRTC-frånkoppling får åtta sekunder att återhämta sig; failed avslutar direkt. Lobby-socketen återansluter automatiskt, men en bruten match måste skapas på nytt.

## Diagnostik och säkerhetskopia

`/game/diagnostic.html` är originalets manuella offer/answer-flöde i separat flik, med originalets egna PeerConnection. Det laddas aldrig i normalflödet. Originalets inline-script och CSS har flyttats till diagnostic.js och streaminglab.css, och Three.js laddas lokalt för befintlig CSP. Originalets återställ-knapp laddar fortfarande om diagnostikfliken.

`/game/index.html` leder nu till lobbyn. Originalet finns byte för byte i säkerhetskopian nedan.

Säkerhetskopian **backups/kanon-before-v0.3-20261024-145316.tar.gz** skapades före ändringarna. Den innehåller projektet inklusive originalets public/game/index.html, men inte node_modules eller tidigare backups. Den serveras inte publikt. Extrahera till en separat katalog för granskning/återställning; undvik att skriva över en aktiv installation utan kontroll.

## Verifiering och drift

```sh
npm ci
npm test
npm run test:e2e
curl http://127.0.0.1:8080/healthz
systemctl status kanon.service
journalctl -u kanon.service -f
```

Playwright använder systemets `/usr/bin/chromium` och en separat tillfällig server på 127.0.0.1:8091. Inga tester behöver stoppa eller ändra den publika tjänsten. Software WebGL används i headless-testet; det mäter inte prestandan hos spelarnas GPU:er. Bilder från speltestet sparas i test-results/host.png och guest.png.

WebSocket-tester verifierar hälsa, origin, rumsisolering, signaleringsordning, validering, payloadgränser, försöksgränser, timeout och frånkoppling. Webbläsartester använder riktiga RTCPeerConnection, videospår, DataChannel och WebGL i två separata browser contexts. De testar simultana kommandon, olika ammunition, destruktion/fragment, mottagna/dekodade videobilder, en anslutning per klient, släppta tangenter, ogiltiga kommandon, leave, omvända roller utan sidomladdning och abrupt stängd motpart. Manuell signaling testas separat.

## Begränsningar

Den publika domänen har kontrollerats och serverar v0.3. Speltesterna kör lokalt på Pi, inte mellan två externa nät eller fysiska spelardatorer. Verifiera slutligen den publika domänen och målwebbläsarna över de nät som ska användas. Nuvarande /config har tom ICE-serverlista; det fungerar när direktanslutning tillåts men garanterar inte anslutning genom alla NAT-/mobilnät. STUN/TURN-konfiguration har lämnats oförändrad. Om TURN behövs måste reläet ligga utanför denna Pi för att hålla videon borta från Pi-servern.

Spelmotorns ursprungliga fysik, ammunitionseffekter och prestandagränser är oförändrade. Hosten bör hålla spelvyn aktiv; webbläsare kan strypa animation i bakgrundsflikar. Gästen har videofördröjning, medan all simulering och dubbel rendering belastar hostens enhet. Aktiva matcher kan inte återupptas efter en permanent frånkoppling; skapa en ny kod.
